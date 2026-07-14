# Firmware — KONDISI TANPA ENKRIPSI (baseline uji keamanan TA)

Folder ini adalah **salinan lengkap & mandiri** dari firmware, tetapi dikonfigurasi
untuk **kondisi tanpa enkripsi** (`EXPERIMENT_NO_ENCRYPTION = 1`). Dipakai HANYA untuk
mengumpulkan data baseline serangan (injeksi, replay, tampering) pada perangkat asli,
sebagai pembanding terhadap firmware produksi (ASCON-AEAD128) di folder `firmware/`.

> ⚠️ **JANGAN dipakai untuk deployment nyata.** Ini firmware sengaja dilemahkan.
> Firmware produksi tetap di folder `firmware/`.

## Apa bedanya dengan produksi?
Hanya **jalur command**. Di sini perangkat menerima perintah **plaintext** langsung
(mis. `relay_on`) TANPA:
- parse envelope terenkripsi,
- dekripsi ASCON,
- verifikasi tag autentikasi,
- pengecekan anti-replay (counter).

Telemetri tetap terenkripsi ASCON (tidak diubah) — cukup untuk menguji serangan
pada jalur perintah.

## Cara build & flash
Build dari folder `core/` (root project IDF), variant `smart_socket`:
```
# di ESP-IDF terminal, dari dalam folder core/ salinan ini
idf.py set-target esp32s3       # (jika folder build belum ada)
idf.py build
idf.py -p COM7 flash monitor
```
(atau lewat extension ESP-IDF: pilih folder `core` ini sebagai project, build & flash.)

Saat boot & menerima perintah, serial monitor akan menandai `[NO-ENC]`.

## Cara uji serangan (lewat MQTTX, tanpa web)

Subscribe untuk melihat hasil:
```
devices/smart_socket/ack
devices/smart_socket/relay/status
```

Publish serangan **plaintext** ke `devices/smart_socket/command`:

| Serangan  | Payload                       | Hasil (perangkat no-enc)                         |
|-----------|-------------------------------|--------------------------------------------------|
| Injeksi   | `relay_on`                    | relay MENYALA — perintah palsu dieksekusi        |
| Replay    | `relay_toggle` (kirim 2x)     | relay toggle 2x — tidak ada anti-replay          |
| Tampering | `relay_off` lalu `relay_on`   | relay eksekusi isi yang diubah                   |

Bukti: serial monitor (`[NO-ENC] Perintah PLAINTEXT diterima TANPA verifikasi`),
MQTTX ack (`status: ok`), MQTTX relay/status (`ON`).

## Kontras dengan produksi (folder `firmware/`, ASCON)
Payload plaintext yang sama akan DITOLAK:
- Injeksi  -> `format command tidak valid`
- Replay   -> `replay terdeteksi`
- Tampering -> `decrypt/tag validation gagal`

## Setelah selesai
Flash kembali firmware **produksi** dari folder `firmware/` agar perangkat kembali
ke sistem ASCON. Folder ini boleh Anda simpan/pindahkan terpisah untuk arsip TA.
