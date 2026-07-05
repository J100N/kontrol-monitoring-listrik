/* =============================================================================
 * routes/devices.js — Definisi semua endpoint REST API untuk resource "devices"
 *
 * Semua route di sini dilindungi oleh middleware requireAuth (JWT Bearer)
 * yang dipasang di app.js sebelum router ini di-mount.
 *
 * Pola dependency injection: controller dan middleware diterima sebagai argumen
 * sehingga mudah diuji unit tanpa harus mock require().
 * ========================================================================== */

const express = require("express");
const { validateBody } = require("../middleware/validate");
const {
  controlCommand,
  modeUpdate,
  configUpdate,
  deviceUpdate,
} = require("../../../common/schemas/api_schemas");

/**
 * createDeviceRoutes — buat instance Express Router dengan semua endpoint devices.
 *
 * @param {object} deps
 * @param {object} deps.deviceController     - Handler CRUD perangkat
 * @param {object} deps.telemetryController  - Handler data sensor & riwayat
 * @param {object} deps.commandController    - Handler pengiriman perintah relay
 * @returns {express.Router}
 */
function createDeviceRoutes({
  deviceController,
  telemetryController,
  commandController,
}) {
  const router = express.Router();

  // ── Manajemen daftar device ───────────────────────────────────────────────

  // GET  /api/devices           — Ambil semua device yang terdaftar di registry
  router.get("/", deviceController.list);

  // (Fitur penambahan device DIHAPUS — sistem dikonfigurasi untuk 1 socket.)

  // ── Operasi per-device ────────────────────────────────────────────────────

  // GET    /api/devices/:deviceId  — Ambil detail satu device berdasarkan ID
  router.get("/:deviceId", deviceController.getOne);

  // PATCH  /api/devices/:deviceId  — Perbarui label, ruangan, threshold, atau timeout PIR
  router.patch(
    "/:deviceId",
    validateBody(deviceUpdate),
    deviceController.patch,
  );

  // DELETE /api/devices/:deviceId  — Hapus device dari registry
  router.delete("/:deviceId", deviceController.remove);

  // ── Kontrol mode dan relay ────────────────────────────────────────────────

  // POST /api/devices/:deviceId/mode     — Ganti mode: "manual" atau "auto"
  //   Mengirim command mode terenkripsi ke device + simpan ke registry.
  router.post(
    "/:deviceId/mode",
    validateBody(modeUpdate),
    commandController.setMode,
  );

  // POST /api/devices/:deviceId/config   — Kirim parameter kontrol otomatis
  //   (timeout PIR + threshold daya) ke firmware ESP32 via command config_update.
  router.post(
    "/:deviceId/config",
    validateBody(configUpdate),
    commandController.setConfig,
  );

  // POST /api/devices/:deviceId/control  — Kirim perintah relay: RELAY_ON / RELAY_OFF
  //   Controller akan menerbitkan command MQTT terenkripsi ASCON ke firmware ESP32
  router.post(
    "/:deviceId/control",
    validateBody(controlCommand),
    commandController.sendControl,
  );

  // ── Data telemetri dan event log ──────────────────────────────────────────

  // GET /api/devices/:deviceId/telemetry/latest  — Nilai sensor terbaru dari InfluxDB
  router.get("/:deviceId/telemetry/latest", telemetryController.latest);

  // GET /api/devices/:deviceId/telemetry/history — Riwayat sensor (mendukung query ?range=)
  router.get("/:deviceId/telemetry/history", telemetryController.history);

  // GET /api/devices/:deviceId/events            — Log event (relay, konektivitas, mode)
  router.get("/:deviceId/events", telemetryController.events);

  return router;
}

module.exports = { createDeviceRoutes };
