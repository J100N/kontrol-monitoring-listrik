 #include "device_state.h"

 #include <stdio.h>
 #include <string.h>

 #include "esp_check.h"
 #include "esp_timer.h"
 #include "freertos/FreeRTOS.h"
 #include "freertos/semphr.h"

 static const char *TAG = "device_state";

 static bool s_initialized = false;
 static SemaphoreHandle_t s_state_mutex = NULL;
 static device_state_snapshot_t s_state = {0};
 static int64_t s_last_motion_us = 0;

 static esp_err_t device_state_lock(TickType_t timeout_ticks)
 {
	 ESP_RETURN_ON_FALSE(s_state_mutex != NULL, ESP_ERR_INVALID_STATE, TAG, "mutex belum siap");
	 if (xSemaphoreTake(s_state_mutex, timeout_ticks) != pdTRUE) {
		 return ESP_ERR_TIMEOUT;
	 }
	 return ESP_OK;
 }

 static void device_state_unlock(void)
 {
	 if (s_state_mutex != NULL) {
		 xSemaphoreGive(s_state_mutex);
	 }
 }

 static void device_state_reset_locked(void)
 {
	 memset(&s_state, 0, sizeof(s_state));
	 s_state.mode = DEVICE_WORK_MODE_AUTOMATIC;
	 s_state.device_online = true;
	 s_last_motion_us = esp_timer_get_time();
 }

 esp_err_t device_state_init(void)
 {
	 if (s_initialized) {
		 return ESP_OK;
	 }

	 s_state_mutex = xSemaphoreCreateMutex();
	 ESP_RETURN_ON_FALSE(s_state_mutex != NULL, ESP_ERR_NO_MEM, TAG, "gagal buat mutex");

	 if (device_state_lock(pdMS_TO_TICKS(100)) != ESP_OK) {
		 vSemaphoreDelete(s_state_mutex);
		 s_state_mutex = NULL;
		 return ESP_ERR_TIMEOUT;
	 }

	 device_state_reset_locked();
	 device_state_unlock();

	 s_initialized = true;
	 return ESP_OK;
 }

 esp_err_t device_state_reset(void)
 {
	 ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "device_state belum init");
	 ESP_RETURN_ON_ERROR(device_state_lock(pdMS_TO_TICKS(100)), TAG, "gagal lock reset");
	 device_state_reset_locked();
	 device_state_unlock();
	 return ESP_OK;
 }

 bool device_state_is_initialized(void)
 {
	 return s_initialized;
 }

 esp_err_t device_state_set_device_online(bool online)
 {
	 ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "device_state belum init");
	 ESP_RETURN_ON_ERROR(device_state_lock(pdMS_TO_TICKS(100)), TAG, "gagal lock online");
	 s_state.device_online = online;
	 device_state_unlock();
	 return ESP_OK;
 }

 esp_err_t device_state_set_wifi_connected(bool connected)
 {
	 ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "device_state belum init");
	 ESP_RETURN_ON_ERROR(device_state_lock(pdMS_TO_TICKS(100)), TAG, "gagal lock wifi");
	 s_state.wifi_connected = connected;
	 device_state_unlock();
	 return ESP_OK;
 }

 esp_err_t device_state_set_mqtt_connected(bool connected)
 {
	 ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "device_state belum init");
	 ESP_RETURN_ON_ERROR(device_state_lock(pdMS_TO_TICKS(100)), TAG, "gagal lock mqtt");
	 s_state.mqtt_connected = connected;
	 device_state_unlock();
	 return ESP_OK;
 }

 esp_err_t device_state_set_mode(device_work_mode_t mode)
 {
	 ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "device_state belum init");
	 ESP_RETURN_ON_FALSE(
		 mode == DEVICE_WORK_MODE_MANUAL || mode == DEVICE_WORK_MODE_AUTOMATIC,
		 ESP_ERR_INVALID_ARG,
		 TAG,
		 "mode tidak valid");

	 ESP_RETURN_ON_ERROR(device_state_lock(pdMS_TO_TICKS(100)), TAG, "gagal lock mode");
	 s_state.mode = mode;
	 device_state_unlock();
	 return ESP_OK;
 }

 esp_err_t device_state_set_relay(bool relay_on)
 {
	 ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "device_state belum init");
	 ESP_RETURN_ON_ERROR(device_state_lock(pdMS_TO_TICKS(100)), TAG, "gagal lock relay");
	 s_state.relay_on = relay_on;
	 device_state_unlock();
	 return ESP_OK;
 }

 esp_err_t device_state_set_pir_motion(bool motion)
 {
	 ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "device_state belum init");
	 ESP_RETURN_ON_ERROR(device_state_lock(pdMS_TO_TICKS(100)), TAG, "gagal lock pir");

	 s_state.pir_motion = motion;
	 if (motion) {
		 s_last_motion_us = esp_timer_get_time();
		 s_state.inactivity_sec = 0;
	 }

	 device_state_unlock();
	 return ESP_OK;
 }

 esp_err_t device_state_set_last_power(float power_w)
 {
	 ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "device_state belum init");
	 ESP_RETURN_ON_ERROR(device_state_lock(pdMS_TO_TICKS(100)), TAG, "gagal lock power");
	 s_state.last_power_w = power_w;
	 device_state_unlock();
	 return ESP_OK;
 }

 esp_err_t device_state_set_inactivity_sec(uint32_t inactivity_sec)
 {
	 ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "device_state belum init");
	 ESP_RETURN_ON_ERROR(device_state_lock(pdMS_TO_TICKS(100)), TAG, "gagal lock inactivity");
	 s_state.inactivity_sec = inactivity_sec;
	 device_state_unlock();
	 return ESP_OK;
 }

 esp_err_t device_state_get_snapshot(device_state_snapshot_t *out_snapshot)
 {
	 ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "device_state belum init");
	 ESP_RETURN_ON_FALSE(out_snapshot != NULL, ESP_ERR_INVALID_ARG, TAG, "out_snapshot null");
	 ESP_RETURN_ON_ERROR(device_state_lock(pdMS_TO_TICKS(100)), TAG, "gagal lock snapshot");

	 *out_snapshot = s_state;
	 if (!s_state.pir_motion) {
		 int64_t now_us = esp_timer_get_time();
		 int64_t delta_us = now_us - s_last_motion_us;
		 if (delta_us > 0) {
			 out_snapshot->inactivity_sec = (uint32_t)(delta_us / 1000000LL);
		 }
	 }

	 device_state_unlock();
	 return ESP_OK;
 }

 const char *device_state_mode_to_string(device_work_mode_t mode)
 {
	 return (mode == DEVICE_WORK_MODE_MANUAL) ? "MANUAL" : "AUTO";
 }

 esp_err_t device_state_format_oled_lines(
	 const device_state_snapshot_t *snapshot,
	 char lines[DEVICE_STATE_OLED_MAX_LINES][DEVICE_STATE_OLED_LINE_LEN])
 {
	 ESP_RETURN_ON_FALSE(snapshot != NULL, ESP_ERR_INVALID_ARG, TAG, "snapshot null");
	 ESP_RETURN_ON_FALSE(lines != NULL, ESP_ERR_INVALID_ARG, TAG, "lines null");

	 snprintf(lines[0], DEVICE_STATE_OLED_LINE_LEN, "DEV:%s", snapshot->device_online ? "ONLINE" : "OFFLINE");
	 snprintf(
		 lines[1],
		 DEVICE_STATE_OLED_LINE_LEN,
		 "WIFI:%s MQTT:%s",
		 snapshot->wifi_connected ? "OK" : "OFF",
		 snapshot->mqtt_connected ? "OK" : "OFF");
	 snprintf(lines[2], DEVICE_STATE_OLED_LINE_LEN, "RELAY:%s", snapshot->relay_on ? "ON" : "OFF");
	 snprintf(lines[3], DEVICE_STATE_OLED_LINE_LEN, "MODE:%s", device_state_mode_to_string(snapshot->mode));
	 snprintf(lines[4], DEVICE_STATE_OLED_LINE_LEN, "PIR:%s", snapshot->pir_motion ? "MOTION" : "IDLE");
	 snprintf(lines[5], DEVICE_STATE_OLED_LINE_LEN, "PWR:%.1fW", snapshot->last_power_w);
	 snprintf(lines[6], DEVICE_STATE_OLED_LINE_LEN, "INACT:%lus", (unsigned long)snapshot->inactivity_sec);
	 snprintf(lines[7], DEVICE_STATE_OLED_LINE_LEN, "CTRL:MAN/AUTO READY");

	 return ESP_OK;
 }
