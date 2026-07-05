/* =============================================================================
 * logger.js — Logger sederhana berbasis console dengan prefix tag dan timestamp
 *
 * Digunakan oleh mqtt_worker, api, dan realtime_gateway agar format log
 * konsisten di semua service. Tidak ada dependensi eksternal.
 *
 * Contoh penggunaan:
 *   const log = withTag("MQTT_WORKER");
 *   log.info("Pesan diterima", { topic, size });
 *   log.warn("Koneksi lambat");
 *   log.error("Gagal kirim", { err: error.message });
 *
 * Output: 2025-01-01T00:00:00.000Z INFO [MQTT_WORKER] Pesan diterima {"topic":"..."}
 * ========================================================================== */

/**
 * withTag — buat logger yang selalu menyertakan tag nama service/modul.
 *
 * @param {string} tag - Nama service atau modul (misal: "API", "WS_GATEWAY")
 * @returns {{ info, warn, error }} objek dengan tiga level log
 */
function withTag(tag) {
  return {
    // Log level INFO — alur normal, event penting
    info: (msg, meta) => console.log(formatLine("INFO", tag, msg, meta)),

    // Log level WARN — kondisi tidak normal tapi sistem masih berjalan
    warn: (msg, meta) => console.warn(formatLine("WARN", tag, msg, meta)),

    // Log level ERROR — kegagalan yang perlu perhatian
    error: (msg, meta) => console.error(formatLine("ERROR", tag, msg, meta)),
  };
}

/**
 * formatLine — susun satu baris log dengan timestamp ISO, level, tag, dan pesan.
 * Metadata opsional di-serialize ke JSON; jika gagal serialize, tampilkan pesan error-nya.
 */
function formatLine(level, tag, msg, meta) {
  const ts   = new Date().toISOString();
  const base = `${ts} ${level} [${tag}] ${msg}`;

  if (!meta) return base;

  try {
    return `${base} ${JSON.stringify(meta)}`;
  } catch (error) {
    // Metadata tidak bisa di-JSON — contohnya objek circular reference
    return `${base} <meta_serialize_failed:${error.message}>`;
  }
}

module.exports = { withTag };
