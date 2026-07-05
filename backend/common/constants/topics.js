/* =============================================================================
 * topics.js — Konstanta topic MQTT dan template nama yang digunakan oleh
 *   mqtt_worker, API, dan realtime_gateway.
 *
 * Wildcard (+) digunakan saat berlangganan (subscribe) sehingga satu
 * subscription bisa menerima pesan dari semua device.
 * Template ({device_id}) digunakan saat menerbitkan (publish) ke device tertentu.
 *
 * Alur pesan:
 *   ESP32 → devices/{id}/telemetry     → mqtt_worker → InfluxDB
 *   ESP32 → devices/{id}/ack           → mqtt_worker → log
 *   ESP32 → devices/{id}/relay/status  → mqtt_worker → realtime_gateway → WS klien
 *   ESP32 → devices/{id}/status        → mqtt_worker → registry (online/offline)
 *
 *   Dashboard → dashboard/devices/{id}/command → mqtt_worker → ESP32 (terenkripsi)
 *   mqtt_worker → dashboard/devices/{id}/status → realtime_gateway → WS klien
 * ========================================================================== */

module.exports = {
  // ── Topic subscription (wildcard +) ──────────────────────────────────────

  // Telemetri sensor (daya, tegangan, arus) dari semua ESP32
  TELEMETRY_TOPIC: "devices/+/telemetry",

  // ACK dari ESP32 sebagai konfirmasi perintah diterima
  DEVICE_ACK_TOPIC: "devices/+/ack",

  // Status relay real-time (ON/OFF) yang dikirim firmware setelah perubahan
  DEVICE_RELAY_STATUS_TOPIC: "devices/+/relay/status",

  // Status konektivitas (online/offline) dari ESP32
  DEVICE_CONNECTIVITY_TOPIC: "devices/+/status",

  // Perintah dari dashboard yang akan diteruskan ke firmware (terenkripsi ASCON)
  DASHBOARD_COMMAND_TOPIC: "dashboard/devices/+/command",

  // Status yang dikirim mqtt_worker ke dashboard setelah memproses pesan device
  DASHBOARD_STATUS_TOPIC: "dashboard/devices/+/status",

  // ── Template publish (ganti {device_id} dengan ID device nyata) ───────────

  // Template topic perintah ke firmware ESP32
  DEVICE_COMMAND_TEMPLATE: "devices/{device_id}/command",

  // Template topic perintah dari dashboard ke worker
  DASHBOARD_COMMAND_TEMPLATE: "dashboard/devices/{device_id}/command",

  // Template topic status dari worker ke dashboard
  DASHBOARD_STATUS_TEMPLATE: "dashboard/devices/{device_id}/status",
};
