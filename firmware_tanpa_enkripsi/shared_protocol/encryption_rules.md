# Aturan Enkripsi ASCON-128

Dokumen ini menjadi acuan tunggal untuk enkripsi/dekripsi data antara endpoint ESP32-S3 dan backend.

## Tujuan

1. Menjamin kerahasiaan data monitoring dan command.
2. Menjamin integritas data (deteksi modifikasi payload).
3. Mencegah replay command melalui counter nonce.

## Algoritma

1. Gunakan ASCON-128 (AEAD).
2. Nonce 16 byte.
3. Tag autentikasi 16 byte.
4. Ciphertext dan plaintext memiliki panjang sama.

## Arah Data dan Aturan

1. ESP32 ke Backend (telemetry monitoring): WAJIB terenkripsi.
2. Backend ke ESP32 (command kontrol): WAJIB terenkripsi.
3. ESP32 ke Backend (event kontrol otomatis): DISARANKAN terenkripsi.
4. ESP32 ke Backend (ACK command): DISARANKAN terenkripsi.

## Format Payload Terenkripsi (MQTT JSON)

Field wajib:

1. `enc`: nilai tetap `1`.
2. `device_id`: ID device.
3. `kid`: key id aktif.
4. `ctr`: counter nonce.
5. `nonce`: hex string 32 karakter.
6. `tag`: hex string 32 karakter.
7. `cipher`: hex string (panjang genap, minimal 2 karakter).
8. `command_id`: string unik command untuk korelasi ACK.

Contoh:

```json
{
  "enc": 1,
  "device_id": "smart_socket",
  "kid": 1,
  "ctr": 134,
  "nonce": "0a0b0c0d0e0f10110000000000000086",
  "tag": "d87f73a22f9f9b61f4f63a8f2f1134ad",
  "cipher": "a1b2c3d4",
  "command_id": "cmd-134"
}
```

## AAD (Additional Authenticated Data)

1. Telemetry: gunakan `device_id` sebagai AAD.
2. Command: AAD default `null` (kosong) untuk kompatibilitas saat ini.
3. Jika AAD command diaktifkan pada versi berikutnya, backend dan firmware wajib sinkron pada hari yang sama.

## Key Management

1. `kid` harus ikut dikirim pada payload terenkripsi.
2. Firmware boleh menerima active key dan previous key untuk masa transisi rotasi.
3. Kunci produksi tidak boleh hardcoded di source code final.

## Replay Protection

1. Counter pada nonce harus monotonik naik.
2. Endpoint wajib menolak counter yang lebih kecil atau sama dengan `last_rx_counter`.
3. Counter terakhir valid sebaiknya dipersist di storage aman.

## Error Handling

1. Tag invalid: tolak payload, log warning, jangan eksekusi command.
2. Nonce/counter replay: tolak payload, log warning.
3. JSON malformed: tolak payload, kirim ACK error jika channel ACK tersedia.

## Catatan Implementasi

1. Firmware dan backend wajib memakai payload terenkripsi untuk telemetry dan command.
2. Payload plaintext dianggap invalid dan harus ditolak.
