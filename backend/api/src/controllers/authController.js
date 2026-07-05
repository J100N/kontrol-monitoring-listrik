/* =============================================================================
 * authController.js — Menangani login dan penerbitan token JWT
 *
 * Alur autentikasi:
 *   1. Terima username + password dari body request
 *   2. Bandingkan username dengan ADMIN_USERNAME di .env
 *   3. Bandingkan password dengan hash bcrypt (dihitung sekali saat startup)
 *   4. Jika cocok → terbitkan JWT yang berlaku sesuai JWT_EXPIRES_IN
 *   5. Jika tidak cocok → kembalikan 401 Unauthorized
 *
 * Endpoint: POST /api/auth/login
 * ========================================================================== */

const bcrypt = require("bcryptjs");  // Library hashing password
const jwt    = require("jsonwebtoken"); // Library pembuatan dan verifikasi token

/**
 * createAuthController — pabrik controller dengan konfigurasi ter-inject.
 * Password di-hash sekali saat startup (bukan tiap request) untuk efisiensi.
 *
 * @param {object} authConfig - { adminUsername, adminPassword, jwtSecret, jwtExpiresIn }
 */
function createAuthController({ authConfig }) {
  // Hash password admin dari .env menggunakan bcrypt dengan 10 putaran (salt rounds).
  // Dilakukan sekali saat server start, bukan tiap request masuk.
  const adminPasswordHash = bcrypt.hashSync(authConfig.adminPassword, 10);

  /**
   * login — handler untuk POST /api/auth/login
   * Memvalidasi kredensial lalu mengembalikan JWT jika valid.
   */
  async function login(req, res, next) {
    try {
      const { username, password } = req.body;

      // Validasi input: username dan password tidak boleh kosong
      if (!username || !password) {
        return res.status(400).json({
          ok:    false,
          error: "Username dan password wajib diisi",
        });
      }

      // Bandingkan username secara langsung (case-sensitive)
      const usernameMatch = username === authConfig.adminUsername;

      // Bandingkan password dengan hash menggunakan bcrypt (timing-safe)
      const passwordMatch = await bcrypt.compare(password, adminPasswordHash);

      // Jika salah satu tidak cocok, kembalikan error 401
      // Pesan dibuat sama untuk mencegah enumerasi (tidak bocorkan mana yang salah)
      if (!usernameMatch || !passwordMatch) {
        return res.status(401).json({
          ok:    false,
          error: "Username atau password salah",
        });
      }

      // Buat payload JWT — berisi informasi identitas pengguna (bukan password)
      const payload = {
        sub:         authConfig.adminUsername, // subject: identitas pengguna
        displayName: "Admin VoltGuard",
        role:        "admin",
      };

      // Tanda tangani token dengan secret dan set masa berlaku
      const token = jwt.sign(payload, authConfig.jwtSecret, {
        expiresIn: authConfig.jwtExpiresIn, // contoh: "8h"
      });

      // Kembalikan token dan info pengguna ke frontend
      return res.json({
        ok: true,
        token,
        user: {
          username:    authConfig.adminUsername,
          displayName: payload.displayName,
          role:        payload.role,
        },
      });
    } catch (err) {
      // Lempar ke error handler global Express
      next(err);
    }
  }

  return { login };
}

module.exports = { createAuthController };
