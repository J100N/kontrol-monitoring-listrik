#ifndef DEVICE_PROFILE_H
#define DEVICE_PROFILE_H

#define DEVICE_ID "smart_socket"
#define WIFI_STA_SSID "nama_wifi"
#define WIFI_STA_PASSWORD "GANTI_PASSWORD_WIFI"
#define WIFI_MAX_RETRY 10U

// ============================================================================
// HANYA untuk pengujian keamanan "kondisi TANPA enkripsi".
//   0 = PRODUKSI (DEFAULT): perintah WAJIB terenkripsi ASCON-AEAD128.
//   1 = EKSPERIMEN: perangkat menerima perintah PLAINTEXT tanpa verifikasi apa pun
//       (untuk mengumpulkan data baseline injeksi/replay/tampering di TA).
// Cara pakai: set 1 -> build -> flash -> kumpulkan data serangan; lalu KEMBALIKAN
// ke 0 dan flash ulang agar perangkat kembali ke sistem produksi. JANGAN deploy
// nyata dengan nilai 1.
// ============================================================================
#ifndef EXPERIMENT_NO_ENCRYPTION
#define EXPERIMENT_NO_ENCRYPTION 0
#endif

// Konfigurasi broker MQTT (EMQX) untuk device ini.
#define MQTT_BROKER_URI "mqtt://167.71.195.81:1883"
#define MQTT_USERNAME "dev_socket_01"
#define MQTT_PASSWORD "ganti_password_mqtt"
#define MQTT_CLIENT_ID DEVICE_ID

// Topik command/telemetry/status/ack per-device.
#define MQTT_TOPIC_COMMAND "devices/smart_socket/command"
#define MQTT_TOPIC_TELEMETRY "devices/smart_socket/telemetry"
#define MQTT_TOPIC_RELAY_STATUS "devices/smart_socket/relay/status"
#define MQTT_TOPIC_ACK "devices/smart_socket/ack"
#define MQTT_TOPIC_LWT "devices/smart_socket/status"

// Last Will payload saat device terputus tidak normal.
#define MQTT_LWT_PAYLOAD "{\"device_id\":\"" DEVICE_ID "\",\"status_type\":\"connectivity\",\"status\":\"OFFLINE\"}"

// Konfigurasi kunci simetris ASCON-128 (16 byte).
// TODO produksi: pindahkan key ke secure provisioning/NVS, jangan hardcode source.
#define ASCON_KEY_ID 1U
#define ASCON_KEY_BYTES \
	{               \
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, \
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00  \
	}

// Parameter kontrol otomatis:
// - Auto OFF hanya jika no-motion kontinu >= 10 menit (600 detik)
// - dan daya < 10 watt.
#define AUTO_CONTROL_NO_MOTION_OFF_SEC 600U
#define AUTO_CONTROL_POWER_THRESHOLD_W 10.0f

#endif
