# Kontrak Topik MQTT

Dokumen ini menjelaskan topik MQTT standar agar firmware, backend, dan dashboard memakai struktur yang sama.

## Pola Umum

Semua topik berbasis:

`devices/{device_id}/...`

## Daftar Topik Utama

1. Command dari backend ke device
   - Topik: `devices/{device_id}/command`
   - Arah: Backend -> ESP32
   - QoS: 1
   - Retain: false

2. Telemetry monitoring listrik
   - Topik: `devices/{device_id}/telemetry`
   - Arah: ESP32 -> Backend
   - QoS: 1
   - Retain: false

3. Status relay terbaru
   - Topik: `devices/{device_id}/relay/status`
   - Arah: ESP32 -> Backend
   - QoS: 1
   - Retain: false

4. ACK hasil command
   - Topik: `devices/{device_id}/ack`
   - Arah: ESP32 -> Backend
   - QoS: 1
   - Retain: false

5. Status konektivitas online/offline
   - Topik: `devices/{device_id}/status`
   - Arah: Broker publish saat disconnect abnormal
   - QoS: 1
   - Retain: true

## Payload Ringkas per Topik

1. command
   - Payload terenkripsi (`enc`, `device_id`, `kid`, `ctr`, `nonce`, `tag`, `cipher`, `command_id`).
   - `command_id` wajib agar ACK dapat dipasangkan ke request command.

2. telemetry
   - Payload terenkripsi (disarankan) dengan data V, A, W, energi, dan timestamp.

3. relay/status
   - JSON status terpadu:
   - `{"device_id":"smart_socket","status_type":"relay","status":"ON"}`

4. ack
   - JSON sederhana:
   - `{"device_id":"smart_socket","command_id":"cmd-1","status":"ok","message":"command dieksekusi"}`

5. status
   - JSON status terpadu (dipakai untuk LWT dan publish online saat connect):
   - `{"device_id":"smart_socket","status_type":"connectivity","status":"OFFLINE"}` (LWT)
   - `{"device_id":"smart_socket","status_type":"connectivity","status":"ONLINE"}` (publish normal)

## Aturan Naming

1. `device_id` harus unik dan konsisten dengan profile firmware.
2. Hindari perubahan nama topik tanpa versi migrasi.
3. Jika butuh topik baru, tambahkan suffix jelas (mis. `/events`).
