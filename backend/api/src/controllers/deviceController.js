/* =============================================================================
 * deviceController.js — Handler HTTP untuk resource "devices"
 *
 * Setiap fungsi menerima (req, res, next) dari Express dan mendelegasikan
 * logika bisnis ke deviceService. Error diteruskan ke global error handler
 * via next(error) agar format respons error tetap konsisten.
 * ========================================================================== */

/**
 * createDeviceController — buat controller dengan injeksi layanan device.
 * @param {object} deps
 * @param {object} deps.deviceService - Layanan yang mengelola registry device
 */
function createDeviceController({ deviceService }) {

  /** GET /api/devices — kembalikan semua device yang terdaftar */
  async function list(req, res, next) {
    try {
      const devices = await deviceService.listDevices();
      res.json({ ok: true, devices });
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/devices/:deviceId — detail satu device; 404 jika tidak ditemukan */
  async function getOne(req, res, next) {
    try {
      const device = await deviceService.getDevice(req.params.deviceId);
      if (!device) return res.status(404).json({ ok: false, error: "not_found" });
      res.json({ ok: true, device });
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/devices/:deviceId — perbarui sebagian field device (label, room, threshold) */
  async function patch(req, res, next) {
    try {
      const device = deviceService.patchDevice(req.params.deviceId, req.body);
      res.json({ ok: true, device });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/devices/:deviceId/mode — ganti mode operasi: "manual" atau "auto" */
  async function setMode(req, res, next) {
    try {
      const device = deviceService.setMode(req.params.deviceId, req.body.mode);
      res.json({ ok: true, device });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/devices/:deviceId — hapus device dari registry, kembalikan 204 No Content */
  async function remove(req, res, next) {
    try {
      deviceService.deleteDevice(req.params.deviceId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  return { list, getOne, patch, setMode, remove };
}

module.exports = { createDeviceController };
