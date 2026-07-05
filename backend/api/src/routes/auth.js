/* =============================================================================
 * routes/auth.js — Endpoint autentikasi dashboard VoltGuard
 *
 * POST /api/auth/login  — Terbuka (tidak perlu token)
 *   Terima username + password → kembalikan JWT jika valid
 *
 * GET  /api/auth/me     — Terproteksi (butuh Bearer token)
 *   Kembalikan informasi pengguna yang sedang login berdasarkan token
 * ========================================================================== */

const { Router } = require("express");

/**
 * createAuthRoutes — buat router auth dengan dependency ter-inject.
 *
 * @param {object} param
 * @param {object} param.authController  - Controller yang menangani login
 * @param {Function} param.requireAuth   - Middleware verifikasi JWT
 */
function createAuthRoutes({ authController, requireAuth }) {
  const router = Router();

  // POST /api/auth/login — tidak memerlukan token (endpoint publik)
  router.post("/login", authController.login);

  // GET /api/auth/me — hanya bisa diakses dengan token yang valid
  // Berguna untuk frontend mengecek apakah token masih berlaku
  router.get("/me", requireAuth, (req, res) => {
    res.json({ ok: true, user: req.user });
  });

  return router;
}

module.exports = { createAuthRoutes };
