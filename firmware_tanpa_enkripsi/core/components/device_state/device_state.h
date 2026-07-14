 #ifndef DEVICE_STATE_H
 #define DEVICE_STATE_H

 #include <stdbool.h>
 #include <stddef.h>
 #include <stdint.h>

 #include "esp_err.h"

 #ifdef __cplusplus
 extern "C" {
 #endif

 #define DEVICE_STATE_OLED_MAX_LINES 8
 #define DEVICE_STATE_OLED_LINE_LEN 22

 typedef enum {
	 DEVICE_WORK_MODE_MANUAL = 0,
	 DEVICE_WORK_MODE_AUTOMATIC,
 } device_work_mode_t;

 typedef struct {
	 bool relay_on;
	 device_work_mode_t mode;
	 bool pir_motion;
	 bool device_online;
	 bool wifi_connected;
	 bool mqtt_connected;
	 float last_power_w;
	 uint32_t inactivity_sec;
 } device_state_snapshot_t;

 // Inisialisasi state perangkat dan timer internal.
 esp_err_t device_state_init(void);

 // Mereset state ke nilai awal aman.
 esp_err_t device_state_reset(void);

 // Cek apakah modul state sudah siap dipakai.
 bool device_state_is_initialized(void);

 // Update status konektivitas dan online state.
 esp_err_t device_state_set_device_online(bool online);
 esp_err_t device_state_set_wifi_connected(bool connected);
 esp_err_t device_state_set_mqtt_connected(bool connected);

 // Update mode kerja serta status relay.
 esp_err_t device_state_set_mode(device_work_mode_t mode);
 esp_err_t device_state_set_relay(bool relay_on);

 // Update status PIR. Saat motion=true, timer inactivity otomatis direset.
 esp_err_t device_state_set_pir_motion(bool motion);

 // Update nilai daya terakhir dari PZEM.
 esp_err_t device_state_set_last_power(float power_w);

 // Update timer inactivity dari hasil evaluasi auto-control (detik).
 esp_err_t device_state_set_inactivity_sec(uint32_t inactivity_sec);

 // Ambil snapshot atomik seluruh state untuk ditampilkan/dikirim.
 esp_err_t device_state_get_snapshot(device_state_snapshot_t *out_snapshot);

 // Konversi mode enum ke string singkat (MANUAL/AUTO).
 const char *device_state_mode_to_string(device_work_mode_t mode);

 // Bentuk 8 baris status siap tampil OLED (maks 21 char/baris + null).
 esp_err_t device_state_format_oled_lines(
	 const device_state_snapshot_t *snapshot,
	 char lines[DEVICE_STATE_OLED_MAX_LINES][DEVICE_STATE_OLED_LINE_LEN]);

 #ifdef __cplusplus
 }
 #endif

 #endif
