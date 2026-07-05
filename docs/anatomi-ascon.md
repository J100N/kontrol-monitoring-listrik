# Anatomi Algoritma ASCON-AEAD128 (VoltGuard)

Dokumen ini merinci **seluruh komponen penyusun** ASCON-AEAD128 pada sistem:
ukuran, isi, **asal-usul (acak/hardcode/turunan/dihitung)**, letak kode, dan
kapan berubah. Disusun untuk lampiran Tugas Akhir.

- Algoritma: **ASCON-AEAD128** (standar **NIST SP 800-232**, final 13 Agustus 2025)
- Implementasi: firmware [ascon.c](../firmware/core/components/ascon_crypto/ascon.c) (C) ·
  backend [asconAead128.js](../backend/mqtt_worker/src/handlers/asconAead128.js) (Node.js)
- Verifikasi: KAT 1089/1089 PASS terhadap `LWC_AEAD_KAT_128_128.txt` resmi

---

## 1. Komponen Utama

| Komponen | Ukuran | Isi / Sumber | Rahasia? |
|---|---|---|---|
| **Key** | 16 byte (128-bit) | `101112131415161718191a1b1c1d1e1f` (kid=1) | ✅ Ya |
| **IV** | 8 byte (64-bit) | konstanta turunan parameter = `0x00001000808C0001` | ❌ Publik |
| **Nonce (Npub)** | 16 byte (128-bit) | prefix 8B + counter 8B (lihat §3) | ❌ Publik (wajib unik) |
| **AAD** | variabel | telemetri = `device_id` · command = kosong | ❌ Publik |
| **Plaintext** | variabel | JSON (sampel sensor / `{"command":...}`) | — (dilindungi) |
| **Ciphertext** | = panjang plaintext | hasil enkripsi (`cipher`) | — |
| **Tag** | 16 byte (128-bit) | bukti keaslian + keutuhan | ❌ Publik |

---

## 2. Struktur IV (64-bit) — NIST SP 800-232 §3.2

IV dirakit dari **parameter algoritma**, bukan nilai acak. Hasil: `0x00001000808C0001`.

| Sub-field | Nilai | Arti | Posisi bit |
|---|---|---|---|
| variant | `1` | mode AEAD | `<< 0` |
| pᵃ (ronde a) | `12` (0x0C) | ronde init & finalize | `<< 16` |
| pᵇ (ronde b) | `8` (0x08) | ronde per blok rate | `<< 20` |
| tag length | `128` (0x80) | panjang tag (bit) | `<< 24` |
| rate | `16` (0x10) | rate (byte) | `<< 40` |

> IV **identik** di firmware & backend. Karena turunan parameter publik, IV
> bukan rahasia dan sama untuk semua pesan/semua device.

---

## 3. Struktur Nonce (16 byte = prefix + counter)

| Bagian | Byte ke- | Isi | Arah telemetri | Arah command |
|---|---|---|---|---|
| **Prefix** | 0–7 (8B) | pembeda sesi | acak per boot (`esp_fill_random`) | tetap `0000000000000001` (`.env`) |
| **Counter** | 8–15 (8B, **big-endian**) | angka naik monoton | `tx_counter` ESP32 | `commandCounter` server |

> Gabungan prefix+counter menjamin **nonce tak pernah berulang** untuk satu Key →
> memenuhi syarat wajib AEAD (anti nonce-reuse) sekaligus berfungsi anti-replay.

---

## 4. AAD (Associated Data) per Arah

| Arah | AAD | Tujuan |
|---|---|---|
| Telemetri (device→server) | `device_id` (UTF-8, mis. `smart_socket`) | mengikat ciphertext ke perangkat tertentu |
| Command (server→device) | **kosong** (0 byte) | kontrak khusus perintah |

> AAD **ikut diverifikasi tag** tetapi **tidak dienkripsi** (tidak masuk `cipher`).

---

## 5. Counter (jenis & sumber)

| Counter | Lokasi | Nilai awal | Naik kapan | Persistensi |
|---|---|---|---|---|
| `tx_counter` (telemetri) | ESP32 | NVS + reserve 256 tiap boot | tiap kirim telemetri | NVS flash (`ascon`/`tx_ctr`) |
| `last_rx_counter` (command) | ESP32 | `UINT64_MAX` (unset) | saat terima command valid | RAM (reset saat reboot) |
| `commandCounter` (command) | server | `Date.now()*1000` (mikrodetik) | tiap kirim perintah | file `command_counter.json` |
| `replayGuard` (telemetri) | server | `ctr` terakhir per device | tiap telemetri valid | file `replay_state.json` |

---

## 6. Timestamp: di mana saja muncul

> Penting: **timestamp TIDAK ada di IV maupun nonce.** Nonce hanya berisi
> prefix + counter.

| Timestamp | Letak | Format | Asal |
|---|---|---|---|
| Waktu pengukuran sampel | **plaintext** payload, field `ts` | epoch **ms** | jam ESP32 saat baca PZEM |
| Waktu point InfluxDB | `_time` measurement | ms | diambil dari `ts` sampel |
| "Seed" counter command | tertanam di nilai `commandCounter` | mikrodetik (`Date.now()*1000`) | jam server (bukan field terpisah) |

---

## 7. Pemetaan ke Field Envelope MQTT

| Field envelope | Komponen ASCON | Contoh |
|---|---|---|
| `enc` | penanda terenkripsi | `1` |
| `device_id` | = AAD (telemetri) | `smart_socket` |
| `kid` | pemilih Key | `1` |
| `ctr` | nilai Counter (di nonce) | `10482` |
| `nonce` | Nonce 16B (prefix+counter) | `0000…0001` + counter BE |
| `tag` | Tag 16B | `9f8e…b1a0` |
| `cipher` | Ciphertext | `3c5a9f…e2` |
| `command_id` | metadata (command saja) | `cmd-7f3a` |

---

## 8. Klasifikasi Asal-Usul Tiap Komponen

| Komponen | Klasifikasi | Cara mendapatnya (persis) | Letak kode | Berubah kapan |
|---|---|---|---|---|
| **Key** | 🔴 Hardcoded | byte tetap di firmware & string di `.env` | [device_profile.h:28](../firmware/devices/smart_socket/device_profile.h) · `.env` `ASCON_KEYRING_JSON` | tidak pernah (kecuali ganti manual) |
| **kid** | 🔴 Hardcoded | konstanta `1` | [device_profile.h:27](../firmware/devices/smart_socket/device_profile.h) · `.env` `ASCON_ACTIVE_KID` | tidak pernah |
| **IV** | 🟢 Turunan parameter | dihitung dari variant/pᵃ/pᵇ/taglen/rate | [asconAead128.js:42](../backend/mqtt_worker/src/handlers/asconAead128.js) | tidak pernah |
| **Nonce prefix — telemetri** | 🎲 Acak (RNG) | `esp_fill_random()` → 8 byte acak | [ascon.c:384](../firmware/core/components/ascon_crypto/ascon.c) | **tiap boot** ESP32 |
| **Nonce prefix — command** | 🔴 Hardcoded (config) | nilai tetap `0000000000000001` | `.env` `ASCON_COMMAND_NONCE_PREFIX_HEX` | tidak pernah |
| **Counter — telemetri (tx)** | 🔵 Stateful + reserve | baca NVS → lompat +256 → increment | [app_main.c:53-66](../firmware/devices/smart_socket/app_main.c) | tiap paket telemetri |
| **Counter — command (server)** | 🕒 Berbasis waktu + increment | seed `Date.now()*1000`, lalu `max(seed,last+1)` | [commandCounter.js:12](../backend/mqtt_worker/src/security/commandCounter.js) | tiap perintah dikirim |
| **last_rx_counter (device)** | ⚙️ State runtime | diambil dari nonce paket masuk valid | [ascon.c:501-510](../firmware/core/components/ascon_crypto/ascon.c) | tiap command valid (volatile) |
| **replayGuard (server)** | 🔵 Stateful | simpan `ctr` terakhir per device | [replayGuard.js](../backend/mqtt_worker/src/security/replayGuard.js) | tiap telemetri valid |
| **AAD — telemetri** | 🟣 Turunan identitas | = `device_id` | [asconAead128.js:386](../backend/mqtt_worker/src/handlers/asconAead128.js) | tidak pernah |
| **AAD — command** | 🟢 Konstanta | kosong (0 byte) | [asconAead128.js:435](../backend/mqtt_worker/src/handlers/asconAead128.js) | tidak pernah |
| **Plaintext (`ts` sampel)** | 📟 Sensor/jam runtime | epoch ms jam ESP32 saat baca PZEM | firmware telemetry build | tiap sampel (per detik) |
| **Ciphertext (`cipher`)** | 🧮 Output algoritma | hasil enkripsi plaintext | `asconAeadEncryptPayload` | tiap pesan |
| **Tag** | 🧮 Output algoritma | dihitung dari key+nonce+AAD+plaintext | `asconAeadFinalize` | tiap pesan |

### Ringkasan per kategori

| Kategori | Komponen | Karakter |
|---|---|---|
| 🔴 Hardcoded/config | Key, kid, nonce-prefix command, AAD command | tetap, ditulis manusia |
| 🎲 Acak (RNG) | nonce-prefix telemetri | tak terprediksi, per boot |
| 🟢 Turunan parameter | IV, AAD command kosong | deterministik dari spesifikasi |
| 🟣 Turunan identitas | AAD telemetri (`device_id`) | dari profil device |
| 🔵🕒 Counter (stateful) | counter telemetri (NVS), counter command (waktu), replayGuard | naik monoton, persisted |
| 📟 Runtime sensor/jam | `ts` plaintext | dari pengukuran |
| 🧮 Output algoritma | ciphertext, tag | dihitung otomatis |

---

## 9. Catatan Penting (sering ditanya penguji)

1. **Hanya satu komponen yang acak**: nonce-prefix telemetri (`esp_fill_random`).
   Sisanya hardcoded, turunan, atau dihitung. Nonce-prefix **command justru tetap** —
   keunikan nonce-nya dijamin **counter berbasis waktu**, bukan prefix acak.
2. **IV ≠ acak**. IV adalah konstanta turunan parameter standar — sama di semua
   pesan & semua device. Yang membuat tiap enkripsi unik adalah **nonce**, bukan IV.
3. **Timestamp bukan bagian kripto**. Ia hidup di **plaintext** (`ts`) lalu menjadi
   `_time` di InfluxDB; tidak pernah masuk IV/nonce.
4. **Yang rahasia hanya Key**. IV, Nonce, AAD, Tag semuanya publik/terkirim apa adanya.
5. **Tag & ciphertext tidak "diambil"** — keduanya **dihasilkan** fungsi enkripsi,
   sehingga tak bisa dipalsukan tanpa Key (dasar penolakan serangan MitM/injeksi).
6. **Key hardcoded** = keterbatasan yang ditandai kode sendiri
   (`// TODO produksi: pindahkan key ke secure provisioning/NVS`,
   [device_profile.h:26](../firmware/devices/smart_socket/device_profile.h)).
   Wajar untuk skala TA; sebut sebagai *limitation*.
