#ifndef AUTO_CONTROL_H
#define AUTO_CONTROL_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Referensi resmi implementasi:
 * 1) ESP-IDF High Resolution Timer (esp_timer)
 *    https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/system/esp_timer.html
 * 2) ESP-IDF GPIO API (dasar pembacaan sensor PIR/relay)
 *    https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/gpio.html
 *
 * Catatan:
 * - Logika auto control pada komponen ini adalah business logic kustom project.
 * - Komponen menerima input sensor (motion + power) dan menentukan aksi relay.
 */

typedef enum {
    AUTO_CONTROL_ACTION_NONE = 0,
    AUTO_CONTROL_ACTION_RELAY_ON,
    AUTO_CONTROL_ACTION_RELAY_OFF,
} auto_control_action_t;

typedef struct {
    // Relay hanya boleh OFF jika no-motion >= delay ini.
    uint32_t no_motion_off_delay_sec;

    // Syarat daya untuk auto OFF (contoh 10 watt).
    float power_threshold_w;

    // Enable/disable fitur otomatis.
    bool enable_auto_on;
    bool enable_auto_off;
} auto_control_config_t;

typedef struct {
    auto_control_action_t action;
    bool motion_detected;
    float power_w;

    // Lama tidak ada gerakan kontinu (ms).
    uint64_t no_motion_elapsed_ms;

    // True jika timer no-motion baru saja di-reset karena motion terdeteksi.
    bool timer_reset;

    // Alasan keputusan (untuk log/telemetri).
    const char *reason;
} auto_control_decision_t;

// Inisialisasi modul auto control.
esp_err_t auto_control_init(const auto_control_config_t *config);

// Reset timer no-motion manual (misalnya setelah mode override).
esp_err_t auto_control_reset_no_motion_timer(void);

// Perbarui parameter runtime (delay no-motion & threshold daya) tanpa
// mereset timer no-motion. Dipakai saat menerima command config_update
// dari dashboard. enable_auto_on/off tidak diubah.
esp_err_t auto_control_set_params(uint32_t no_motion_off_delay_sec, float power_threshold_w);

// Evaluasi kondisi saat ini dan keluarkan keputusan aksi relay.
esp_err_t auto_control_evaluate(
    bool motion_detected,
    float power_w,
    bool relay_is_on,
    auto_control_decision_t *out_decision);

// Cek apakah modul sudah diinisialisasi.
bool auto_control_is_initialized(void);

// Utility string untuk log aksi.
const char *auto_control_action_to_string(auto_control_action_t action);

#ifdef __cplusplus
}
#endif

#endif
