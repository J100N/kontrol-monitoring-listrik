/* =============================================================================
 * asconAead128.js — Implementasi Ascon-AEAD128 (NIST SP 800-232)
 *
 * Algoritma kriptografi terotentikasi dengan associated data (AEAD) berbasis
 * keluarga Ascon yang DIRESMIKAN NIST melalui SP 800-232 (final, 13 Agustus
 * 2025). Menggantikan implementasi sebelumnya berbasis ASCON-128 v1.2
 * (Round 3 NIST LWC finalist).
 *
 * Perbedaan utama dari ASCON-128 v1.2:
 *   - Rate            : 16 byte (128 bit)  — sebelumnya 8 byte
 *   - Ronde b         : 8                  — sebelumnya 6
 *   - Byte ordering   : LITTLE-ENDIAN      — sebelumnya BIG-ENDIAN
 *   - Padding byte    : 0x01 di posisi i   — sebelumnya 0x80 di posisi i
 *   - Domain sep      : 0x80 << 56 ke x[4] — sebelumnya 0x01 ke x[4]
 *   - IV              : 0x1000808C0001     — sebelumnya 0x80400C0600000000
 *   - Finalize key XOR: x[2]^=K0; x[3]^=K1 — sebelumnya x[1]^=K0; x[2]^=K1
 *
 * Catatan: permutasi inti (S-box + linear diffusion) TIDAK berubah — sama
 * persis dengan v1.2 dan publikasi paper Ascon awal.
 *
 * Referensi resmi:
 *   - NIST SP 800-232: https://csrc.nist.gov/pubs/sp/800/232/final
 *   - Reference impl : https://github.com/ascon/ascon-c (folder asconaead128)
 *   - Verifikasi KAT : 1089/1089 PASS terhadap LWC_AEAD_KAT_128_128.txt resmi
 *
 * Tipe data: BigInt 64-bit (Node.js native) — tanpa dependency eksternal.
 * ========================================================================== */

// ── Konstanta algoritma sesuai SP 800-232 ────────────────────────────────────
const ASCON_KEY_SIZE = 16;     // 128-bit key
const ASCON_NONCE_SIZE = 16;   // 128-bit public nonce (Npub)
const ASCON_TAG_SIZE = 16;     // 128-bit authentication tag
const ASCON_AEAD_RATE = 16;    // 128-bit rate (memakai x[0] dan x[1] sekaligus)

const ASCON_PA_ROUNDS = 12;    // Init & finalize
const ASCON_PB_ROUNDS = 8;     // Per blok rate

// IV Ascon-AEAD128 dihitung dari parameter (SP 800-232 §3.2):
//   IV = (variant << 0) | (pa << 16) | (pb << 20) | (tag_bits << 24) | (rate << 40)
//   variant = 1 (AEAD), pa = 12, pb = 8, tag_bits = 128, rate = 16
// Hasil: 0x0000_1000_808C_0001
const ASCON_AEAD128_IV =
  (1n << 0n) | (12n << 16n) | (8n << 20n) | (128n << 24n) | (16n << 40n);

const MASK_64 = (1n << 64n) - 1n;

// Round constants ASCON p[12] (sama untuk semua varian Ascon).
const ASCON_RC = [
  0xf0n, 0xe1n, 0xd2n, 0xc3n, 0xb4n, 0xa5n,
  0x96n, 0x87n, 0x78n, 0x69n, 0x5an, 0x4bn,
];

// Domain separation: di SP 800-232 nilainya 0x80 di byte ke-7 (MSB) dari x[4].
// Dalam representasi BigInt 64-bit little-endian → 0x80 << 56.
const DSEP = 0x80n << 56n;

// ── Utilitas word 64-bit ─────────────────────────────────────────────────────

// Rotasi kanan 64-bit untuk linear diffusion layer.
function rotr64(x, n) {
  const shift = BigInt(n);
  const v = x & MASK_64;
  return ((v >> shift) | (v << (64n - shift))) & MASK_64;
}

// Load n byte dari buffer menjadi word 64-bit LITTLE-ENDIAN.
// byte[offset+0] menjadi LSB, byte[offset+n-1] menjadi byte ke-(n-1).
function loadBytes(buf, offset, n) {
  let x = 0n;
  for (let i = 0; i < n; i += 1) {
    x |= BigInt(buf[offset + i]) << BigInt(8 * i);
  }
  return x;
}

// Store n byte dari word 64-bit ke buffer dalam urutan LITTLE-ENDIAN.
function storeBytes(buf, offset, x, n) {
  let v = x & MASK_64;
  for (let i = 0; i < n; i += 1) {
    buf[offset + i] = Number((v >> BigInt(8 * i)) & 0xffn);
  }
}

// Padding byte 0x01 ditempatkan di posisi byte ke-i dalam word 64-bit (LE).
// Contoh: pad(0) = 0x01, pad(3) = 0x01000000, pad(7) = 0x0100000000000000.
function pad(i) {
  return 0x01n << BigInt(8 * i);
}

// Nolkan n byte pertama (byte 0..n-1) dalam word, mempertahankan byte n..7.
// Dipakai saat dekripsi blok parsial: state perlu dikosongkan di posisi yang
// akan diisi ulang ciphertext, sementara byte sisa (di luar payload) tetap.
// Setara dengan CLEARBYTES(x, n) di referensi C IAIK.
function clearBytesFirstN(x, n) {
  let mask = MASK_64;
  for (let pos = 0; pos < n; pos += 1) {
    mask &= ~(0xffn << BigInt(8 * pos));
  }
  return x & mask;
}

// ── Permutasi inti ASCON (p[12] dan p[8]) ────────────────────────────────────
// State: array [x0, x1, x2, x3, x4] dengan setiap elemen BigInt 64-bit.
// Logika identik dengan implementasi v1.2 — round function ASCON tidak
// berubah di SP 800-232.
function asconPermute(state, rounds) {
  const start = 12 - rounds;

  for (let i = start; i < 12; i += 1) {
    // (1) Penambahan round constant ke x[2]
    state[2] ^= ASCON_RC[i];

    // (2) Substitution layer (5-bit S-box ASCON)
    state[0] ^= state[4];
    state[4] ^= state[3];
    state[2] ^= state[1];

    const t0 = (~state[0]) & state[1] & MASK_64;
    const t1 = (~state[1]) & state[2] & MASK_64;
    const t2 = (~state[2]) & state[3] & MASK_64;
    const t3 = (~state[3]) & state[4] & MASK_64;
    const t4 = (~state[4]) & state[0] & MASK_64;

    state[0] ^= t1;
    state[1] ^= t2;
    state[2] ^= t3;
    state[3] ^= t4;
    state[4] ^= t0;

    state[1] ^= state[0];
    state[0] ^= state[4];
    state[3] ^= state[2];
    state[2] = (~state[2]) & MASK_64;

    // (3) Linear diffusion layer (rotasi & XOR per word)
    state[0] ^= rotr64(state[0], 19) ^ rotr64(state[0], 28);
    state[1] ^= rotr64(state[1], 61) ^ rotr64(state[1], 39);
    state[2] ^= rotr64(state[2], 1)  ^ rotr64(state[2], 6);
    state[3] ^= rotr64(state[3], 10) ^ rotr64(state[3], 17);
    state[4] ^= rotr64(state[4], 7)  ^ rotr64(state[4], 41);

    // Masking final agar tetap dalam range 64-bit (BigInt JS bisa overflow).
    for (let j = 0; j < 5; j += 1) state[j] &= MASK_64;
  }
}

// ── Tahap-tahap algoritma AEAD ───────────────────────────────────────────────

// Init: load IV+key+nonce → P12 → XOR key kembali ke x[3], x[4]
function asconAeadInit(state, key, nonce) {
  const K0 = loadBytes(key, 0, 8);
  const K1 = loadBytes(key, 8, 8);
  const N0 = loadBytes(nonce, 0, 8);
  const N1 = loadBytes(nonce, 8, 8);

  state[0] = ASCON_AEAD128_IV;
  state[1] = K0;
  state[2] = K1;
  state[3] = N0;
  state[4] = N1;

  asconPermute(state, ASCON_PA_ROUNDS);

  state[3] ^= K0;
  state[4] ^= K1;
}

// Absorb Associated Data (AD) — kalau adlen=0, lewati blok AD sepenuhnya
// (cukup domain separation di akhir). Beda perilaku dgn v1.2 yang selalu XOR 1.
function asconAeadAbsorbAd(state, ad) {
  let offset = 0;
  let remain = ad.length;

  if (remain > 0) {
    // Proses blok penuh 16-byte: XOR ke x[0] dan x[1]
    while (remain >= ASCON_AEAD_RATE) {
      state[0] ^= loadBytes(ad, offset, 8);
      state[1] ^= loadBytes(ad, offset + 8, 8);
      asconPermute(state, ASCON_PB_ROUNDS);
      offset += ASCON_AEAD_RATE;
      remain -= ASCON_AEAD_RATE;
    }

    // Blok terakhir parsial (0..15 byte) + padding 0x01
    if (remain >= 8) {
      state[0] ^= loadBytes(ad, offset, 8);
      state[1] ^= loadBytes(ad, offset + 8, remain - 8);
      state[1] ^= pad(remain - 8);
    } else {
      state[0] ^= loadBytes(ad, offset, remain);
      state[0] ^= pad(remain);
    }
    asconPermute(state, ASCON_PB_ROUNDS);
  }

  // Domain separation: selalu dilakukan, walau AD kosong.
  state[4] ^= DSEP;
}

// Enkripsi payload — modifikasi state, kembalikan buffer ciphertext.
function asconAeadEncryptPayload(state, plaintext) {
  const ciphertext = Buffer.alloc(plaintext.length, 0);

  let offset = 0;
  let remain = plaintext.length;

  // Blok penuh 16-byte
  while (remain >= ASCON_AEAD_RATE) {
    state[0] ^= loadBytes(plaintext, offset, 8);
    state[1] ^= loadBytes(plaintext, offset + 8, 8);
    storeBytes(ciphertext, offset, state[0], 8);
    storeBytes(ciphertext, offset + 8, state[1], 8);
    asconPermute(state, ASCON_PB_ROUNDS);
    offset += ASCON_AEAD_RATE;
    remain -= ASCON_AEAD_RATE;
  }

  // Blok terakhir (selalu dijalankan, walau remain=0 → tetap XOR pad(0))
  if (remain >= 8) {
    state[0] ^= loadBytes(plaintext, offset, 8);
    state[1] ^= loadBytes(plaintext, offset + 8, remain - 8);
    storeBytes(ciphertext, offset, state[0], 8);
    storeBytes(ciphertext, offset + 8, state[1], remain - 8);
    state[1] ^= pad(remain - 8);
  } else {
    state[0] ^= loadBytes(plaintext, offset, remain);
    storeBytes(ciphertext, offset, state[0], remain);
    state[0] ^= pad(remain);
  }

  // NB: tidak ada P8 di sini — langsung ke finalize.
  return ciphertext;
}

// Dekripsi payload — kebalikan dari encrypt, dengan logika reset state.
function asconAeadDecryptPayload(state, ciphertext) {
  const plaintext = Buffer.alloc(ciphertext.length, 0);

  let offset = 0;
  let remain = ciphertext.length;

  // Blok penuh 16-byte
  while (remain >= ASCON_AEAD_RATE) {
    const c0 = loadBytes(ciphertext, offset, 8);
    const c1 = loadBytes(ciphertext, offset + 8, 8);
    storeBytes(plaintext, offset, state[0] ^ c0, 8);
    storeBytes(plaintext, offset + 8, state[1] ^ c1, 8);
    state[0] = c0;
    state[1] = c1;
    asconPermute(state, ASCON_PB_ROUNDS);
    offset += ASCON_AEAD_RATE;
    remain -= ASCON_AEAD_RATE;
  }

  // Blok terakhir parsial
  if (remain >= 8) {
    const c0 = loadBytes(ciphertext, offset, 8);
    const c1 = loadBytes(ciphertext, offset + 8, remain - 8);
    storeBytes(plaintext, offset, state[0] ^ c0, 8);
    storeBytes(plaintext, offset + 8, state[1] ^ c1, remain - 8);
    state[0] = c0;
    state[1] = clearBytesFirstN(state[1], remain - 8) | c1;
    state[1] ^= pad(remain - 8);
  } else {
    const c0 = loadBytes(ciphertext, offset, remain);
    storeBytes(plaintext, offset, state[0] ^ c0, remain);
    state[0] = clearBytesFirstN(state[0], remain) | c0;
    state[0] ^= pad(remain);
  }

  return plaintext;
}

// Finalize: XOR kunci ke x[2]/x[3] → P12 → XOR kunci ke x[3]/x[4] → tag = x[3]||x[4]
function asconAeadFinalize(state, key) {
  const K0 = loadBytes(key, 0, 8);
  const K1 = loadBytes(key, 8, 8);

  state[2] ^= K0;
  state[3] ^= K1;

  asconPermute(state, ASCON_PA_ROUNDS);

  state[3] ^= K0;
  state[4] ^= K1;

  const tag = Buffer.alloc(ASCON_TAG_SIZE, 0);
  storeBytes(tag, 0, state[3], 8);
  storeBytes(tag, 8, state[4], 8);
  return tag;
}

// Pembanding constant-time agar tidak bocor lewat timing.
function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

// ── API NIST LWC (untuk testing KAT) ─────────────────────────────────────────

function crypto_aead_encrypt(plaintext, ad, nonce, key) {
  if (key.length !== ASCON_KEY_SIZE) {
    throw new Error(`key harus ${ASCON_KEY_SIZE} byte`);
  }
  if (nonce.length !== ASCON_NONCE_SIZE) {
    throw new Error(`nonce harus ${ASCON_NONCE_SIZE} byte`);
  }

  const state = [0n, 0n, 0n, 0n, 0n];
  asconAeadInit(state, key, nonce);
  asconAeadAbsorbAd(state, ad);
  const ciphertext = asconAeadEncryptPayload(state, plaintext);
  const tag = asconAeadFinalize(state, key);
  return Buffer.concat([ciphertext, tag]);
}

function crypto_aead_decrypt(ciphertextWithTag, ad, nonce, key) {
  if (key.length !== ASCON_KEY_SIZE) {
    throw new Error(`key harus ${ASCON_KEY_SIZE} byte`);
  }
  if (nonce.length !== ASCON_NONCE_SIZE) {
    throw new Error(`nonce harus ${ASCON_NONCE_SIZE} byte`);
  }
  if (ciphertextWithTag.length < ASCON_TAG_SIZE) return null;

  const ctLen = ciphertextWithTag.length - ASCON_TAG_SIZE;
  const ciphertext = ciphertextWithTag.slice(0, ctLen);
  const receivedTag = ciphertextWithTag.slice(ctLen);

  const state = [0n, 0n, 0n, 0n, 0n];
  asconAeadInit(state, key, nonce);
  asconAeadAbsorbAd(state, ad);
  const plaintext = asconAeadDecryptPayload(state, ciphertext);
  const computedTag = asconAeadFinalize(state, key);

  if (!constantTimeEquals(computedTag, receivedTag)) return null;
  return plaintext;
}

// ── Helper hex/buffer ────────────────────────────────────────────────────────
function hexToBuf(hex, expectedLen) {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("hex tidak valid");
  }
  const buf = Buffer.from(hex, "hex");
  if (expectedLen && buf.length !== expectedLen) {
    throw new Error(`panjang hex tidak sesuai (${expectedLen} byte)`);
  }
  return buf;
}

function bufToHex(buf) {
  return Buffer.from(buf).toString("hex");
}

// Big-endian writer untuk counter di dalam nonce (konvensi aplikasi,
// bukan bagian dari algoritma Ascon). Backend & firmware harus sepakat.
function writeUint64BE(buffer, offset, value) {
  let v = BigInt(value);
  for (let i = 7; i >= 0; i -= 1) {
    buffer[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

// ── API tingkat aplikasi (envelope MQTT) ────────────────────────────────────
// Bentuk envelope tidak berubah dari v1.2 — hanya algoritma di dalamnya
// yang upgrade ke Ascon-AEAD128.

// Dekripsi envelope telemetry dari device: lookup key by kid → decrypt → verify.
function decryptTelemetryEnvelope(envelope, keyring) {
  const keyHex = keyring[envelope.kid];
  if (!keyHex) {
    throw new Error(`key kid ${envelope.kid} tidak ditemukan`);
  }

  const keyBytes = hexToBuf(keyHex, ASCON_KEY_SIZE);
  const nonceBytes = hexToBuf(envelope.nonce, ASCON_NONCE_SIZE);
  const tagBytes = hexToBuf(envelope.tag, ASCON_TAG_SIZE);
  const cipherBytes = hexToBuf(envelope.cipher);
  // AAD telemetry = device_id sebagai byte UTF-8 (sesuai kontrak firmware)
  const aadBytes = Buffer.from(envelope.device_id, "utf8");

  // Gabung ciphertext+tag untuk dipakai crypto_aead_decrypt
  const ctTag = Buffer.concat([cipherBytes, tagBytes]);
  const plaintext = crypto_aead_decrypt(ctTag, aadBytes, nonceBytes, keyBytes);

  if (plaintext === null) {
    throw new Error("tag tidak valid (payload kemungkinan rusak/diubah)");
  }
  return plaintext.toString("utf8");
}

// Enkripsi command dashboard → device. Format envelope identik dengan firmware:
// { enc, device_id, kid, ctr, nonce, tag, cipher, command_id }.
// Command memakai AAD kosong (sesuai kontrak firmware).
function encryptCommandEnvelope({
  keyring,
  kid,
  deviceId,
  commandId,
  command,
  counter,
  noncePrefixHex,
}) {
  const keyHex = keyring[kid];
  if (!keyHex) {
    throw new Error(`key kid ${kid} tidak ditemukan`);
  }

  if (!deviceId || typeof deviceId !== "string") {
    throw new Error("deviceId tidak valid");
  }
  if (!commandId || typeof commandId !== "string") {
    throw new Error("commandId tidak valid");
  }
  if (!command || typeof command !== "string") {
    throw new Error("command tidak valid");
  }
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error("counter harus integer aman >= 0");
  }

  const keyBytes = hexToBuf(keyHex, ASCON_KEY_SIZE);
  const prefixBytes = hexToBuf(noncePrefixHex, 8);
  const nonceBytes = Buffer.alloc(ASCON_NONCE_SIZE, 0);
  prefixBytes.copy(nonceBytes, 0);
  // Counter ditulis BE (konvensi aplikasi, bukan bagian dari algoritma)
  writeUint64BE(nonceBytes, 8, BigInt(counter));

  const aadBytes = Buffer.alloc(0);
  const plainText = JSON.stringify({ command });
  const plainBytes = Buffer.from(plainText, "utf8");

  const ctTag = crypto_aead_encrypt(plainBytes, aadBytes, nonceBytes, keyBytes);
  const cipherBytes = ctTag.slice(0, ctTag.length - ASCON_TAG_SIZE);
  const tagBytes = ctTag.slice(ctTag.length - ASCON_TAG_SIZE);

  return {
    enc: 1,
    device_id: deviceId,
    kid,
    ctr: counter,
    nonce: bufToHex(nonceBytes),
    tag: bufToHex(tagBytes),
    cipher: bufToHex(cipherBytes),
    command_id: commandId,
  };
}

module.exports = {
  // Konstanta
  ASCON_KEY_SIZE,
  ASCON_NONCE_SIZE,
  ASCON_TAG_SIZE,
  ASCON_AEAD128_IV,

  // Primitif (untuk testing KAT)
  asconPermute,
  asconAeadInit,
  asconAeadAbsorbAd,
  asconAeadEncryptPayload,
  asconAeadDecryptPayload,
  asconAeadFinalize,
  constantTimeEquals,

  // NIST LWC API
  crypto_aead_encrypt,
  crypto_aead_decrypt,

  // API envelope aplikasi (dipakai telemetryHandler & commandHandler)
  decryptTelemetryEnvelope,
  encryptCommandEnvelope,
};
