#ifndef DEVICE_PROFILE_H
#define DEVICE_PROFILE_H

// Kredensial (Wi-Fi, MQTT, kunci ASCON) dipisah ke device_secrets.h yang tidak
// ikut di-commit. Salin device_secrets.h.example menjadi device_secrets.h lalu
// isi nilai aslinya sebelum build.
#if defined(__has_include)
#  if !__has_include("device_secrets.h")
#    error "device_secrets.h tidak ditemukan. Salin device_secrets.h.example menjadi device_secrets.h lalu isi kredensialnya."
#  endif
#endif
#include "device_secrets.h"

#define DEVICE_ID "smart_socket"
#define WIFI_MAX_RETRY 10U

// Konfigurasi broker MQTT (EMQX) untuk device ini.
#define MQTT_BROKER_URI "mqtt://" MQTT_BROKER_HOST ":1883"
#define MQTT_CLIENT_ID DEVICE_ID

// Topik command/telemetry/status/ack per-device.
#define MQTT_TOPIC_COMMAND "devices/smart_socket/command"
#define MQTT_TOPIC_TELEMETRY "devices/smart_socket/telemetry"
#define MQTT_TOPIC_RELAY_STATUS "devices/smart_socket/relay/status"
#define MQTT_TOPIC_ACK "devices/smart_socket/ack"
#define MQTT_TOPIC_LWT "devices/smart_socket/status"

// Last Will payload saat device terputus tidak normal.
#define MQTT_LWT_PAYLOAD "{\"device_id\":\"" DEVICE_ID "\",\"status_type\":\"connectivity\",\"status\":\"OFFLINE\"}"

// Kunci simetris ASCON-128 (ASCON_KEY_ID & ASCON_KEY_BYTES) ada di device_secrets.h.
// TODO produksi: pindahkan key ke secure provisioning/NVS, jangan hardcode source.

// Parameter kontrol otomatis:
// - Auto OFF hanya jika no-motion kontinu >= 10 menit (600 detik)
// - dan daya < 10 watt.
#define AUTO_CONTROL_NO_MOTION_OFF_SEC 600U
#define AUTO_CONTROL_POWER_THRESHOLD_W 10.0f

#endif
