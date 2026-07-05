#include "wifi_manager.h"

#include <string.h>

#include "esp_check.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "nvs_flash.h"

#define WIFI_CONNECTED_BIT BIT0

// Mitigasi brownout pada catu daya lemah: batasi daya pancar WiFi agar lonjakan
// arus saat TX lebih kecil → drop tegangan berkurang → brownout reset lebih
// jarang. Satuan 0.25 dBm; 44 = 11 dBm (turun dari default 20 dBm). Untuk soket
// yang dekat router jangkauan tetap cukup. CATATAN: ini hanya mengurangi, BUKAN
// pengganti catu daya 5V yang memadai (≥1A) + kapasitor bulk.
#define WIFI_MANAGER_MAX_TX_POWER_QDBM 44

static const char *TAG = "wifi_manager";

// Status internal runtime untuk satu sesi WiFi station.
static bool s_initialized = false;
static bool s_started = false;
static uint8_t s_retry_count = 0;
static wifi_manager_state_t s_state = WIFI_MANAGER_STATE_IDLE;
static wifi_manager_config_t s_config = {0};
static EventGroupHandle_t s_wifi_event_group = NULL;
static esp_netif_t *s_sta_netif = NULL;
static esp_event_handler_instance_t s_instance_any_id;
static esp_event_handler_instance_t s_instance_got_ip;
static wifi_manager_event_cb_t s_event_cb = NULL;
static void *s_user_ctx = NULL;

// Teruskan event level modul ke callback aplikasi.
static void wifi_manager_publish_event(wifi_manager_event_t event, void *event_data)
{
    if (s_event_cb != NULL) {
        s_event_cb(event, event_data, s_user_ctx);
    }
}

// Validasi konfigurasi eksternal sebelum memanggil API ESP-IDF.
static esp_err_t wifi_manager_validate_config(const wifi_manager_config_t *config)
{
    ESP_RETURN_ON_FALSE(config != NULL, ESP_ERR_INVALID_ARG, TAG, "config is null");
    ESP_RETURN_ON_FALSE(config->ssid != NULL, ESP_ERR_INVALID_ARG, TAG, "ssid is null");
    ESP_RETURN_ON_FALSE(strlen(config->ssid) > 0, ESP_ERR_INVALID_ARG, TAG, "ssid is empty");

    if (strlen(config->ssid) > 32) {
        ESP_LOGE(TAG, "ssid length must be <= 32");
        return ESP_ERR_INVALID_ARG;
    }

    if (config->password != NULL && strlen(config->password) > 64) {
        ESP_LOGE(TAG, "password length must be <= 64");
        return ESP_ERR_INVALID_ARG;
    }

    return ESP_OK;
}

// Ubah kode alasan disconnect umum menjadi string agar log mudah dibaca.
static const char *wifi_manager_disconnect_reason_to_string(wifi_err_reason_t reason)
{
    switch (reason) {
#ifdef WIFI_REASON_AUTH_FAIL
    case WIFI_REASON_AUTH_FAIL:
        return "AUTH_FAIL";
#endif
#ifdef WIFI_REASON_NO_AP_FOUND
    case WIFI_REASON_NO_AP_FOUND:
        return "NO_AP_FOUND";
#endif
#ifdef WIFI_REASON_ASSOC_FAIL
    case WIFI_REASON_ASSOC_FAIL:
        return "ASSOC_FAIL";
#endif
#ifdef WIFI_REASON_HANDSHAKE_TIMEOUT
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
        return "HANDSHAKE_TIMEOUT";
#endif
#ifdef WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
        return "4WAY_HANDSHAKE_TIMEOUT";
#endif
#ifdef WIFI_REASON_BEACON_TIMEOUT
    case WIFI_REASON_BEACON_TIMEOUT:
        return "BEACON_TIMEOUT";
#endif
#ifdef WIFI_REASON_CONNECTION_FAIL
    case WIFI_REASON_CONNECTION_FAIL:
        return "CONNECTION_FAIL";
#endif
    default:
        return "UNKNOWN";
    }
}

// Kebijakan retry berdasarkan alasan disconnect.
// Gagal autentikasi dan asosiasi dianggap tidak boleh retry,
// sedangkan gangguan radio/jaringan sementara tetap boleh retry.
static bool wifi_manager_should_retry_disconnect_reason(wifi_err_reason_t reason)
{
    switch (reason) {
    // Hanya alasan yang jelas menandakan salah konfigurasi (kredensial/asosiasi
    // ditolak) yang tidak boleh di-retry, supaya tidak spam & kena lockout AP.
    // Handshake/4way timeout DIANGGAP transien (sinyal lemah) → tetap retry.
#ifdef WIFI_REASON_AUTH_FAIL
    case WIFI_REASON_AUTH_FAIL:
#endif
#ifdef WIFI_REASON_ASSOC_FAIL
    case WIFI_REASON_ASSOC_FAIL:
#endif
        return false;
    default:
        return true;
    }
}

// Event handler utama untuk event WiFi dan IP.
static void wifi_manager_event_handler(
    void *arg,
    esp_event_base_t event_base,
    int32_t event_id,
    void *event_data)
{
    if (event_base == WIFI_EVENT) {
        switch (event_id) {
        case WIFI_EVENT_STA_START:
            s_state = WIFI_MANAGER_STATE_CONNECTING;
            wifi_manager_publish_event(WIFI_MANAGER_EVENT_CONNECTING, NULL);
            esp_wifi_connect();
            break;

        case WIFI_EVENT_STA_DISCONNECTED:
        {
            wifi_event_sta_disconnected_t *disc = (wifi_event_sta_disconnected_t *)event_data;
            wifi_err_reason_t reason = disc ? disc->reason : WIFI_REASON_UNSPECIFIED;
            bool should_retry = wifi_manager_should_retry_disconnect_reason(reason);

            xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
            wifi_manager_publish_event(WIFI_MANAGER_EVENT_DISCONNECTED, event_data);

            ESP_LOGW(
                TAG,
                "wifi disconnected (reason=%s:%u)",
                wifi_manager_disconnect_reason_to_string(reason),
                (unsigned int)reason);

            if (should_retry) {
                // Reconnect SELAMANYA untuk gangguan transien (router reboot,
                // sinyal hilang, AP sibuk). Percobaan di-pace oleh driver WiFi
                // (event STA_DISCONNECTED baru muncul setelah timeout scan/assoc),
                // jadi ini bukan busy-loop. Device tetap jalan lokal saat offline.
                // max_retry kini hanya ambang verbositas log, bukan batas menyerah.
                s_retry_count++;
                s_state = WIFI_MANAGER_STATE_CONNECTING;
                if (s_retry_count <= s_config.max_retry || (s_retry_count % 20U) == 0U) {
                    ESP_LOGW(TAG, "wifi disconnected, reconnect attempt %u",
                             (unsigned int)s_retry_count);
                }
                esp_wifi_connect();
            } else {
                // Alasan non-retryable (kredensial/asosiasi ditolak): hentikan
                // agar tidak spam / kena lockout AP. Perlu re-provisioning.
                s_state = WIFI_MANAGER_STATE_FAILED;
                ESP_LOGE(
                    TAG,
                    "wifi connect stopped: non-retryable reason=%s:%u",
                    wifi_manager_disconnect_reason_to_string(reason),
                    (unsigned int)reason);
                wifi_manager_publish_event(WIFI_MANAGER_EVENT_CONNECT_FAILED, event_data);
            }
            break;
        }

        default:
            break;
        }
    }

    if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        s_retry_count = 0;
        s_state = WIFI_MANAGER_STATE_CONNECTED;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        wifi_manager_publish_event(WIFI_MANAGER_EVENT_CONNECTED, event_data);
        wifi_manager_publish_event(WIFI_MANAGER_EVENT_GOT_IP, event_data);
    }
}

esp_err_t wifi_manager_init(
    const wifi_manager_config_t *config,
    wifi_manager_event_cb_t event_cb,
    void *user_ctx)
{
    // Tolak input tidak valid sedini mungkin.
    ESP_RETURN_ON_ERROR(wifi_manager_validate_config(config), TAG, "invalid wifi config");

    if (s_initialized) {
        ESP_LOGW(TAG, "wifi manager already initialized");
        return ESP_OK;
    }

    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_RETURN_ON_ERROR(nvs_flash_erase(), TAG, "nvs erase failed");
        ESP_RETURN_ON_ERROR(nvs_flash_init(), TAG, "nvs init failed after erase");
    } else {
        ESP_RETURN_ON_ERROR(ret, TAG, "nvs init failed");
    }

    ESP_RETURN_ON_ERROR(esp_netif_init(), TAG, "esp_netif_init failed");

    ret = esp_event_loop_create_default();
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_RETURN_ON_ERROR(ret, TAG, "create default event loop failed");
    }

    s_wifi_event_group = xEventGroupCreate();
    ESP_RETURN_ON_FALSE(s_wifi_event_group != NULL, ESP_ERR_NO_MEM, TAG, "event group create failed");

    s_sta_netif = esp_netif_create_default_wifi_sta();
    ESP_RETURN_ON_FALSE(s_sta_netif != NULL, ESP_FAIL, TAG, "create default wifi sta failed");

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&cfg), TAG, "esp_wifi_init failed");

    ESP_RETURN_ON_ERROR(
        esp_event_handler_instance_register(
            WIFI_EVENT,
            ESP_EVENT_ANY_ID,
            &wifi_manager_event_handler,
            NULL,
            &s_instance_any_id),
        TAG,
        "register WIFI_EVENT handler failed");

    ESP_RETURN_ON_ERROR(
        esp_event_handler_instance_register(
            IP_EVENT,
            IP_EVENT_STA_GOT_IP,
            &wifi_manager_event_handler,
            NULL,
            &s_instance_got_ip),
        TAG,
        "register IP_EVENT handler failed");

    memset(&s_config, 0, sizeof(s_config));
    s_config = *config;

    // Terapkan SSID dan password ke konfigurasi station ESP-IDF.
    wifi_config_t wifi_config = {0};
    strncpy((char *)wifi_config.sta.ssid, s_config.ssid, sizeof(wifi_config.sta.ssid) - 1);
    if (s_config.password != NULL) {
        strncpy((char *)wifi_config.sta.password, s_config.password, sizeof(wifi_config.sta.password) - 1);
    }

    // Pilih mode keamanan otomatis berdasarkan ada/tidaknya password.
    wifi_config.sta.threshold.authmode =
        (s_config.password != NULL && strlen(s_config.password) > 0)
            ? WIFI_AUTH_WPA2_PSK
            : WIFI_AUTH_OPEN;

    wifi_config.sta.pmf_cfg.capable = true;
    wifi_config.sta.pmf_cfg.required = false;

    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), TAG, "set wifi mode failed");
    ESP_RETURN_ON_ERROR(esp_wifi_set_config(WIFI_IF_STA, &wifi_config), TAG, "set wifi config failed");

    s_event_cb = event_cb;
    s_user_ctx = user_ctx;
    s_state = WIFI_MANAGER_STATE_IDLE;
    s_retry_count = 0;
    s_initialized = true;

    ESP_LOGI(TAG, "wifi manager initialized for ssid: %s", s_config.ssid);
    return ESP_OK;
}

esp_err_t wifi_manager_start(void)
{
    ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "wifi manager not initialized");

    if (s_started) {
        ESP_LOGW(TAG, "wifi already started");
        return ESP_OK;
    }

    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "esp_wifi_start failed");
    s_started = true;

    // Turunkan daya pancar WiFi setelah start (mitigasi brownout catu daya lemah).
    // Non-fatal: kalau gagal, tetap lanjut dengan daya default.
    esp_err_t tx_ret = esp_wifi_set_max_tx_power(WIFI_MANAGER_MAX_TX_POWER_QDBM);
    if (tx_ret != ESP_OK) {
        ESP_LOGW(TAG, "set max tx power gagal: %s", esp_err_to_name(tx_ret));
    } else {
        ESP_LOGI(TAG, "wifi max tx power dibatasi ke %d (unit 0.25dBm = %.1f dBm)",
                 WIFI_MANAGER_MAX_TX_POWER_QDBM, WIFI_MANAGER_MAX_TX_POWER_QDBM * 0.25f);
    }

    return ESP_OK;
}

esp_err_t wifi_manager_stop(void)
{
    ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "wifi manager not initialized");

    if (!s_started) {
        return ESP_OK;
    }

    ESP_RETURN_ON_ERROR(esp_wifi_stop(), TAG, "esp_wifi_stop failed");
    xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);

    s_started = false;
    s_state = WIFI_MANAGER_STATE_IDLE;
    s_retry_count = 0;

    return ESP_OK;
}

esp_err_t wifi_manager_connect(void)
{
    ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "wifi manager not initialized");

    // Jika sudah terhubung, tidak perlu melakukan connect ulang.
    if (s_state == WIFI_MANAGER_STATE_CONNECTED || wifi_manager_is_connected()) {
        ESP_LOGI(TAG, "wifi already connected");
        return ESP_OK;
    }

    // Jika sedang proses koneksi, anggap sukses agar API aman dipanggil berulang.
    if (s_state == WIFI_MANAGER_STATE_CONNECTING) {
        ESP_LOGI(TAG, "wifi connect already in progress");
        return ESP_OK;
    }

    if (!s_started) {
        // Start akan memicu WIFI_EVENT_STA_START dan event handler akan memanggil esp_wifi_connect().
        ESP_RETURN_ON_ERROR(wifi_manager_start(), TAG, "wifi start failed");
        return ESP_OK;
    }

    // Jika WiFi sudah start namun idle/failed, lakukan connect manual sekali.
    s_state = WIFI_MANAGER_STATE_CONNECTING;
    wifi_manager_publish_event(WIFI_MANAGER_EVENT_CONNECTING, NULL);
    esp_err_t ret = esp_wifi_connect();

    // ESP_ERR_WIFI_CONN berarti koneksi sedang berjalan; perlakukan sebagai kondisi non-fatal.
    if (ret == ESP_ERR_WIFI_CONN) {
        ESP_LOGW(TAG, "wifi connect request ignored: already connecting");
        return ESP_OK;
    }

    ESP_RETURN_ON_ERROR(ret, TAG, "esp_wifi_connect failed");

    return ESP_OK;
}

bool wifi_manager_is_connected(void)
{
    if (s_wifi_event_group == NULL) {
        return false;
    }

    EventBits_t bits = xEventGroupGetBits(s_wifi_event_group);
    return (bits & WIFI_CONNECTED_BIT) != 0;
}

wifi_manager_state_t wifi_manager_get_state(void)
{
    return s_state;
}

esp_err_t wifi_manager_wait_until_connected(uint32_t timeout_ms)
{
    ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "wifi manager not initialized");
    ESP_RETURN_ON_FALSE(s_wifi_event_group != NULL, ESP_ERR_INVALID_STATE, TAG, "event group not ready");

    TickType_t ticks = (timeout_ms == 0) ? portMAX_DELAY : pdMS_TO_TICKS(timeout_ms);
    EventBits_t bits = xEventGroupWaitBits(
        s_wifi_event_group,
        WIFI_CONNECTED_BIT,
        pdFALSE,
        pdFALSE,
        ticks);

    return (bits & WIFI_CONNECTED_BIT) ? ESP_OK : ESP_ERR_TIMEOUT;
}

const char *wifi_manager_state_to_string(wifi_manager_state_t state)
{
    switch (state) {
    case WIFI_MANAGER_STATE_IDLE:
        return "IDLE";
    case WIFI_MANAGER_STATE_CONNECTING:
        return "CONNECTING";
    case WIFI_MANAGER_STATE_CONNECTED:
        return "CONNECTED";
    case WIFI_MANAGER_STATE_FAILED:
        return "FAILED";
    default:
        return "UNKNOWN";
    }
}
