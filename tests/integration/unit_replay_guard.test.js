/* =============================================================================
 * unit_replay_guard.test.js — Uji unit untuk modul replayGuard
 *
 * replayGuard melindungi sistem dari serangan replay dengan menyimpan
 * counter (ctr) terakhir setiap device. Pesan dengan ctr <= nilai tersimpan
 * akan ditolak.
 *
 * Jalankan: npm run test:unit  (dari direktori tests/)
 * ========================================================================== */

const test   = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

const {
  createReplayGuard,
} = require("../../backend/mqtt_worker/src/security/replayGuard");

/** tmpFile — buat path file sementara unik di direktori temp OS */
function tmpFile() {
  return path.join(os.tmpdir(), `replay_${Date.now()}_${Math.random()}.json`);
}

// ── Test 1: logika check & block ──────────────────────────────────────────────

test("replayGuard allow first ctr & block lower/equal", () => {
  const file  = tmpFile();
  const guard = createReplayGuard({ stateFilePath: file, persistEveryN: 1 });

  // ctr=100 belum pernah ada — harus diterima
  assert.equal(guard.check("dev_a", 100).ok, true);
  guard.commit("dev_a", 100);

  // ctr=100 sudah dipakai — ditolak (replay)
  assert.equal(guard.check("dev_a", 100).ok, false);

  // ctr=99 lebih rendah dari yang tersimpan — ditolak
  assert.equal(guard.check("dev_a", 99).ok, false);

  // ctr=101 lebih tinggi — diterima (pesan baru)
  assert.equal(guard.check("dev_a", 101).ok, true);

  fs.rmSync(file, { force: true });
});

// ── Test 2: persistensi state ke file ────────────────────────────────────────

test("replayGuard persist & reload state", () => {
  const file = tmpFile();

  // Sesi pertama: simpan ctr=999 untuk dev_b
  const g1 = createReplayGuard({ stateFilePath: file, persistEveryN: 1 });
  g1.commit("dev_b", 999);
  g1.flush(); // Paksa tulis ke file sekarang

  // Sesi kedua: muat state dari file yang sama
  const g2 = createReplayGuard({ stateFilePath: file, persistEveryN: 1 });

  // ctr=999 sudah tercatat di file — harus ditolak meskipun guard baru
  assert.equal(g2.check("dev_b", 999).ok, false);

  // ctr=1000 lebih tinggi — diterima
  assert.equal(g2.check("dev_b", 1000).ok, true);

  fs.rmSync(file, { force: true });
});
