/* =============================================================================
 * authMiddleware.js — Verifikasi JWT Bearer token pada setiap request
 *
 * Cara kerja:
 *   1. Baca header "Authorization" dari request
 *   2. Ekstrak token setelah kata "Bearer "
 *   3. Verifikasi tanda tangan token menggunakan JWT_SECRET
 *   4. Jika valid → simpan payload di req.user, lanjut ke route handler
 *   5. Jika tidak ada / tidak valid → kembalikan 401 Unauthorized
 *
 * Dipasang sebagai middleware sebelum semua route /api/devices.
 * ========================================================================== */

const jwt = require("jsonwebtoken");

/**
 * createAuthMiddleware — pabrik middleware dengan konfigurasi ter-inject.
 *
 * @param {object} param - { jwtSecret: string }
 * @returns {Function} Middleware Express (req, res, next)
 */
function createAuthMiddleware({ jwtSecret }) {
  return function requireAuth(req, res, next) {
    // Baca header Authorization, contoh: "Bearer eyJhbGciOiJIUzI1NiJ9..."
    const header = req.headers["authorization"] || "";

    // Ekstrak token: ambil bagian setelah "Bearer " (7 karakter)
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    // Tolak request jika tidak ada token sama sekali
    if (!token) {
      return res.status(401).json({ ok: false, error: "Token tidak ditemukan" });
    }

    try {
      // Verifikasi tanda tangan dan masa berlaku token
      // Jika berhasil, payload berisi: { sub, displayName, role, iat, exp }
      req.user = jwt.verify(token, jwtSecret);

      // Token valid — teruskan request ke route handler berikutnya
      next();
    } catch {
      // Token tidak valid (tanda tangan salah) atau sudah kadaluarsa
      return res.status(401).json({ ok: false, error: "Token tidak valid atau kadaluarsa" });
    }
  };
}

module.exports = { createAuthMiddleware };
