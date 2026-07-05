/* =============================================================================
 * unit_device_registry.test.js — Uji unit untuk modul device registry
 *
 * Device registry menyimpan daftar device yang terdaftar ke file JSON
 * dan menyediakan operasi CRUD in-memory dengan persistensi otomatis.
 *
 * Jalankan: npm run test:unit  (dari direktori tests/)
 * ========================================================================== */

const test   = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

const {
  createDeviceRegistry,
} = require("../../backend/mqtt_worker/src/device_registry/registry");

/** tmpFile — buat path file sementara unik di direktori temp OS */
function tmpFile() {
  return path.join(
    os.tmpdir(),
    `registry_${Date.now()}_${Math.random()}.json`,
  );
}

// ── Test: operasi CRUD dasar ──────────────────────────────────────────────────

test("registry upsert & touchSeen", () => {
  const file = tmpFile();
  const reg  = createDeviceRegistry({ filePath: file });

  // Tambahkan device baru
  reg.upsert({ device_id: "x1", label: "Lab", room: "Lab 5" });

  // Device harus ada setelah upsert
  assert.equal(reg.exists("x1"), true);
  assert.equal(reg.list().length, 1);

  // touchSeen memperbarui status online/offline
  reg.touchSeen("x1", true);
  assert.equal(reg.get("x1").online, true);

  // Hapus device — tidak boleh ada lagi setelahnya
  reg.remove("x1");
  assert.equal(reg.exists("x1"), false);

  fs.rmSync(file, { force: true });
});
