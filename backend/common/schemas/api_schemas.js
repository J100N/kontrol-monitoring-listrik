/* =============================================================================
 * api_schemas.js — Skema JSON Schema untuk validasi body request REST API
 *
 * Digunakan oleh middleware validateBody (AJV) di setiap endpoint yang
 * menerima data dari klien. Dipisahkan dari payload MQTT agar perubahan
 * kontrak API tidak mengganggu kontrak firmware.
 *
 * Semua skema menggunakan additionalProperties: false untuk menolak field
 * tak dikenal dan mencegah parameter tersembunyi masuk ke backend.
 * ========================================================================== */

module.exports = {
  // ── POST /api/devices/:id/control ─────────────────────────────────────────
  // Kirim perintah relay ke firmware ESP32 via MQTT
  controlCommand: {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: {
      command:    { type: "string", enum: ["RELAY_ON", "RELAY_OFF"] },  // Perintah relay
      command_id: { type: "string", minLength: 1, maxLength: 64 },      // ID unik opsional
      issued_by:  { type: "string", maxLength: 64 },                    // Sumber perintah
    },
  },

  // ── POST /api/devices/:id/mode ────────────────────────────────────────────
  // Ganti mode operasi antara kontrol manual dan otomatis (sensor PIR)
  modeUpdate: {
    type: "object",
    additionalProperties: false,
    required: ["mode"],
    properties: {
      mode: { type: "string", enum: ["manual", "auto"] },
    },
  },

  // ── POST /api/devices/:id/config ──────────────────────────────────────────
  // Kirim parameter kontrol otomatis ke firmware ESP32 via MQTT (config_update)
  configUpdate: {
    type: "object",
    additionalProperties: false,
    required: ["pir_timeout_sec", "power_threshold_w"],
    properties: {
      pir_timeout_sec:   { type: "integer", minimum: 5,  maximum: 7200 },   // Timeout PIR (detik)
      power_threshold_w: { type: "number",  minimum: 0,  maximum: 5000 },   // Threshold daya standby (Watt)
    },
  },

  // ── PATCH /api/devices/:id ────────────────────────────────────────────────
  // Perbarui metadata atau parameter device — semua field opsional
  deviceUpdate: {
    type: "object",
    additionalProperties: false,
    properties: {
      label:              { type: "string",  minLength: 1, maxLength: 64 },   // Nama tampilan
      room:               { type: "string",  minLength: 1, maxLength: 64 },   // Lokasi fisik
      power_threshold_w:  { type: "number",  minimum: 0,   maximum: 5000 },   // Batas daya standby (Watt)
      pir_timeout_sec:    { type: "integer", minimum: 5,   maximum: 7200 },   // Timeout sensor PIR (detik)
    },
  },
};
