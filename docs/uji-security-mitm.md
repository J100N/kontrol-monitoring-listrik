# Uji Keamanan — Simulasi MitM & Injeksi MQTT (VoltGuard)

Dokumen ini berisi **alur uji keamanan**, **contoh payload konkret** yang dikirim
dari MQTTX, **cara membandingkan hasil**, dan **tahap penolakan** tiap serangan.
Disusun untuk lampiran Tugas Akhir. Target uji: segmen komunikasi
**ESP32-S3 (`smart_socket`) ↔ Broker MQTT** yang diamankan dengan ASCON-AEAD128.

> ⚠️ Pengujian dilakukan pada sistem milik sendiri di lingkungan lab terisolasi.

---

## 1. Persiapan & Posisi Penyerang

| Item | Detail |
|---|---|
| Target segmen | ESP32-S3 ↔ Broker MQTT (`167.71.195.81:1883`) |
| Posisi penyerang | Host di Wi-Fi yang sama dengan ESP32 & broker |
| ARP poisoning | `arpspoof -i wlan0 -t <IP_ESP32> <IP_gateway>` (+ arah sebaliknya) |
| Sniffing | Wireshark, filter `mqtt` atau `tcp.port == 1883` |
| Klien serang | MQTTX → host `<IP_BROKER>`, port `1883`, kredensial broker (tidak dicantumkan) |

---

## 2. Konsep "Envelope" (kunci memahami hasil uji)

Yang dikirim lewat MQTT **bukan** perintah mentah, melainkan **envelope**: amplop
JSON berisi pesan terenkripsi (`cipher`) + metadata untuk dekripsi & verifikasi.

**Envelope command yang BENAR (valid):**
```json
{
  "enc": 1,
  "device_id": "smart_socket",
  "kid": 1,
  "ctr": 37,
  "nonce": "00000000000000010000000000000025",
  "tag": "9f8e7d6c5b4a39281706f5e4d3c2b1a0",
  "cipher": "3c5a9f7e21",
  "command_id": "cmd-7f3a"
}
```

| Field | Wajib | Isi | Fungsi |
|---|---|---|---|
| `enc` | ✅ | `1` | penanda terenkripsi |
| `device_id` | ✅ | `smart_socket` | identitas tujuan |
| `kid` | ✅ | `1` | pemilih kunci |
| `ctr` | ✅ | angka naik | cek anti-replay |
| `nonce` | ✅ | hex 32 char (prefix 8B + counter 8B BE) | input dekripsi |
| `tag` | ✅ | hex 32 char | verifikasi keaslian+keutuhan |
| `cipher` | ✅ | hex variabel | isi perintah terenkripsi |
| `command_id` | ✅ | `cmd-xxxx` | korelasi ACK |

> Setelah dekripsi, `cipher` menjadi plaintext asli, mis. `{"command":"relay_on"}`.

---

## 3. Dua Gerbang Penolakan di ESP32

Firmware memproses command berurutan ([app_main.c:381-393](../firmware/devices/smart_socket/app_main.c)):

| Gerbang | Fungsi | Yang dicek | Jika gagal |
|---|---|---|---|
| **1. Parse envelope** | `telemetry_parse_encrypted_command()` | ada field `nonce`/`tag`/`cipher`/dll? | ack `"format command tidak valid"` |
| **2. Dekripsi + verifikasi** | `telemetry_decrypt_command()` → ASCON | tag cocok? counter fresh? | ack `"decrypt command gagal"` / "replay terdeteksi" |

---

## 4. Topik untuk Subscribe (membaca hasil di MQTTX)

| Topik | Isi | Guna saat uji |
|---|---|---|
| `devices/smart_socket/ack` | ACK plaintext | lihat balasan error/ok |
| `devices/smart_socket/relay/status` | status relay ON/OFF | bukti relay berubah / tidak |
| `devices/smart_socket/telemetry` | envelope terenkripsi | bahan tangkapan & uji keterbacaan |
| `devices/smart_socket/command` | envelope terenkripsi | bahan tangkapan untuk replay |

---

## 5. Tabel Uji Lengkap + Contoh Payload

> **Publish ke topik tujuan**; amati 3 bukti: balasan di `ack`, perubahan di
> `relay/status`, dan log worker/serial ESP32.

### Uji 5a — Perintah plaintext palsu

| | |
|---|---|
| Topik publish | `devices/smart_socket/command` |
| Payload | `{"command":"relay_on"}` |
| Variasi | `{"command":"relay_off"}` · `{"relay":"ON"}` |
| Gugur di | **Gerbang 1 (parse)** — bukan envelope |
| ACK diterima | `{"device_id":"smart_socket","command_id":"cmd-invalid","status":"error","message":"format command tidak valid"}` |
| Relay | tidak berubah |

### Uji 5b — Envelope tebakan (struktur benar, isi acak)

| | |
|---|---|
| Topik publish | `devices/smart_socket/command` |
| Payload | `{"enc":1,"device_id":"smart_socket","kid":1,"ctr":999999,"nonce":"00000000000000010000000000099999","tag":"ffffffffffffffffffffffffffffffff","cipher":"deadbeef","command_id":"cmd-fake"}` |
| Gugur di | **Gerbang 2 (tag)** — tag tidak cocok (tanpa Key) |
| ACK diterima | `{"...","command_id":"cmd-fake","status":"error","message":"decrypt command gagal"}` |
| Relay | tidak berubah |

### Uji 5c — Replay (kirim ulang envelope ASLI yang valid)

| | |
|---|---|
| Topik publish | `devices/smart_socket/command` |
| Payload | *(copy-paste persis envelope hasil tangkapan, mis.)* `{"enc":1,"device_id":"smart_socket","kid":1,"ctr":37,"nonce":"00000000000000010000000000000025","tag":"9f8e7d6c5b4a39281706f5e4d3c2b1a0","cipher":"3c5a9f7e21","command_id":"cmd-7f3a"}` |
| Gugur di | **Gerbang 2 (counter)** — `ctr ≤ last_rx_counter` |
| Log device | `replay terdeteksi: counter=37 last=37` |
| Relay | tidak berubah |

### Uji 5d — Tampering / bit-flip (ubah 1 karakter hex)

| | |
|---|---|
| Topik publish | `devices/smart_socket/command` |
| Payload | envelope asli, ubah **1 char** di `cipher`: `...,"cipher":"3c5a9f7e22",...` (akhiran `21`→`22`) |
| Variasi | ubah 1 char di `tag` |
| Gugur di | **Gerbang 2 (tag)** — keutuhan rusak |
| ACK diterima | `status":"error","message":"decrypt command gagal"` |
| Relay | tidak berubah |

### Uji 5e — Telemetri palsu (manipulasi data ukur)

| | |
|---|---|
| Topik publish | `devices/smart_socket/telemetry` |
| Payload (palsu) | `{"enc":1,"device_id":"smart_socket","kid":1,"ctr":12345,"nonce":"a1b2c3d4e5f6a7b80000000000003039","tag":"00112233445566778899aabbccddeeff","cipher":"abcdef0123","command_id":"x"}` |
| Payload (replay) | copy envelope telemetri asli lalu kirim ulang |
| Ditolak oleh | **mqtt_worker** — tag invalid / `ctr` replay |
| Bukti | log worker `ctr replay terdeteksi` atau `tag tidak valid`; **tidak ada point baru** di InfluxDB `power_telemetry` |

### Uji 5f — Injeksi via jalur internal (uji *trust boundary*) ⚠️

| | |
|---|---|
| Topik publish | `dashboard/devices/smart_socket/command` |
| Payload | `{"command":"relay_on","command_id":"cmd-mitm","issued_by":"attacker"}` |
| Hasil | **DITERIMA** — worker mengenkripsi & meneruskan ke device → relay **ON** |
| Catatan | Bukan kelemahan ASCON, tapi batasan model ancaman: topik internal `dashboard/+` plaintext & dianggap tepercaya. Lihat §7. |

---

## 6. Perbandingan Tanpa Enkripsi vs Dengan ASCON

| Parameter | Tanpa enkripsi (baseline) | Dengan ASCON-AEAD128 | Cara mengamati |
|---|---|---|---|
| Keterbacaan payload | `{"command":"relay_on"}` terbaca | hanya `cipher` hex acak | Wireshark / subscribe |
| Manipulasi data ukur | nilai V/I/P bisa diedit & diterima | gagal — tag tidak cocok | log worker |
| Perintah kendali palsu | relay mengikuti perintah penyerang | ditolak di ESP32 (Gerbang 1/2) | `ack` + serial ESP32 |
| Replay | perintah lama bisa dikirim ulang | ditolak (`ctr ≤ last`) | log "replay terdeteksi" |
| Keutuhan (1 bit diubah) | tidak terdeteksi | ditolak (tag invalid) | serial ESP32 |

---

## 7. Ringkasan Tahap Penolakan & Analisis

| Uji | Bentuk payload | Gugur di | Alasan |
|---|---|---|---|
| 5a | `{"command":"relay_on"}` | Gerbang 1 (parse) | bukan envelope |
| 5b | envelope isi acak | Gerbang 2 (tag) | tag tak valid tanpa Key |
| 5c | envelope asli, kirim ulang | Gerbang 2 (counter) | `ctr` tidak fresh |
| 5d | envelope asli, 1 byte diubah | Gerbang 2 (tag) | keutuhan rusak |
| 5e | telemetri palsu/replay | worker | tag / `ctr` |
| 5f | plaintext ke topik internal | — (diterima) | trust boundary, bukan isu ASCON |

**Kesimpulan untuk sidang:**
1. Penyerang **bisa** membuat amplop berbentuk benar (lolos Gerbang 1), tapi
   **tidak bisa** membuat `tag`+`cipher` valid tanpa **Key** (gugur Gerbang 2).
2. Menyalin amplop asli yang valid pun gagal karena **counter anti-replay**.
3. Satu-satunya jalur yang menerima perintah penyerang (5f) bukan kelemahan
   kriptografi, melainkan **asumsi jaringan internal tepercaya** — limitation yang
   bisa diperbaiki dengan **ACL broker per-topik** + autentikasi antar layanan.
4. Plaintext `ack`/`relay/status` membocorkan status (ON/OFF, online) namun
   **non-sensitif** dan tak bisa dipakai mengendalikan aktuator.
