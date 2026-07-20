# Baseline: Endpoint Tanpa Enkripsi (pembanding uji keamanan)

Folder ini merepresentasikan **"kondisi tanpa fitur (tanpa enkripsi)"** pada tabel
pengujian keamanan MitM. Perangkat asli (ESP32 + ASCON-AEAD128) **menolak** semua
serangan; simulator di sini menunjukkan bahwa **tanpa enkripsi, serangan berhasil**.

## AMAN — tidak menyentuh relay asli
Simulator memakai topik **terpisah** `devices/sim_plain/command`.
ESP32 asli hanya subscribe `devices/smart_socket/command`, jadi serangan di sini
**tidak pernah** sampai ke perangkat/relay fisik.

## Isi
- `device_sim.js` — perangkat tiruan yang menerima perintah plaintext TANPA verifikasi
  (tanpa tag ASCON, tanpa anti-replay) lalu langsung mengeksekusinya.
- `serang.js` — penyerang otomatis: injeksi -> replay -> tampering berurutan.

## Cara menjalankan (2 terminal, dari folder ini)

```
# Terminal 1 — nyalakan device tanpa enkripsi
node device_sim.js

# Terminal 2 — jalankan serangan
node serang.js
```

Amati **Terminal 1**: ketiga serangan menghasilkan `PERINTAH DITERIMA & DIEKSEKUSI`
(relay berubah), termasuk pesan replay yang tetap dieksekusi ulang. Screenshot
terminal ini = bukti kolom **"Tanpa Enkripsi"** untuk baris injeksi, replay, tampering.

## Alternatif: serang manual via MQTTX
Publish ke topik `devices/sim_plain/command`:

| Uji       | Payload                                   | Hasil di device_sim |
|-----------|-------------------------------------------|---------------------|
| Injeksi   | `{"command":"ON"}`                        | RELAY -> ON (dieksekusi) |
| Replay    | publish payload yang sama **2x**          | dieksekusi lagi (tanpa anti-replay) |
| Tampering | `{"command":"OFF"}` lalu ubah ke `{"command":"ON"}` | eksekusi isi yang diubah |

## Kontras dengan kondisi DENGAN fitur (ASCON)
Perangkat asli menolak ketiganya:
- Injeksi  -> `format command tidak valid` (bukan format ASCON)
- Replay   -> `replay terdeteksi: counter=X last=Y`
- Tampering -> `decrypt/tag validation gagal`

dan semuanya tercatat di **Log Keamanan** dashboard.
