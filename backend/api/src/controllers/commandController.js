/* =============================================================================
 * commandController.js — Handler HTTP untuk pengiriman perintah relay
 *
 * Menerima perintah dari dashboard (RELAY_ON / RELAY_OFF) dan
 * mendelegasikan ke commandService yang akan menerbitkan pesan MQTT
 * terenkripsi ASCON ke firmware ESP32.
 *
 * Respons HTTP 202 Accepted digunakan karena perintah dikirim secara
 * asinkron — konfirmasi dari firmware datang via ACK MQTT terpisah.
 * ========================================================================== */

/**
 * createCommandController — buat controller dengan injeksi layanan perintah.
 * @param {object} deps
 * @param {object} deps.commandService - Layanan yang menerbitkan command MQTT
 */
function createCommandController({ commandService }) {

  /**
   * POST /api/devices/:deviceId/control
   * Kirim perintah relay ke ESP32 via MQTT.
   *
   * Body: { command: "RELAY_ON"|"RELAY_OFF", command_id?, issued_by? }
   * Respons: 202 Accepted + { ok, command_id, queued_at }
   */
  async function sendControl(req, res, next) {
    try {
      const result = await commandService.sendControl({
        deviceId:  req.params.deviceId,
        command:   req.body.command,
        commandId: req.body.command_id,  // Opsional; di-generate otomatis jika kosong
        issuedBy:  req.body.issued_by,   // Opsional; untuk keperluan audit log
      });
      // 202 Accepted — perintah diterima dan diteruskan, bukan selesai dieksekusi
      res.status(202).json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/devices/:deviceId/mode
   * Ganti mode operasi (manual/auto): kirim command ke device + simpan registry.
   * Body: { mode: "manual"|"auto" }
   */
  async function setMode(req, res, next) {
    try {
      const result = await commandService.sendMode({
        deviceId: req.params.deviceId,
        mode:     req.body.mode,
      });
      res.status(202).json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/devices/:deviceId/config
   * Kirim parameter kontrol otomatis ke ESP32 (timeout PIR + threshold daya).
   * Body: { pir_timeout_sec, power_threshold_w }
   */
  async function setConfig(req, res, next) {
    try {
      const result = await commandService.sendConfig({
        deviceId:        req.params.deviceId,
        pirTimeoutSec:   req.body.pir_timeout_sec,
        powerThresholdW: req.body.power_threshold_w,
      });
      res.status(202).json({ ok: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  return { sendControl, setMode, setConfig };
}

module.exports = { createCommandController };
