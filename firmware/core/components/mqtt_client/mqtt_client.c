#include "mqtt_app.h"

#include <stdio.h>
#include <string.h>

#include "esp_check.h"
#include "esp_log.h"
#include "wifi_manager.h"
#include <mqtt_client.h>

#define MQTT_ACK_BUF_SIZE 256
#define MQTT_RELAY_BUF_SIZE 96

static const char *TAG = "mqtt_app";

static bool s_initialized = false;
static bool s_started = false;
static bool s_connected = false;

static mqtt_app_config_t s_cfg = {0};
static esp_mqtt_client_handle_t s_client = NULL;
static mqtt_command_cb_t s_command_cb = NULL;
static void *s_user_ctx = NULL;

static esp_err_t mqtt_app_validate_config(const mqtt_app_config_t *cfg)
{
	ESP_RETURN_ON_FALSE(cfg != NULL, ESP_ERR_INVALID_ARG, TAG, "config null");
	ESP_RETURN_ON_FALSE(cfg->broker_uri != NULL && strlen(cfg->broker_uri) > 0, ESP_ERR_INVALID_ARG, TAG, "broker_uri kosong");
	ESP_RETURN_ON_FALSE(cfg->device_id != NULL && strlen(cfg->device_id) > 0, ESP_ERR_INVALID_ARG, TAG, "device_id kosong");
	ESP_RETURN_ON_FALSE(cfg->topic_command != NULL && strlen(cfg->topic_command) > 0, ESP_ERR_INVALID_ARG, TAG, "topic_command kosong");
	ESP_RETURN_ON_FALSE(cfg->topic_telemetry != NULL && strlen(cfg->topic_telemetry) > 0, ESP_ERR_INVALID_ARG, TAG, "topic_telemetry kosong");
	ESP_RETURN_ON_FALSE(cfg->topic_relay_status != NULL && strlen(cfg->topic_relay_status) > 0, ESP_ERR_INVALID_ARG, TAG, "topic_relay_status kosong");
	ESP_RETURN_ON_FALSE(cfg->topic_ack != NULL && strlen(cfg->topic_ack) > 0, ESP_ERR_INVALID_ARG, TAG, "topic_ack kosong");

	if (cfg->default_qos < 0 || cfg->default_qos > 2) {
		ESP_LOGE(TAG, "default_qos harus 0..2");
		return ESP_ERR_INVALID_ARG;
	}

	if (cfg->lwt_qos < 0 || cfg->lwt_qos > 2) {
		ESP_LOGE(TAG, "lwt_qos harus 0..2");
		return ESP_ERR_INVALID_ARG;
	}

	return ESP_OK;
}

static int mqtt_app_publish_raw(const char *topic, const char *payload, int qos, bool retain)
{
	if (qos < 0) {
		qos = s_cfg.default_qos;
	}

	int msg_id = esp_mqtt_client_publish(
		s_client,
		topic,
		payload,
		0,
		qos,
		retain ? 1 : 0);

	return msg_id;
}

static void mqtt_app_handle_data_event(const esp_mqtt_event_t *event)
{
	if (event == NULL || event->topic == NULL || event->data == NULL) {
		return;
	}

	// Copy topic/data karena buffer event tidak selalu null-terminated.
	char topic_buf[256] = {0};
	int topic_len = event->topic_len;
	if (topic_len >= (int)sizeof(topic_buf)) {
		topic_len = (int)sizeof(topic_buf) - 1;
	}
	memcpy(topic_buf, event->topic, (size_t)topic_len);

	if (strcmp(topic_buf, s_cfg.topic_command) != 0) {
		return;
	}

	ESP_LOGI(TAG, "command masuk topic=%s len=%d", topic_buf, event->data_len);

	if (s_command_cb != NULL) {
		s_command_cb((const char *)topic_buf, (const uint8_t *)event->data, (size_t)event->data_len, s_user_ctx);
	}
}

static void mqtt_app_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
	(void)handler_args;
	(void)base;

	esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;
	if (event == NULL) {
		return;
	}

	switch ((esp_mqtt_event_id_t)event_id) {
	case MQTT_EVENT_CONNECTED:
		s_connected = true;
		ESP_LOGI(TAG, "MQTT connected ke broker");

		// Subscribe command otomatis setelah konek.
		if (esp_mqtt_client_subscribe(s_client, s_cfg.topic_command, 1) < 0) {
			ESP_LOGE(TAG, "subscribe command gagal: %s", s_cfg.topic_command);
		} else {
			ESP_LOGI(TAG, "subscribe command ok: %s", s_cfg.topic_command);
		}
		break;

	case MQTT_EVENT_DISCONNECTED:
		s_connected = false;
		ESP_LOGW(TAG, "MQTT disconnected");

		// Auto reconnect utama ditangani internal client ESP-IDF.
		// Fallback manual dipanggil jika Wi-Fi masih connected.
		if (wifi_manager_is_connected()) {
			esp_err_t r = esp_mqtt_client_reconnect(s_client);
			if (r != ESP_OK && r != ESP_FAIL) {
				ESP_LOGW(TAG, "reconnect manual status: %s", esp_err_to_name(r));
			}
		}
		break;

	case MQTT_EVENT_DATA:
		mqtt_app_handle_data_event(event);
		break;

	case MQTT_EVENT_ERROR:
		ESP_LOGE(TAG, "MQTT event error");
		break;

	case MQTT_EVENT_SUBSCRIBED:
	case MQTT_EVENT_PUBLISHED:
	case MQTT_EVENT_BEFORE_CONNECT:
	case MQTT_EVENT_UNSUBSCRIBED:
	default:
		break;
	}
}

esp_err_t mqtt_app_init(const mqtt_app_config_t *config, mqtt_command_cb_t command_cb, void *user_ctx)
{
	ESP_RETURN_ON_ERROR(mqtt_app_validate_config(config), TAG, "config MQTT tidak valid");

	if (s_initialized) {
		ESP_LOGW(TAG, "mqtt_app sudah init, skip init ulang");
		return ESP_OK;
	}

	s_cfg = *config;
	s_command_cb = command_cb;
	s_user_ctx = user_ctx;

	s_initialized = true;
	s_started = false;
	s_connected = false;

	ESP_LOGI(TAG, "mqtt_app init ok broker=%s", s_cfg.broker_uri);
	return ESP_OK;
}

esp_err_t mqtt_app_start(void)
{
	ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "mqtt_app belum init");

	if (s_started) {
		ESP_LOGW(TAG, "mqtt_app sudah start");
		return ESP_OK;
	}

	// Tunggu Wi-Fi sebentar (best-effort), TAPI JANGAN gagal permanen kalau WiFi
	// telat konek. Dulu di sini pakai ESP_RETURN_ON_ERROR → mqtt_app_start gagal →
	// task boot bunuh diri (vTaskDelete) → MQTT TIDAK PERNAH start lagi walau WiFi
	// kemudian tersambung (gejala: "WiFi konek, MQTT tidak").
	//
	// Perbaikan: client MQTT TETAP di-start. esp-mqtt auto-reconnect (aktif) akan
	// menyambung ke broker begitu WiFi/IP tersedia — tanpa menambah mekanisme
	// reconnect baru (tidak tumpang tindih).
	if (!wifi_manager_is_connected()) {
		uint32_t timeout_ms = (s_cfg.wifi_wait_timeout_ms == 0U) ? 15000U : s_cfg.wifi_wait_timeout_ms;
		if (wifi_manager_wait_until_connected(timeout_ms) != ESP_OK) {
			ESP_LOGW(TAG, "Wi-Fi belum siap; MQTT tetap di-start, auto-reconnect menyambung saat WiFi tersedia");
		}
	}

	esp_mqtt_client_config_t mqtt_cfg = {
		.broker.address.uri = s_cfg.broker_uri,
		.credentials.username = s_cfg.username,
		.credentials.authentication.password = s_cfg.password,
		.credentials.client_id = s_cfg.client_id,
		.session.last_will.topic = s_cfg.lwt_topic,
		.session.last_will.msg = s_cfg.lwt_payload,
		.session.last_will.msg_len = (s_cfg.lwt_payload != NULL) ? (int)strlen(s_cfg.lwt_payload) : 0,
		.session.last_will.qos = s_cfg.lwt_qos,
		.session.last_will.retain = s_cfg.lwt_retain ? 1 : 0,
		.session.keepalive = 60,
		.network.disable_auto_reconnect = false,
		.network.reconnect_timeout_ms = 5000,
		// Buffer 4096 byte: payload telemetry batch (10 sampel) ~2.2 KB tidak muat di
		// default 1024 byte. Tanpa ini, publish batch gagal/terpotong (data tak sampai server).
		.buffer.size = 4096,
	};

	s_client = esp_mqtt_client_init(&mqtt_cfg);
	ESP_RETURN_ON_FALSE(s_client != NULL, ESP_FAIL, TAG, "esp_mqtt_client_init gagal");

	ESP_RETURN_ON_ERROR(
		esp_mqtt_client_register_event(s_client, MQTT_EVENT_ANY, mqtt_app_event_handler, NULL),
		TAG,
		"register event MQTT gagal");

	ESP_RETURN_ON_ERROR(esp_mqtt_client_start(s_client), TAG, "start MQTT client gagal");

	s_started = true;
	ESP_LOGI(TAG, "mqtt_app start ok");

	return ESP_OK;
}

esp_err_t mqtt_app_stop(void)
{
	ESP_RETURN_ON_FALSE(s_initialized, ESP_ERR_INVALID_STATE, TAG, "mqtt_app belum init");

	if (!s_started || s_client == NULL) {
		return ESP_OK;
	}

	esp_mqtt_client_stop(s_client);
	esp_mqtt_client_destroy(s_client);
	s_client = NULL;

	s_started = false;
	s_connected = false;

	return ESP_OK;
}

bool mqtt_app_is_connected(void)
{
	return s_connected;
}

esp_err_t mqtt_app_publish_telemetry(const char *payload, int qos, bool retain)
{
	ESP_RETURN_ON_FALSE(s_started && s_client != NULL, ESP_ERR_INVALID_STATE, TAG, "MQTT belum start");
	ESP_RETURN_ON_FALSE(payload != NULL, ESP_ERR_INVALID_ARG, TAG, "payload telemetry null");

	int msg_id = mqtt_app_publish_raw(s_cfg.topic_telemetry, payload, qos, retain);
	ESP_RETURN_ON_FALSE(msg_id >= 0, ESP_FAIL, TAG, "publish telemetry gagal");

	return ESP_OK;
}

esp_err_t mqtt_app_publish_relay_status(bool relay_on, int qos, bool retain)
{
	ESP_RETURN_ON_FALSE(s_started && s_client != NULL, ESP_ERR_INVALID_STATE, TAG, "MQTT belum start");

	char payload[MQTT_RELAY_BUF_SIZE] = {0};
	int n = snprintf(
		payload,
		sizeof(payload),
		"{\"device_id\":\"%s\",\"status_type\":\"relay\",\"status\":\"%s\"}",
		s_cfg.device_id,
		relay_on ? "ON" : "OFF");
	ESP_RETURN_ON_FALSE(n > 0 && n < (int)sizeof(payload), ESP_ERR_INVALID_SIZE, TAG, "payload relay kepanjangan");

	int msg_id = mqtt_app_publish_raw(s_cfg.topic_relay_status, payload, qos, retain);
	ESP_RETURN_ON_FALSE(msg_id >= 0, ESP_FAIL, TAG, "publish relay status gagal");

	return ESP_OK;
}

esp_err_t mqtt_app_publish_device_status(bool online, int qos, bool retain)
{
	ESP_RETURN_ON_FALSE(s_started && s_client != NULL, ESP_ERR_INVALID_STATE, TAG, "MQTT belum start");
	ESP_RETURN_ON_FALSE(s_cfg.lwt_topic != NULL && strlen(s_cfg.lwt_topic) > 0, ESP_ERR_INVALID_STATE, TAG, "topic status kosong");

	char payload[MQTT_RELAY_BUF_SIZE] = {0};
	int n = snprintf(
		payload,
		sizeof(payload),
		"{\"device_id\":\"%s\",\"status_type\":\"connectivity\",\"status\":\"%s\"}",
		s_cfg.device_id,
		online ? "ONLINE" : "OFFLINE");
	ESP_RETURN_ON_FALSE(n > 0 && n < (int)sizeof(payload), ESP_ERR_INVALID_SIZE, TAG, "payload status device kepanjangan");

	int msg_id = mqtt_app_publish_raw(s_cfg.lwt_topic, payload, qos, retain);
	ESP_RETURN_ON_FALSE(msg_id >= 0, ESP_FAIL, TAG, "publish status device gagal");

	return ESP_OK;
}

esp_err_t mqtt_app_publish_ack(const char *command_id, const char *status, const char *message, int qos, bool retain)
{
	ESP_RETURN_ON_FALSE(s_started && s_client != NULL, ESP_ERR_INVALID_STATE, TAG, "MQTT belum start");
	ESP_RETURN_ON_FALSE(command_id != NULL && status != NULL, ESP_ERR_INVALID_ARG, TAG, "command_id/status wajib");

	const char *safe_msg = (message != NULL) ? message : "";

	char payload[MQTT_ACK_BUF_SIZE] = {0};
	int n = snprintf(
		payload,
		sizeof(payload),
		"{\"device_id\":\"%s\",\"command_id\":\"%s\",\"status\":\"%s\",\"message\":\"%s\"}",
		s_cfg.device_id,
		command_id,
		status,
		safe_msg);
	ESP_RETURN_ON_FALSE(n > 0 && n < (int)sizeof(payload), ESP_ERR_INVALID_SIZE, TAG, "payload ack kepanjangan");

	int msg_id = mqtt_app_publish_raw(s_cfg.topic_ack, payload, qos, retain);
	ESP_RETURN_ON_FALSE(msg_id >= 0, ESP_FAIL, TAG, "publish ack gagal");

	return ESP_OK;
}

const char *mqtt_app_get_command_topic(void)
{
	if (!s_initialized) {
		return NULL;
	}
	return s_cfg.topic_command;
}
