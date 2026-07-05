# InfluxDB Schema

Bucket utama: `telemetry` (org `ta_org`).

Semua timestamp memakai presisi millisecond. Tag wajib di setiap point: `device_id`.
Default tag yang ditambahkan otomatis oleh worker: `source = "mqtt_worker"`.

## 1. Measurement `power_telemetry`

Telemetry plaintext hasil dekripsi worker.

> Catatan alur: device membaca PZEM tiap 1 detik dan mengirim 1 pesan MQTT berisi
> 10 sampel (batch) setiap 10 detik. Worker memecah batch tersebut menjadi
> **10 point terpisah** di sini — 1 point per sampel, masing-masing dengan
> timestamp pengukurannya sendiri.

| Field           | Tipe   | Satuan |
|-----------------|--------|--------|
| voltage_v       | float  | Volt   |
| current_a       | float  | Ampere |
| power_w         | float  | Watt   |
| energy_wh       | float  | Wh     |
| frequency_hz    | float  | Hz     |
| power_factor    | float  | -      |
| alarm           | int    | bitfield |

Tag: `device_id`.

## 2. Measurement `power_telemetry_encrypted`

Arsip ciphertext sebelum dekripsi sesuai requirement TA (data terenkripsi disimpan
di DB sebelum diolah).

| Field   | Tipe   | Catatan                  |
|---------|--------|--------------------------|
| enc     | int    | selalu 1                 |
| kid     | int    | key id ASCON             |
| ctr     | string | counter (BigInt-safe)    |
| nonce   | string | hex 32 char              |
| tag     | string | hex 32 char              |
| cipher  | string | hex variable             |

Tag: `device_id`, `source_topic`.

## 3. Measurement `device_event`

Histori event device: ack command, perubahan relay, connectivity, command timeout.
Sumber input untuk halaman detail device dan audit.

| Field        | Tipe   | Catatan                            |
|--------------|--------|------------------------------------|
| status       | string | ok / error / ON / OFF / ONLINE / OFFLINE |
| message      | string | bebas, max ~160 char              |
| command_id   | string | jika event berkaitan dengan command |
| latency_ms   | int    | jeda command->ack, hanya untuk ack |

Tag: `device_id`, `event_type`, `channel`.

`event_type` standar:
- `command_ack`, `command_timeout`
- `relay_status`
- `connectivity`

## Retention

Direkomendasikan 30 hari untuk `power_telemetry` dan `device_event`,
90 hari untuk `power_telemetry_encrypted` (audit). Atur via UI Influx atau
`influx bucket update --retention <duration>`.
