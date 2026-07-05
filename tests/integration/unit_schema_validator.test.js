/* =============================================================================
 * unit_schema_validator.test.js — Uji unit untuk schemaValidator mqtt_worker
 *
 * Memastikan bahwa fungsi buildValidators() menghasilkan validator yang:
 *   - Menerima payload valid sesuai schema
 *   - Menolak payload invalid (field salah, nilai di luar range)
 *
 * Jalankan: npm run test:unit  (dari direktori tests/)
 * ========================================================================== */

const test   = require("node:test");
const assert = require("node:assert/strict");

const {
  buildValidators,
} = require("../../backend/mqtt_worker/src/handlers/schemaValidator");

// Buat satu instance validator yang dipakai bersama di semua test case
const validators = buildValidators();

// ── Uji validasi envelope terenkripsi (payload dari ESP32 via MQTT) ──────────

test("encrypted envelope valid", () => {
  // Payload lengkap dan benar — harus lolos validasi
  const v = validators.validateEncryptedEnvelope({
    enc:        1,
    device_id:  "smart_socket",
    kid:        1,
    ctr:        1,
    nonce:      "00000000000000000000000000000001",
    tag:        "11111111111111111111111111111111",
    cipher:     "deadbeef",
    command_id: "cmd-1",
  });
  assert.equal(v.ok, true);
});

test("encrypted envelope invalid (kid 0)", () => {
  // kid (key ID) harus >= 1; nilai 0 tidak valid
  const v = validators.validateEncryptedEnvelope({
    enc:        1,
    device_id:  "smart_socket",
    kid:        0,        // ← tidak valid
    ctr:        1,
    nonce:      "00000000000000000000000000000001",
    tag:        "11111111111111111111111111111111",
    cipher:     "deadbeef",
    command_id: "cmd-1",
  });
  assert.equal(v.ok, false);
});

// ── Uji validasi ACK dari firmware (konfirmasi perintah diterima) ─────────────

test("ack valid", () => {
  const v = validators.validateAck({
    device_id:  "smart_socket",
    command_id: "cmd-1",
    status:     "ok",
    message:    "applied",
  });
  assert.equal(v.ok, true);
});

// ── Uji validasi perintah dari dashboard ─────────────────────────────────────

test("dashboard command valid", () => {
  const v = validators.validateDashboardCommand({
    device_id: "smart_socket",
    command:   "RELAY_ON",
  });
  assert.equal(v.ok, true);
});
