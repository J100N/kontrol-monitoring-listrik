/* =============================================================================
 * measurements.js — Nama measurement InfluxDB yang digunakan secara bersama
 *
 * Worker menulis ke measurement ini; API membaca dari measurement yang sama.
 * Memisahkan konstanta ini di satu tempat mencegah typo dan memudahkan
 * penggantian nama di masa mendatang.
 *
 * Skema measurement:
 *   power_telemetry          — data sensor terdesripsi (setelah ASCON decrypt)
 *                              tag: device_id, room
 *                              field: voltage_v, current_a, power_w, energy_kwh,
 *                                     pf, relay_on, rssi_db
 *
 *   power_telemetry_encrypted — salinan mentah payload terenkripsi (arsip audit)
 *                              tag: device_id
 *                              field: raw_cipher, nonce, tag, kid, ctr
 *
 *   device_event              — log peristiwa (relay berubah, mode ganti, connect/disconnect)
 *                              tag: device_id, event_type
 *                              field: detail (JSON string)
 * ========================================================================== */

module.exports = {
  // Data sensor yang sudah didekripsi — sumber utama telemetri dashboard
  TELEMETRY: "power_telemetry",

  // Salinan payload terenkripsi untuk keperluan audit/forensik
  TELEMETRY_ENCRYPTED: "power_telemetry_encrypted",

  // Log peristiwa penting per device
  DEVICE_EVENT: "device_event",
};
