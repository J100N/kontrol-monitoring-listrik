#include "device_profile.h"

#include <stdio.h>
#include <string.h>

#include "auto_control.h"
#include "ascon.h"
#include "device_state.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"

#include "mqtt_app.h"
#include "oled.h"
#include "pir.h"
#include "pzem.h"
#include "relay.h"
#include "telemetry.h"
#include "time_sync.h"
#include "wifi_manager.h"

/* =============================================================
 * VARIABEL DAN FUNGSI AWAL
 * ============================================================= */

static const char *TAG = "app_main";
static uint32_t s_ack_seq    = 0;
static ascon_ctx_t s_ascon   = {0};
static uint8_t s_batch_count = 0;

static void wifi_event_callback(wifi_manager_event_t event, void *event_data, void *user_ctx);
static void mqtt_command_callback(const char *topic, const uint8_t *payload, size_t payload_len, void *user_ctx);

/* =============================================================
 * COUNTER ANTI-REPLAY PERMANEN (DISIMPAN DI NVS)
 * Counter ASCON harus selalu naik walau device reboot, supaya server
 * tidak menganggap data sebagai serangan replay. Kita simpan "batas atas"
 * counter di flash (NVS): tiap boot lompat +RESERVE, dan disimpan ulang
 * tiap kali counter mendekati batas. Hemat tulis flash (sekali per ~RESERVE).
 * ============================================================= */

#define ASCON_CTR_NVS_NS  "ascon"     // namespace NVS
#define ASCON_CTR_NVS_KEY "tx_ctr"    // key penyimpan batas counter
#define ASCON_CTR_RESERVE 256ULL      // blok counter yang dicadangkan tiap simpan

static uint64_t s_ctr_hwm = 0;        // batas atas counter yang sudah tersimpan di NVS

// Baca counter terakhir dari NVS, lompat +RESERVE, simpan batas baru, kembalikan nilai awal counter.
static uint64_t ascon_ctr_nvs_load_and_reserve(void)
{
    nvs_handle_t h;
    uint64_t saved = 0;
    if (nvs_open(ASCON_CTR_NVS_NS, NVS_READWRITE, &h) == ESP_OK) {
        nvs_get_u64(h, ASCON_CTR_NVS_KEY, &saved); // tetap 0 jika belum pernah ada
        s_ctr_hwm = saved + ASCON_CTR_RESERVE;
        nvs_set_u64(h, ASCON_CTR_NVS_KEY, s_ctr_hwm);
        nvs_commit(h);
        nvs_close(h);
    } else {
        s_ctr_hwm = saved + ASCON_CTR_RESERVE;
    }
    return s_ctr_hwm;
}

// Simpan batas baru ke NVS bila counter aktif sudah mencapai batas tersimpan.
static void ascon_ctr_nvs_maybe_save(uint64_t current)
{
    if (current < s_ctr_hwm) {
        return; // belum mencapai batas, tidak perlu tulis flash
    }
    nvs_handle_t h;
    if (nvs_open(ASCON_CTR_NVS_NS, NVS_READWRITE, &h) == ESP_OK) {
        s_ctr_hwm = current + ASCON_CTR_RESERVE;
        nvs_set_u64(h, ASCON_CTR_NVS_KEY, s_ctr_hwm);
        nvs_commit(h);
        nvs_close(h);
    }
}

/* =============================================================
 * PERSISTENSI KONFIG AUTO-CONTROL (NVS)
 *
 * Parameter kontrol otomatis (timeout PIR & threshold daya) bisa
 * diubah dari dashboard via command "config_update". Nilainya disimpan
 * di NVS agar tetap berlaku setelah device reboot. Threshold disimpan
 * sebagai centi-watt (watt*100) supaya muat di nvs_set_u32.
 * ============================================================= */

#define AUTOCFG_NVS_NS   "autocfg"   // namespace NVS untuk konfig auto-control
#define AUTOCFG_KEY_PIR  "pir_sec"   // timeout PIR (detik)
#define AUTOCFG_KEY_THR  "thr_cw"    // threshold daya (centi-watt = watt*100)
#define AUTOCFG_KEY_MODE "mode"      // mode kerja (0=manual, 1=automatic)

// Baca konfig dari NVS bila ada; bila tidak, *_io tidak diubah (pakai default).
static void autocfg_nvs_load(uint32_t *pir_sec_io, float *thr_w_io)
{
    nvs_handle_t h;
    if (nvs_open(AUTOCFG_NVS_NS, NVS_READONLY, &h) != ESP_OK) {
        return; // namespace belum pernah dibuat → pakai default
    }
    uint32_t pir = 0;
    uint32_t thr_cw = 0;
    if (nvs_get_u32(h, AUTOCFG_KEY_PIR, &pir) == ESP_OK && pir > 0U) {
        *pir_sec_io = pir;
    }
    if (nvs_get_u32(h, AUTOCFG_KEY_THR, &thr_cw) == ESP_OK) {
        *thr_w_io = (float)thr_cw / 100.0f;
    }
    nvs_close(h);
}

// Baca mode kerja terakhir dari NVS. Bila belum pernah tersimpan, *mode_io
// tidak diubah (dipertahankan default pemanggil). Mengembalikan mode terakhir
// yang dipilih user agar tetap konsisten setelah device reboot.
static void autocfg_nvs_load_mode(device_work_mode_t *mode_io)
{
    nvs_handle_t h;
    if (nvs_open(AUTOCFG_NVS_NS, NVS_READONLY, &h) != ESP_OK) {
        return;
    }
    uint32_t mode = 0;
    if (nvs_get_u32(h, AUTOCFG_KEY_MODE, &mode) == ESP_OK) {
        *mode_io = (mode == (uint32_t)DEVICE_WORK_MODE_AUTOMATIC)
                       ? DEVICE_WORK_MODE_AUTOMATIC
                       : DEVICE_WORK_MODE_MANUAL;
    }
    nvs_close(h);
}

// Simpan mode kerja ke NVS agar bertahan setelah reboot (sinkron dgn dashboard).
static void autocfg_nvs_save_mode(device_work_mode_t mode)
{
    nvs_handle_t h;
    if (nvs_open(AUTOCFG_NVS_NS, NVS_READWRITE, &h) == ESP_OK) {
        nvs_set_u32(h, AUTOCFG_KEY_MODE, (uint32_t)mode);
        nvs_commit(h);
        nvs_close(h);
    }
}

// Simpan konfig auto-control ke NVS.
static void autocfg_nvs_save(uint32_t pir_sec, float thr_w)
{
    nvs_handle_t h;
    if (nvs_open(AUTOCFG_NVS_NS, NVS_READWRITE, &h) == ESP_OK) {
        nvs_set_u32(h, AUTOCFG_KEY_PIR, pir_sec);
        nvs_set_u32(h, AUTOCFG_KEY_THR, (uint32_t)(thr_w * 100.0f + 0.5f));
        nvs_commit(h);
        nvs_close(h);
    }
}

/* =============================================================
 * SIMPAN DATA SEMENTARA (ANTRIAN KIRIM KE SERVER)
 * ============================================================= */

#define TELEMETRY_BUFFER_CAPACITY 180

typedef struct {
    telemetry_power_sample_t items[TELEMETRY_BUFFER_CAPACITY];
    size_t head;
    size_t count;
    uint32_t dropped_total;
} telemetry_buffer_t;

static telemetry_buffer_t s_telemetry_buffer = {0};

static void telemetry_buffer_push(const telemetry_power_sample_t *sample)
{
    if (sample == NULL) {
        return;
    }

    if (s_telemetry_buffer.count == TELEMETRY_BUFFER_CAPACITY) {
        s_telemetry_buffer.head = (s_telemetry_buffer.head + 1U) % TELEMETRY_BUFFER_CAPACITY;
        s_telemetry_buffer.count--;
        s_telemetry_buffer.dropped_total++;

        if (s_telemetry_buffer.dropped_total == 1U || (s_telemetry_buffer.dropped_total % 30U) == 0U) {
            ESP_LOGW(
                TAG,
                "[%s] Buffer telemetry penuh, sample lama dibuang (total dropped=%lu)",
                DEVICE_ID,
                (unsigned long)s_telemetry_buffer.dropped_total);
        }
    }

    size_t tail = (s_telemetry_buffer.head + s_telemetry_buffer.count) % TELEMETRY_BUFFER_CAPACITY;
    s_telemetry_buffer.items[tail] = *sample;
    s_telemetry_buffer.count++;
}

static esp_err_t telemetry_buffer_flush(void)
{
    if (!mqtt_app_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }

    /* Kirim semua batch lengkap yang tersimpan di antrian. */
    while (s_telemetry_buffer.count >= TELEMETRY_BATCH_SIZE) {
        telemetry_power_sample_t batch[TELEMETRY_BATCH_SIZE];
        for (size_t i = 0; i < TELEMETRY_BATCH_SIZE; i++) {
            size_t idx  = (s_telemetry_buffer.head + i) % TELEMETRY_BUFFER_CAPACITY;
            batch[i]    = s_telemetry_buffer.items[idx];
        }

        /* Muat envelope terenkripsi: cipher hex (~2090) + nonce/tag/header. Margin aman. */
        static char s_batch_payload[3072];
        if (telemetry_build_encrypted_batch_json(&s_ascon, DEVICE_ID, batch, TELEMETRY_BATCH_SIZE, s_batch_payload, sizeof(s_batch_payload)) != ESP_OK) {
            ESP_LOGW(TAG, "[%s] Build batch gagal, batch dibuang", DEVICE_ID);
            s_telemetry_buffer.head   = (s_telemetry_buffer.head + TELEMETRY_BATCH_SIZE) % TELEMETRY_BUFFER_CAPACITY;
            s_telemetry_buffer.count -= TELEMETRY_BATCH_SIZE;
            continue;
        }

        if (mqtt_app_publish_telemetry(s_batch_payload, -1, false) != ESP_OK) {
            return ESP_FAIL;
        }

        s_telemetry_buffer.head   = (s_telemetry_buffer.head + TELEMETRY_BATCH_SIZE) % TELEMETRY_BUFFER_CAPACITY;
        s_telemetry_buffer.count -= TELEMETRY_BATCH_SIZE;
    }

    return ESP_OK;
}

/* =============================================================
 * TAMPILAN LAYAR OLED
 * ============================================================= */

static void refresh_oled_from_state(void)
{
    if (!oled_is_initialized() || !device_state_is_initialized()) {
        return;
    }

    device_state_snapshot_t snapshot = {0};
    if (device_state_get_snapshot(&snapshot) != ESP_OK) {
        return;
    }

    char lines[DEVICE_STATE_OLED_MAX_LINES][DEVICE_STATE_OLED_LINE_LEN] = {0};
    if (device_state_format_oled_lines(&snapshot, lines) != ESP_OK) {
        return;
    }

    const char *line_ptrs[DEVICE_STATE_OLED_MAX_LINES] = {
        lines[0], lines[1], lines[2], lines[3],
        lines[4], lines[5], lines[6], lines[7],
    };

    if (oled_draw_text_lines(line_ptrs, DEVICE_STATE_OLED_MAX_LINES) != ESP_OK) {
        // Kemungkinan koneksi I2C OLED bermasalah (NACK). Lepas driver agar
        // loop utama otomatis mencoba init ulang saat koneksi pulih.
        ESP_LOGW(TAG, "[%s] Gagal refresh OLED, lepas & coba init ulang", DEVICE_ID);
        oled_deinit();
    }
}

/* =============================================================
 * KONEKSI WIFI DAN MQTT
 * ============================================================= */

static void connectivity_task(void *arg)
{
    (void)arg;

    wifi_manager_config_t wifi_cfg = {
        .ssid = WIFI_STA_SSID,
        .password = WIFI_STA_PASSWORD,
        .max_retry = WIFI_MAX_RETRY,
    };

    mqtt_app_config_t mqtt_cfg = {
        .broker_uri = MQTT_BROKER_URI,
        .username = MQTT_USERNAME,
        .password = MQTT_PASSWORD,
        .client_id = MQTT_CLIENT_ID,
        .device_id = DEVICE_ID,
        .topic_command = MQTT_TOPIC_COMMAND,
        .topic_telemetry = MQTT_TOPIC_TELEMETRY,
        .topic_relay_status = MQTT_TOPIC_RELAY_STATUS,
        .topic_ack = MQTT_TOPIC_ACK,
        .lwt_topic = MQTT_TOPIC_LWT,
        .lwt_payload = MQTT_LWT_PAYLOAD,
        .lwt_qos = 1,
        .lwt_retain = true,
        .wifi_wait_timeout_ms = 15000,
        .default_qos = 1,
    };

    esp_err_t ret = wifi_manager_init(&wifi_cfg, wifi_event_callback, NULL);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "[%s] Gagal init WiFi manager: %s", DEVICE_ID, esp_err_to_name(ret));
        vTaskDelete(NULL);
        return;
    }

    ret = wifi_manager_connect();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "[%s] Gagal start koneksi WiFi: %s", DEVICE_ID, esp_err_to_name(ret));
        vTaskDelete(NULL);
        return;
    }

    if (wifi_manager_wait_until_connected(15000) == ESP_OK) {
        ESP_LOGI(TAG, "[%s] WiFi ready, lanjut ke MQTT/telemetry", DEVICE_ID);
    } else {
        ESP_LOGW(TAG, "[%s] WiFi belum terhubung, lanjutkan mode buffering lokal", DEVICE_ID);
    }
    refresh_oled_from_state();

    esp_err_t time_sync_ret = time_sync_init(NULL);
    if (time_sync_ret == ESP_OK) {
        time_sync_ret = time_sync_wait_for_sync(TIME_SYNC_DEFAULT_TIMEOUT_MS);
    }
    if (time_sync_ret == ESP_OK) {
        ESP_LOGI(TAG, "[%s] Time sync sukses", DEVICE_ID);
    } else {
        ESP_LOGW(TAG, "[%s] Time sync belum siap, pakai fallback uptime", DEVICE_ID);
    }

    ret = mqtt_app_init(&mqtt_cfg, mqtt_command_callback, NULL);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "[%s] Gagal init MQTT: %s", DEVICE_ID, esp_err_to_name(ret));
        vTaskDelete(NULL);
        return;
    }

    ret = mqtt_app_start();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "[%s] Gagal start MQTT: %s", DEVICE_ID, esp_err_to_name(ret));
        vTaskDelete(NULL);
        return;
    }

    if (device_state_is_initialized()) {
        device_state_set_mqtt_connected(mqtt_app_is_connected());
    }

    mqtt_app_publish_device_status(true, -1, true);
    mqtt_app_publish_relay_status(relay_get_state(), -1, true);
    refresh_oled_from_state();

    vTaskDelete(NULL);
}

static void wifi_event_callback(wifi_manager_event_t event, void *event_data, void *user_ctx)
{
    (void)event_data;
    (void)user_ctx;

    switch (event) {
    case WIFI_MANAGER_EVENT_CONNECTING:
        ESP_LOGI(TAG, "[%s] WiFi connecting", DEVICE_ID);
        if (device_state_is_initialized()) {
            device_state_set_wifi_connected(false);
        }
        break;
    case WIFI_MANAGER_EVENT_CONNECTED:
        ESP_LOGI(TAG, "[%s] WiFi connected", DEVICE_ID);
        if (device_state_is_initialized()) {
            device_state_set_wifi_connected(true);
        }
        break;
    case WIFI_MANAGER_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "[%s] WiFi disconnected", DEVICE_ID);
        if (device_state_is_initialized()) {
            device_state_set_wifi_connected(false);
        }
        break;
    case WIFI_MANAGER_EVENT_GOT_IP:
        ESP_LOGI(TAG, "[%s] WiFi got IP", DEVICE_ID);
        if (device_state_is_initialized()) {
            device_state_set_wifi_connected(true);
        }
        // Jaringan baru siap: picu SNTP segera (penting setelah WiFi putus-nyambung).
        time_sync_force_resync();
        break;
    case WIFI_MANAGER_EVENT_CONNECT_FAILED:
        ESP_LOGE(TAG, "[%s] WiFi connect failed", DEVICE_ID);
        if (device_state_is_initialized()) {
            device_state_set_wifi_connected(false);
        }
        break;
    default:
        break;
    }

    refresh_oled_from_state();
}

/* =============================================================
 * TERIMA PERINTAH DARI SERVER (ON/OFF RELAY)
 * ============================================================= */

// Callback command dari broker MQTT (contoh payload: relay_on, relay_off, relay_toggle, ping).
static void mqtt_command_callback(const char *topic, const uint8_t *payload, size_t payload_len, void *user_ctx)
{
    (void)topic;
    (void)user_ctx;

    char command_id[32] = {0};
    char cmd[64] = {0};

    telemetry_encrypted_command_t enc_cmd = {0};
    if (telemetry_parse_encrypted_command(payload, payload_len, &enc_cmd) != ESP_OK) {
        ESP_LOGW(TAG, "[%s] Format command tidak valid (wajib format encrypted baru)", DEVICE_ID);
        mqtt_app_publish_ack("cmd-invalid", "error", "format command tidak valid", -1, false);
        return;
    }

    uint32_t key_id = 0;
    uint64_t counter = 0;
    if (telemetry_decrypt_command(&s_ascon, &enc_cmd, cmd, sizeof(cmd), &key_id, &counter) != ESP_OK) {
        ESP_LOGW(TAG, "[%s] Gagal decrypt command terenkripsi", DEVICE_ID);
        mqtt_app_publish_ack(enc_cmd.command_id, "error", "decrypt command gagal", -1, false);
        return;
    }

    strncpy(command_id, enc_cmd.command_id, sizeof(command_id) - 1U);
    ESP_LOGI(
        TAG,
        "[%s] Command terenkripsi berhasil didecrypt (key_id=%lu counter=%llu)",
        DEVICE_ID,
        (unsigned long)key_id,
        (unsigned long long)counter);

    // Jika command dikirim sebagai JSON sederhana, ekstrak field "command".
    if (cmd[0] == '{') {
        const char *k = strstr(cmd, "\"command\":\"");
        if (k != NULL) {
            k += strlen("\"command\":\"");
            const char *e = strchr(k, '\"');
            if (e != NULL) {
                size_t len = (size_t)(e - k);
                if (len < sizeof(cmd)) {
                    memmove(cmd, k, len);
                    cmd[len] = '\0';
                }
            }
        }
    }

    ESP_LOGI(TAG, "[%s] Command diterima: %s", DEVICE_ID, cmd);

    if (!relay_is_initialized()) {
        ESP_LOGW(TAG, "[%s] Relay belum init saat command masuk, coba init", DEVICE_ID);
        if (relay_init(NULL) != ESP_OK) {
            mqtt_app_publish_ack("cmd-unknown", "error", "relay init gagal", -1, false);
            return;
        }
    }

    const char *ack_status = "ok";
    const char *ack_msg = "command dieksekusi";

    if (strcmp(cmd, "relay_on") == 0 ||
        strcmp(cmd, "relay_off") == 0 ||
        strcmp(cmd, "relay_toggle") == 0) {
        // Perintah relay manual.
        esp_err_t r = (strcmp(cmd, "relay_on") == 0)  ? relay_on()
                    : (strcmp(cmd, "relay_off") == 0) ? relay_off()
                    :                                   relay_toggle();
        if (r != ESP_OK) {
            ack_status = "error";
            ack_msg = "gagal eksekusi relay";
        } else {
            // Pesan ACK spesifik sesuai hasil akhir relay agar log dashboard
            // jelas menyebut aksi (bukan sekadar "command dieksekusi").
            ack_msg = relay_get_state() ? "listrik dinyalakan manual"
                                        : "listrik dimatikan manual";
        }
        // Kontrol manual → paksa mode MANUAL supaya auto-control tidak menimpa.
        if (device_state_is_initialized()) {
            device_state_set_mode(DEVICE_WORK_MODE_MANUAL);
        }
        autocfg_nvs_save_mode(DEVICE_WORK_MODE_MANUAL);
    } else if (strcmp(cmd, "mode_auto") == 0) {
        // Aktifkan mode otomatis: auto-control yang mengelola relay.
        if (device_state_is_initialized()) {
            device_state_set_mode(DEVICE_WORK_MODE_AUTOMATIC);
        }
        autocfg_nvs_save_mode(DEVICE_WORK_MODE_AUTOMATIC);
        ack_msg = "mode otomatis aktif";
    } else if (strcmp(cmd, "mode_manual") == 0) {
        // Aktifkan mode manual: auto-control berhenti, kendali penuh user.
        if (device_state_is_initialized()) {
            device_state_set_mode(DEVICE_WORK_MODE_MANUAL);
        }
        autocfg_nvs_save_mode(DEVICE_WORK_MODE_MANUAL);
        ack_msg = "mode manual aktif";
    } else if (strncmp(cmd, "config_update", 13) == 0) {
        // Perbarui parameter auto-control dari dashboard.
        // Format plaintext: "config_update:pir=<detik>,thr=<watt>"
        unsigned int new_pir = 0U;
        float new_thr = -1.0f;
        int parsed = sscanf(cmd, "config_update:pir=%u,thr=%f", &new_pir, &new_thr);
        if (parsed == 2 &&
            new_pir >= 30U && new_pir <= 7200U &&
            new_thr >= 0.0f && new_thr <= 5000.0f) {
            if (auto_control_set_params((uint32_t)new_pir, new_thr) == ESP_OK) {
                autocfg_nvs_save((uint32_t)new_pir, new_thr);
                ESP_LOGI(TAG, "[%s] config_update diterapkan: pir=%us thr=%.2fW",
                         DEVICE_ID, new_pir, new_thr);
                ack_msg = "konfigurasi auto-control diperbarui";
            } else {
                ack_status = "error";
                ack_msg = "gagal menerapkan konfigurasi";
            }
        } else {
            ack_status = "error";
            ack_msg = "parameter config_update tidak valid";
        }
    } else if (strcmp(cmd, "ping") == 0) {
        ack_msg = "pong";
    } else {
        ack_status = "error";
        ack_msg = "command tidak dikenal";
    }

    if (device_state_is_initialized()) {
        device_state_set_relay(relay_get_state());
    }

    // Publish status relay terbaru agar dashboard sinkron.
    if (relay_is_initialized()) {
        mqtt_app_publish_relay_status(relay_get_state(), -1, false);
    }

    // Kirim ACK command ke broker.
    if (command_id[0] == '\0') {
        snprintf(command_id, sizeof(command_id), "cmd-%lu", (unsigned long)++s_ack_seq);
    }
    mqtt_app_publish_ack(command_id, ack_status, ack_msg, -1, false);
}

/* =============================================================
 * PROGRAM UTAMA
 * ============================================================= */

void app_main(void)
{
    const TickType_t pzem_interval_ticks = pdMS_TO_TICKS(1000);
    const uint8_t ascon_key[ASCON_KEY_SIZE] = ASCON_KEY_BYTES;
    esp_err_t pzem_ret = ESP_OK;

    ESP_LOGI(TAG, "Booting device: %s", DEVICE_ID);

    // Inisialisasi NVS (flash) sedini mungkin agar counter anti-replay bisa dibaca.
    esp_err_t nvs_ret = nvs_flash_init();
    if (nvs_ret == ESP_ERR_NVS_NO_FREE_PAGES || nvs_ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        nvs_ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(nvs_ret);

    ESP_ERROR_CHECK(ascon_init(&s_ascon, ascon_key, ASCON_KEY_ID));

    // Lanjutkan counter ASCON dari NVS agar selalu naik meski device reboot.
    // Ini mencegah server memblokir data karena dikira serangan replay.
    uint64_t ctr_start = ascon_ctr_nvs_load_and_reserve();
    ESP_ERROR_CHECK(ascon_set_tx_counter(&s_ascon, ctr_start));
    ESP_LOGI(TAG, "[%s] Counter ASCON dilanjutkan dari NVS: %llu", DEVICE_ID, (unsigned long long)ctr_start);

    ESP_ERROR_CHECK(device_state_init());
    ESP_ERROR_CHECK(device_state_set_device_online(true));
    // Pulihkan mode kerja terakhir dari NVS agar tetap sinkron dgn pilihan user
    // di dashboard setelah device reboot. Default saat first-boot = AUTOMATIC.
    device_work_mode_t boot_mode = DEVICE_WORK_MODE_AUTOMATIC;
    autocfg_nvs_load_mode(&boot_mode);
    ESP_ERROR_CHECK(device_state_set_mode(boot_mode));
    ESP_LOGI(TAG, "[%s] Mode kerja saat boot: %s", DEVICE_ID,
             device_state_mode_to_string(boot_mode));

    esp_err_t oled_ret = oled_init(NULL);
    if (oled_ret != ESP_OK) {
        ESP_LOGW(TAG, "[%s] OLED init gagal: %s", DEVICE_ID, esp_err_to_name(oled_ret));
    } else {
        // Tampilkan state awal agar OLED langsung terlihat aktif saat boot.
        refresh_oled_from_state();
    }

    // Inisialisasi PZEM agar pembacaan listrik mulai sejak boot.
    pzem_ret = pzem_init(NULL);
    if (pzem_ret != ESP_OK) {
        ESP_LOGW(TAG, "[%s] Init awal PZEM gagal: %s", DEVICE_ID, esp_err_to_name(pzem_ret));
    } else {
        pzem_data_t early_data = {0};
        if (pzem_read_data(&early_data) == ESP_OK) {
            device_state_set_last_power(early_data.power_w);
            refresh_oled_from_state();
        }
    }

    // Mitigasi brownout saat perangkat pertama dicolok ke listrik: beri jeda
    // singkat agar rail 5V & regulator stabil (kapasitor bulk terisi) sebelum
    // koil relay menarik arus inrush. Tanpa jeda ini, inrush relay saat boot
    // dapat menjatuhkan tegangan → brownout reset → device reboot berulang
    // (gejala relay klik on/off terus "seperti ngehang"). Catatan: bila catu
    // daya memang kurang kuat, jeda ini hanya mengurangi, bukan menghilangkan.
    vTaskDelay(pdMS_TO_TICKS(1500));

    // Relay otomatis nyala saat init (default_on=true) supaya PZEM langsung dapat arus.
    ESP_ERROR_CHECK(relay_init(NULL));
    ESP_ERROR_CHECK(device_state_set_relay(relay_get_state()));
    refresh_oled_from_state();

    // Inisialisasi PIR untuk deteksi gerakan penghuni.
    ESP_ERROR_CHECK(pir_init(NULL));

    // Inisialisasi modul kontrol otomatis sesuai logika inti README:
    // - Auto ON saat ada gerakan (PIR).
    // - Auto OFF jika no-motion kontinu >= 10 menit DAN daya < 10W.
    // Kondisi relay saat boot tidak diubah (lihat relay_init/default_on).
    // Default dari device_profile.h, lalu timpa dengan nilai tersimpan di NVS
    // (bila pernah diubah dari dashboard via command config_update).
    uint32_t auto_pir_sec = AUTO_CONTROL_NO_MOTION_OFF_SEC;
    float auto_thr_w = AUTO_CONTROL_POWER_THRESHOLD_W;
    autocfg_nvs_load(&auto_pir_sec, &auto_thr_w);

    auto_control_config_t auto_cfg = {
        .no_motion_off_delay_sec = auto_pir_sec,
        .power_threshold_w = auto_thr_w,
        .enable_auto_on = true,
        .enable_auto_off = true,
    };
    ESP_LOGI(TAG, "[%s] Konfig auto-control: pir=%lus threshold=%.2fW",
             DEVICE_ID, (unsigned long)auto_pir_sec, auto_thr_w);
    ESP_ERROR_CHECK(auto_control_init(&auto_cfg));

    // Jalankan inisialisasi konektivitas di task terpisah agar pembacaan PZEM tidak terblokir.
    BaseType_t conn_task_ok = xTaskCreate(connectivity_task, "conn_task", 6144, NULL, 5, NULL);
    if (conn_task_ok != pdPASS) {
        ESP_LOGE(TAG, "[%s] Gagal membuat task konektivitas", DEVICE_ID);
    }

    // PZEM sudah dicoba init sejak awal boot, retry tetap dilakukan di loop utama.

    // Loop baca telemetry PZEM periodik (siap diteruskan ke MQTT/InfluxDB).
    while (true) {
        // Fallback re-sync waktu: jika belum sinkron, picu ulang SNTP berkala
        // (~tiap 20 detik). Begitu sinkron, catat sekali lalu berhenti memaksa.
        static uint32_t s_resync_counter = 0;
        static bool s_time_synced_logged = false;
        if (time_sync_is_synced()) {
            if (!s_time_synced_logged) {
                ESP_LOGI(TAG, "[%s] Waktu NTP sudah sinkron", DEVICE_ID);
                s_time_synced_logged = true;
            }
        } else {
            s_time_synced_logged = false;
            if ((++s_resync_counter % 20U) == 0U) {
                time_sync_force_resync();
            }
        }

        // Pemulihan OLED: jika sempat dilepas karena error I2C, coba init ulang
        // berkala (~tiap 5 detik) agar layar otomatis hidup lagi saat koneksi pulih.
        static uint32_t s_oled_retry = 0;
        if (!oled_is_initialized()) {
            if ((++s_oled_retry % 5U) == 0U && oled_init(NULL) == ESP_OK) {
                refresh_oled_from_state();
            }
        }

        if (!pzem_is_initialized()) {
            pzem_ret = pzem_init(NULL);
            if (pzem_ret != ESP_OK) {
                ESP_LOGW(TAG, "[%s] Retry init PZEM gagal: %s", DEVICE_ID, esp_err_to_name(pzem_ret));
                vTaskDelay(pdMS_TO_TICKS(5000));
                continue;
            }
        }

        // PZEM dipasang di sisi beban (setelah relay). Saat relay OFF, PZEM ikut
        // kehilangan daya sehingga pembacaan PASTI timeout — ini kondisi WAJAR,
        // bukan kegagalan sensor. Maka saat relay OFF, PZEM tidak dibaca dan daya
        // dianggap 0. Pembacaan hanya dilakukan saat relay ON (ada aliran listrik).
        pzem_data_t data = {0};
        bool relay_is_on = relay_get_state();
        bool pzem_ok = false;

        if (relay_is_on) {
            pzem_ret = pzem_read_data(&data);
            pzem_ok = (pzem_ret == ESP_OK);

            if (pzem_ok) {
                int64_t sample_ts_ms = 0;
                if (time_sync_get_epoch_ms(&sample_ts_ms) != ESP_OK) { //time stamp untuk telemetry, gunakan time sync jika tersedia, fallback ke uptime jika belum sync
                    sample_ts_ms = esp_timer_get_time() / 1000LL;
                }

                telemetry_power_sample_t sample = {
                    .voltage_v = data.voltage_v,
                    .current_a = data.current_a,
                    .power_w = data.power_w,
                    .energy_wh = data.energy_wh,
                    .frequency_hz = data.frequency_hz,
                    .power_factor = data.power_factor,
                    .alarm_status = data.alarm_status,
                    .ts_ms = sample_ts_ms,
                };

                ESP_LOGI(
                    TAG,
                    "[%s] PZEM V=%.1fV I=%.3fA P=%.1fW E=%.0fWh F=%.1fHz PF=%.2f ALARM=%u",
                    DEVICE_ID,
                    data.voltage_v,
                    data.current_a,
                    data.power_w,
                    data.energy_wh,
                    data.frequency_hz,
                    data.power_factor,
                    data.alarm_status);

                telemetry_buffer_push(&sample);
                s_batch_count++;

                /* Setiap 10 sampel terkumpul (= 10 detik), kirim sekaligus ke server. */
                if (s_batch_count >= TELEMETRY_BATCH_SIZE) {
                    if (mqtt_app_is_connected()) {
                        if (telemetry_buffer_flush() != ESP_OK) {
                            ESP_LOGW(
                                TAG,
                                "[%s] Kirim batch tertunda, antrian=%u sampel",
                                DEVICE_ID,
                                (unsigned)s_telemetry_buffer.count);
                        }
                    }
                    s_batch_count = 0;
                    // Simpan kemajuan counter ke NVS (hemat tulis: hanya saat mendekati batas).
                    ascon_ctr_nvs_maybe_save(ascon_get_tx_counter(&s_ascon));
                }
            } else {
                // Relay ON tapi PZEM tak merespons → ini benar-benar fault sensor/wiring.
                ESP_LOGW(TAG, "[%s] Baca PZEM gagal: %s", DEVICE_ID, esp_err_to_name(pzem_ret));
            }
        } else {
            // Relay OFF → listrik terputus, PZEM memang mati. Tidak dibaca, daya = 0.
            ESP_LOGD(TAG, "[%s] Relay OFF — PZEM tidak dibaca (listrik terputus), daya dianggap 0W", DEVICE_ID);
        }

        // ===== Auto-control + PIR SELALU dievaluasi tiap loop =====
        // Independen dari hasil PZEM, supaya gerakan tetap bisa menyalakan ulang
        // socket walau PZEM sedang tidak bertenaga (relay OFF). Saat PZEM tidak
        // dibaca/ gagal, daya dianggap 0 (relay OFF = tidak ada beban).
        float power_for_ctrl = pzem_ok ? data.power_w : 0.0f;
        bool motion = pir_is_motion_detected();

        device_state_set_wifi_connected(wifi_manager_is_connected());
        device_state_set_mqtt_connected(mqtt_app_is_connected());
        device_state_set_pir_motion(motion);
        device_state_set_relay(relay_is_on);
        device_state_set_last_power(power_for_ctrl);

        // Cek mode aktual device: auto-control HANYA boleh menyentuh relay
        // saat mode OTOMATIS. Di mode MANUAL, kendali penuh ada di user.
        device_state_snapshot_t st_now = {0};
        bool is_auto_mode = (device_state_get_snapshot(&st_now) == ESP_OK &&
                             st_now.mode == DEVICE_WORK_MODE_AUTOMATIC);

        auto_control_decision_t decision = {0};
        // Tetap evaluasi tiap loop agar timer no-motion akurat, tapi terapkan hanya di mode AUTO.
        if (auto_control_evaluate(motion, power_for_ctrl, relay_is_on, &decision) == ESP_OK) {
            esp_err_t relay_ctrl_ret = ESP_OK;

            if (is_auto_mode && decision.action == AUTO_CONTROL_ACTION_RELAY_OFF) {
                relay_ctrl_ret = relay_off();
            } else if (is_auto_mode && decision.action == AUTO_CONTROL_ACTION_RELAY_ON) {
                relay_ctrl_ret = relay_on();
            }

            if (is_auto_mode && decision.action != AUTO_CONTROL_ACTION_NONE) {
                device_state_set_relay(relay_get_state());

                ESP_LOGI(
                    TAG,
                    "[%s] AUTO_CONTROL action=%s reason=%s motion=%u power=%.2fW idle=%llums",
                    DEVICE_ID,
                    auto_control_action_to_string(decision.action),
                    decision.reason,
                    decision.motion_detected,
                    decision.power_w,
                    (unsigned long long)decision.no_motion_elapsed_ms);

                // Publish status relay terbaru setelah aksi otomatis.
                mqtt_app_publish_relay_status(relay_get_state(), -1, false);

                // Publish ACK untuk jejak aksi otomatis di backend/dashboard.
                char auto_id[24] = {0};
                snprintf(auto_id, sizeof(auto_id), "auto-%lu", (unsigned long)++s_ack_seq);

                mqtt_app_publish_ack(
                    auto_id,
                    (relay_ctrl_ret == ESP_OK) ? "ok" : "error",
                    decision.reason,
                    -1,
                    false);
            }

            device_state_set_inactivity_sec((uint32_t)(decision.no_motion_elapsed_ms / 1000ULL));
        }

        refresh_oled_from_state();

        vTaskDelay(pzem_interval_ticks);
    }
}
