#include "time_sync.h"

#include <string.h>
#include <sys/time.h>
#include <time.h>

#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/apps/sntp.h"

// Ambang epoch minimum untuk menganggap waktu sistem sudah valid.
#define TIME_SYNC_MIN_VALID_EPOCH_SEC 1704067200LL // 2024-01-01 00:00:00 UTC
#define TIME_SYNC_DEFAULT_PRIMARY_NTP "pool.ntp.org"
#define TIME_SYNC_DEFAULT_SECONDARY_NTP "time.google.com"
#define TIME_SYNC_DEFAULT_TIMEZONE "WIB-7"
#define TIME_SYNC_POLL_INTERVAL_MS 200U

static const char *TAG = "time_sync";

static bool s_initialized = false;
// Konfigurasi runtime aktif. Dapat dioverride saat time_sync_init(config).
static time_sync_config_t s_cfg = {
    .primary_ntp_server = TIME_SYNC_DEFAULT_PRIMARY_NTP,
    .secondary_ntp_server = TIME_SYNC_DEFAULT_SECONDARY_NTP,
    .timezone = TIME_SYNC_DEFAULT_TIMEZONE,
    .wait_timeout_ms = TIME_SYNC_DEFAULT_TIMEOUT_MS,
};

static bool time_sync_epoch_is_valid(time_t epoch_sec)
{
    return epoch_sec >= TIME_SYNC_MIN_VALID_EPOCH_SEC;
}

bool time_sync_is_synced(void)
{
    // time() membaca epoch sistem yang diperbarui SNTP.
    time_t now = 0;
    time(&now);
    return time_sync_epoch_is_valid(now);
}

esp_err_t time_sync_wait_for_sync(uint32_t timeout_ms)
{
    ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "time_sync belum init");

    // Jika timeout input 0, gunakan timeout default dari konfigurasi komponen.
    uint32_t effective_timeout_ms = (timeout_ms > 0U) ? timeout_ms : s_cfg.wait_timeout_ms;
    uint32_t waited_ms = 0U;

    // Poll ringan sampai epoch valid atau timeout tercapai.
    while (!time_sync_is_synced() && waited_ms < effective_timeout_ms) {
        vTaskDelay(pdMS_TO_TICKS(TIME_SYNC_POLL_INTERVAL_MS));
        waited_ms += TIME_SYNC_POLL_INTERVAL_MS;
    }

    return time_sync_is_synced() ? ESP_OK : ESP_ERR_TIMEOUT;
}

esp_err_t time_sync_force_resync(void)
{
    ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "time_sync belum init");

    // Sudah sinkron: tidak perlu memaksa query ulang.
    if (time_sync_is_synced()) {
        return ESP_OK;
    }

    // Restart SNTP: stop lalu init lagi memaksa ronde query NTP baru segera,
    // alih-alih menunggu interval retry/poll bawaan lwIP yang bisa lama.
    if (sntp_enabled()) {
        sntp_stop();
    }
    sntp_init();

    ESP_LOGI(TAG, "force resync SNTP dipicu (waktu masih belum valid)");
    return ESP_OK;
}

esp_err_t time_sync_get_epoch_ms(int64_t *out_epoch_ms)
{
    ESP_RETURN_ON_FALSE(out_epoch_ms != NULL, ESP_ERR_INVALID_ARG, TAG, "out_epoch_ms null");

    // gettimeofday dipakai agar timestamp telemetry memiliki resolusi milidetik.
    struct timeval tv = {0};
    ESP_RETURN_ON_FALSE(gettimeofday(&tv, NULL) == 0, ESP_FAIL, TAG, "gettimeofday gagal");

    time_t epoch_sec = tv.tv_sec;
    ESP_RETURN_ON_FALSE(time_sync_epoch_is_valid(epoch_sec), ESP_ERR_INVALID_STATE, TAG, "waktu belum sync");

    *out_epoch_ms = ((int64_t)tv.tv_sec * 1000LL) + ((int64_t)tv.tv_usec / 1000LL);
    return ESP_OK;
}

esp_err_t time_sync_init(const time_sync_config_t *config)
{
    if (s_initialized) {
        return ESP_OK;
    }

    if (config != NULL) {
        s_cfg = *config;
    }

    // Normalisasi konfigurasi agar field kosong tetap aman dipakai.
    if (s_cfg.primary_ntp_server == NULL || s_cfg.primary_ntp_server[0] == '\0') {
        s_cfg.primary_ntp_server = TIME_SYNC_DEFAULT_PRIMARY_NTP;
    }
    if (s_cfg.secondary_ntp_server == NULL || s_cfg.secondary_ntp_server[0] == '\0') {
        s_cfg.secondary_ntp_server = TIME_SYNC_DEFAULT_SECONDARY_NTP;
    }
    if (s_cfg.timezone == NULL || s_cfg.timezone[0] == '\0') {
        s_cfg.timezone = TIME_SYNC_DEFAULT_TIMEZONE;
    }
    if (s_cfg.wait_timeout_ms == 0U) {
        s_cfg.wait_timeout_ms = TIME_SYNC_DEFAULT_TIMEOUT_MS;
    }

    // Set timezone sebelum SNTP aktif agar formatting waktu lokal konsisten.
    setenv("TZ", s_cfg.timezone, 1);
    tzset();

    // Inisialisasi SNTP mode polling dengan 2 server untuk failover.
    sntp_setoperatingmode(SNTP_OPMODE_POLL);
    sntp_setservername(0, (char *)s_cfg.primary_ntp_server);
    sntp_setservername(1, (char *)s_cfg.secondary_ntp_server);

    if (sntp_enabled()) {
        sntp_stop();
    }

    sntp_init();
    s_initialized = true;

    ESP_LOGI(
        TAG,
        "time_sync init ok (ntp1=%s ntp2=%s tz=%s timeout=%lu ms)",
        s_cfg.primary_ntp_server,
        s_cfg.secondary_ntp_server,
        s_cfg.timezone,
        (unsigned long)s_cfg.wait_timeout_ms);

    return ESP_OK;
}

esp_err_t time_sync_deinit(void)
{
    if (!s_initialized) {
        return ESP_OK;
    }

    // Stop SNTP agar task/background sync dilepas secara bersih.
    if (sntp_enabled()) {
        sntp_stop();
    }

    s_initialized = false;
    return ESP_OK;
}
