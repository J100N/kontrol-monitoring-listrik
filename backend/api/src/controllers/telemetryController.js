/* =============================================================================
 * telemetryController.js — Handler HTTP untuk data sensor dan log event
 *
 * Membaca data dari InfluxDB melalui telemetryService. Semua endpoint
 * bersifat read-only (GET); penulisan data dilakukan oleh mqtt_worker.
 * ========================================================================== */

/**
 * createTelemetryController — buat controller dengan injeksi layanan telemetri.
 * @param {object} deps
 * @param {object} deps.telemetryService - Layanan baca data dari InfluxDB
 */
function createTelemetryController({ telemetryService }) {

  /**
   * GET /api/devices/:deviceId/telemetry/latest
   * Kembalikan nilai sensor terbaru (tegangan, arus, daya, status relay).
   */
  async function latest(req, res, next) {
    try {
      const data = await telemetryService.getLatest(req.params.deviceId);
      res.json({ ok: true, latest: data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/devices/:deviceId/telemetry/history?range=1h
   * Riwayat data sensor dalam rentang waktu tertentu.
   * Query param ?range= mendukung format InfluxDB: 1h, 6h, 1d, 7d, 30d.
   */
  async function history(req, res, next) {
    try {
      const data = await telemetryService.getHistory(
        req.params.deviceId,
        req.query.range,   // misal: "1h", "24h", "7d"
      );
      res.json({ ok: true, ...data });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/devices/:deviceId/events?range=24h&limit=50
   * Log peristiwa device: perubahan relay, ganti mode, konektivitas.
   * Query param ?limit= membatasi jumlah baris yang dikembalikan.
   */
  async function events(req, res, next) {
    try {
      const data = await telemetryService.getEvents(
        req.params.deviceId,
        req.query.range,   // rentang waktu
        req.query.limit,   // batas jumlah event
      );
      res.json({ ok: true, ...data });
    } catch (error) {
      next(error);
    }
  }

  return { latest, history, events };
}

module.exports = { createTelemetryController };
