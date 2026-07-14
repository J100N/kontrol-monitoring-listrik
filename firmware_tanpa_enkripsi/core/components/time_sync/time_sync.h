#ifndef TIME_SYNC_H
#define TIME_SYNC_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define TIME_SYNC_DEFAULT_TIMEOUT_MS 5000U

typedef struct {
    const char *primary_ntp_server;
    const char *secondary_ntp_server;
    const char *timezone;
    uint32_t wait_timeout_ms;
} time_sync_config_t;

// Inisialisasi SNTP dan konfigurasi timezone.
// Bila config NULL, gunakan default aman untuk produksi awal.
esp_err_t time_sync_init(const time_sync_config_t *config);

// Menunggu hingga waktu epoch valid tersinkron dari NTP.
// timeout_ms = 0 akan memakai nilai default dari konfigurasi saat init.
esp_err_t time_sync_wait_for_sync(uint32_t timeout_ms);

// Cek apakah waktu sistem sudah valid (di atas ambang epoch minimum).
bool time_sync_is_synced(void);

// Picu ulang SNTP agar segera mencoba query NTP baru (tanpa menunggu interval
// poll bawaan yang lama). Dipakai saat WiFi baru tersambung atau saat waktu
// masih belum sinkron. Aman dipanggil berkali-kali; no-op jika sudah sinkron.
esp_err_t time_sync_force_resync(void);

// Ambil waktu epoch dalam milidetik.
// Mengembalikan ESP_ERR_INVALID_STATE jika waktu belum tersinkron.
esp_err_t time_sync_get_epoch_ms(int64_t *out_epoch_ms);

// Stop SNTP (jarang dipakai, disediakan untuk lifecycle yang rapi).
esp_err_t time_sync_deinit(void);

#ifdef __cplusplus
}
#endif

#endif
