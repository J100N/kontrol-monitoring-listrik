# MQTT Worker Backend

Worker ini menangani alur data utama antara ESP32, InfluxDB, dan dashboard:

1. Subscribe telemetry dari device (`devices/+/telemetry`).
2. Simpan envelope ciphertext telemetry ke InfluxDB.
3. Decrypt payload telemetry ASCON (envelope `enc=1`).
4. Validasi payload plaintext telemetry.
5. Simpan telemetry plaintext ke InfluxDB.
6. Subscribe command dari dashboard (`dashboard/devices/+/command`).
7. Enkripsi command dashboard dengan ASCON-128.
8. Publish command terenkripsi ke topik device (`devices/{device_id}/command`).
9. Kirim status proses balik ke dashboard (`dashboard/devices/{device_id}/status`).

## Kanal Status Dashboard

Status balik ke dashboard dibedakan agar troubleshooting lebih cepat:

1. `monitoring`: proses ingest telemetry (parse, decrypt, validasi, simpan DB).
2. `manual_control`: proses command dari dashboard ke device.
3. `auto_control`: ACK dari device untuk aksi otomatis (`command_id` berawalan `auto-`).
4. `device_state`: update status relay dan konektivitas device.

Field tambahan pada payload status:

1. `channel`: kategori alur status.
2. `event_type`: event spesifik pada channel.
3. `command_id`, `relay_status`, `connectivity_status`: diisi jika relevan.

## Struktur Folder

- `src/worker.js`: orchestrator utama MQTT worker.
- `src/config/env.js`: pembacaan + validasi environment.
- `src/handlers/asconAead128.js`: enkripsi & dekripsi Ascon-AEAD128 (NIST SP 800-232) kompatibel firmware.
- `src/handlers/payloadValidator.js`: validasi envelope encrypted, telemetry, dan command.
- `src/handlers/telemetryHandler.js`: proses telemetry sampai simpan ke Influx.
- `src/handlers/commandHandler.js`: proses command dashboard ke device.
- `src/handlers/deviceEventHandler.js`: pemrosesan `ack`, `relay/status`, `connectivity/status` dari device.
- `src/influx_writer/influxWriter.js`: writer InfluxDB.
- `src/tools/e2eLiveCheck.js`: checker live end-to-end (MQTT + Influx).

## Alur Kerja End-to-End (Ringkas)

1. Device kirim telemetry terenkripsi ke `devices/{device_id}/telemetry`.
2. Worker parse JSON envelope dan validasi struktur dasar.
3. Worker simpan envelope ciphertext ke InfluxDB.
4. Worker decrypt payload ASCON, validasi plaintext telemetry, lalu simpan ke InfluxDB.
5. Worker kirim status ingest ke `dashboard/devices/{device_id}/status`.
6. Dashboard kirim command ke `dashboard/devices/{device_id}/command`.
7. Worker validasi command, enkripsi ASCON, publish ke `devices/{device_id}/command`.
8. Worker proses `ack`, `relay/status`, dan `connectivity/status` dari device untuk update status dashboard real-time.

## Checklist Kerapian Folder

Gunakan checklist ini agar tidak ada file/folder menumpuk, duplikat, atau tidak berguna:

1. Hapus folder kosong yang tidak punya rencana implementasi dekat.
2. Jangan simpan logic yang sama di dua handler berbeda; ekstrak ke helper/validator jika berulang.
3. Simpan satu sumber kebenaran untuk topik MQTT di `src/config/env.js`.
4. Hindari menaruh file hasil eksperimen manual di `src/`; pindahkan ke `tests/` atau `docs/`.
5. Dokumentasikan setiap alur baru di README ini saat menambah modul.

## Cara Menjalankan

1. Install dependency:

```bash
npm install
```

2. Salin `.env.example` menjadi `.env`, lalu isi nilai sesuai environment Anda.

3. Jalankan worker:

```bash
npm start
```

## Uji Live End-to-End Cepat

Worker menyediakan checker live untuk menguji alur:

1. Command ON/OFF dari dashboard topic
2. Forward command terenkripsi ke device topic
3. ACK/status dari device
4. Telemetry terenkripsi masuk
5. Data masuk ke dua measurement Influx

Jalankan:

```bash
npm run e2e:live
```

Opsional env uji:

1. `E2E_DEVICE_ID` (default: `smart_socket`)
2. `E2E_WAIT_MS` (default: `15000`)
3. `E2E_STRICT` (default: `false`).

Perilaku checker:

1. Mode default (`E2E_STRICT=false`): wajib lulus jalur command dasar (`commandEncrypted`, `dashboardManualForwarded`, `ack`).
2. Mode ketat (`E2E_STRICT=true`): semua kanal wajib lulus termasuk telemetry, relay/connectivity status, dan dua measurement Influx.

Checker akan mengembalikan ringkasan PASS/FAIL per kanal agar troubleshooting lebih cepat.

## Kontrak Payload Dashboard Command

Topik: `dashboard/devices/{device_id}/command`

Contoh payload:

```json
{
  "device_id": "smart_socket",
  "command_id": "cmd-20260421-001",
  "command": "relay_on"
}
```

Worker akan mengubah payload tersebut menjadi envelope terenkripsi (`enc`, `kid`, `ctr`, `nonce`, `tag`, `cipher`, `command_id`) sebelum dipublish ke topic device.

## Kontrak Status Balik ke Dashboard

Topik: `dashboard/devices/{device_id}/status`

Contoh payload sukses:

```json
{
  "worker": "mqtt_worker",
  "device_id": "smart_socket",
  "status": "ok",
  "reason": "telemetry diterima, didekripsi, tervalidasi, dan tersimpan",
  "source_topic": "devices/smart_socket/telemetry",
  "ts": 1776761234567,
  "power_w": 118.7
}
```
