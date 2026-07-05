/* =============================================================================
 * validate.js — Middleware validasi body request berbasis JSON Schema (AJV)
 *
 * Cara pakai di router:
 *   router.post("/", validateBody(deviceCreate), controller.create);
 *
 * Jika body tidak sesuai schema, middleware langsung mengembalikan HTTP 400
 * dengan daftar error detail dari AJV — controller tidak pernah dipanggil.
 * ========================================================================== */

const Ajv = require("ajv");

// Inisialisasi satu instance AJV global; compile schema sekali, validasi berkali-kali.
// allErrors: true  → kumpulkan SEMUA error sekaligus (bukan berhenti di error pertama)
// strict: false    → izinkan schema tanpa keyword "type" eksplisit (lebih fleksibel)
const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * compileValidator — compile JSON Schema menjadi fungsi validator AJV.
 * Hasil compile di-cache oleh AJV secara internal agar tidak di-compile ulang
 * setiap kali ada request masuk.
 */
function compileValidator(schema) {
  return ajv.compile(schema);
}

/**
 * validateBody — buat middleware Express yang memvalidasi req.body terhadap schema.
 *
 * @param {object} schema - JSON Schema (dari api_schemas.js)
 * @returns {Function} middleware (req, res, next) => void
 */
function validateBody(schema) {
  const validator = compileValidator(schema);

  return (req, res, next) => {
    // Validasi body; fallback ke objek kosong jika body tidak ada
    if (!validator(req.body || {})) {
      // Kembalikan 400 dengan detail error agar klien tahu field mana yang salah
      return res.status(400).json({
        ok: false,
        error: "validation_failed",
        details: validator.errors,
      });
    }
    // Body valid — lanjutkan ke handler berikutnya
    next();
  };
}

module.exports = { validateBody };
