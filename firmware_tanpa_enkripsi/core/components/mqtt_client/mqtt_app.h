#ifndef MQTT_APP_H
#define MQTT_APP_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Referensi resmi implementasi:
 * 1) ESP-IDF MQTT API (resmi Espressif)
 *    https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/protocols/mqtt.html
 * 2) Last Will and Testament (MQTT 3.1.1)
 *    OASIS MQTT Version 3.1.1
 *    https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/
 * 3) Topik praktis EMQX untuk telemetri/command
 *    https://www.emqx.com/en/blog/the-easiest-guide-to-getting-started-with-mqtt
 *
 * Catatan:
 * - Kode ini ditulis ulang khusus untuk arsitektur project ini (bukan copy-paste mentah).
 * - Komponen ini bergantung pada wifi_manager: MQTT start menunggu Wi-Fi connected.
 */

typedef struct {
    // Contoh: "mqtt://167.71.195.81:1883" atau "mqtts://...:8883"
    const char *broker_uri;

    // Kredensial login ke broker EMQX.
    const char *username;
    const char *password;
    const char *client_id;

    // Identitas device untuk payload dan topic default.
    const char *device_id;

    // Topic aplikasi (wajib diisi agar perilaku eksplisit).
    const char *topic_command;
    const char *topic_telemetry;
    const char *topic_relay_status;
    const char *topic_ack;

    // Last Will Testament dipublish broker saat client putus tidak normal.
    const char *lwt_topic;
    const char *lwt_payload;
    int lwt_qos;
    bool lwt_retain;

    // Timeout menunggu Wi-Fi ready sebelum start MQTT.
    uint32_t wifi_wait_timeout_ms;

    // QoS default untuk publish telemetry/status/ack.
    int default_qos;
} mqtt_app_config_t;

typedef void (*mqtt_command_cb_t)(
    const char *topic,
    const uint8_t *payload,
    size_t payload_len,
    void *user_ctx);

// Inisialisasi konfigurasi MQTT client aplikasi.
esp_err_t mqtt_app_init(
    const mqtt_app_config_t *config,
    mqtt_command_cb_t command_cb,
    void *user_ctx);

// Start client MQTT: tunggu Wi-Fi lalu connect ke broker EMQX.
esp_err_t mqtt_app_start(void);

// Stop koneksi MQTT dan task internal client.
esp_err_t mqtt_app_stop(void);

// Cek status koneksi MQTT saat ini.
bool mqtt_app_is_connected(void);

// Publish payload telemetry sensor (umumnya JSON).
esp_err_t mqtt_app_publish_telemetry(const char *payload, int qos, bool retain);

// Publish status relay ON/OFF dalam format status JSON terpadu.
esp_err_t mqtt_app_publish_relay_status(bool relay_on, int qos, bool retain);

// Publish status konektivitas device (ONLINE/OFFLINE) pada topic status.
esp_err_t mqtt_app_publish_device_status(bool online, int qos, bool retain);

// Publish ACK command dalam format JSON sederhana.
esp_err_t mqtt_app_publish_ack(const char *command_id, const char *status, const char *message, int qos, bool retain);

// Expose topic command aktif untuk membantu modul lain.
const char *mqtt_app_get_command_topic(void);

#ifdef __cplusplus
}
#endif

#endif
