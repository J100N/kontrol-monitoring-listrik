# Struktur Database Sistem (VoltGuard)

Dokumen ini menjelaskan **struktur penyimpanan data**, **contoh isi tabel**, dan
**cara membukanya**. Sistem ini memakai **3 lapis penyimpanan** sesuai jenis data,
bukan satu database relasional tunggal:

| Lapis | Teknologi | Untuk apa | Lokasi |
|---|---|---|---|
| 1 | **InfluxDB** (time-series) | telemetri, arsip ciphertext, event | server `167.71.195.81:8086` |
| 2 | **File JSON** | registry device, state counter | folder repo & worker |
| 3 | **NVS flash** | counter & konfig di perangkat | internal ESP32 |

> Catatan: **tidak ada tabel User**. Login admin tunggal memakai kredensial dari
> `.env` (di-hash bcrypt saat startup), tanpa disimpan di database.

---

## LAPIS 1 — InfluxDB

InfluxDB menyimpan data dalam **bucket** (≈ database) yang berisi **measurement**
(≈ tabel). Setiap baris data disebut **point** (≈ row), terdiri dari:
- **tag** = kolom ber-index (string, untuk filter), mis. `device_id`
- **field** = kolom nilai (angka/string), mis. `power_w`
- **timestamp** = waktu point (presisi millisecond)

- **Bucket:** `telemetry`
- **Organization:** `ta_org`
- **URL:** `http://167.71.195.81:8086`

### Tabel 1.1 — `power_telemetry` (telemetri hasil dekripsi)

| Kolom | Jenis | Tipe | Satuan |
|---|---|---|---|
| device_id | tag | string | — |
| source | tag | string | — (otomatis = `mqtt_worker`) |
| voltage_v | field | float | Volt |
| current_a | field | float | Ampere |
| power_w | field | float | Watt |
| energy_wh | field | float | Wh |
| frequency_hz | field | float | Hz |
| power_factor | field | float | — |
| alarm | field | int | bitfield |

**Contoh isi (format tabel):**

| _time | device_id | voltage_v | current_a | power_w | energy_wh | frequency_hz | power_factor | alarm |
|---|---|---|---|---|---|---|---|---|
| 2026-06-10T08:00:00.000Z | smart_socket | 218.9 | 0.047 | 4.66 | 421 | 50.0 | 0.45 | 0 |
| 2026-06-10T08:00:01.000Z | smart_socket | 217.8 | 0.051 | 4.70 | 421 | 50.0 | 0.46 | 0 |
| 2026-06-10T08:00:02.000Z | smart_socket | 219.1 | 0.049 | 4.68 | 421 | 49.9 | 0.45 | 0 |

**Diisi dari:** ESP32 baca PZEM-004T tiap 1 detik → kirim batch 10 sampel
(terenkripsi) tiap 10 detik → worker dekripsi → simpan **10 point** (1 per sampel).

### Tabel 1.2 — `power_telemetry_encrypted` (arsip ciphertext)

| Kolom | Jenis | Tipe | Catatan |
|---|---|---|---|
| device_id | tag | string | — |
| source_topic | tag | string | topik MQTT asal |
| enc | field | int | selalu 1 |
| kid | field | int | key id ASCON |
| ctr | field | string | counter (BigInt-safe) |
| nonce | field | string | hex 32 char |
| tag | field | string | hex 32 char |
| cipher | field | string | hex variabel |

**Contoh isi:**

| _time | device_id | enc | kid | ctr | nonce | tag | cipher |
|---|---|---|---|---|---|---|---|
| 2026-06-10T08:00:10.000Z | smart_socket | 1 | 1 | 10482 | a1b2c3…d6 | 9f8e7d…a0 | 3c5a9f…e2 |

**Diisi dari:** envelope mentah dari topik `devices/+/telemetry`, disimpan
**sebelum** dekripsi (requirement TA: arsip data terenkripsi).

### Tabel 1.3 — `device_event` (histori event device)

| Kolom | Jenis | Tipe | Catatan |
|---|---|---|---|
| device_id | tag | string | — |
| event_type | tag | string | `command_ack`/`command_timeout`/`relay_status`/`connectivity` |
| channel | tag | string | kanal event |
| status | field | string | ok/error/ON/OFF/ONLINE/OFFLINE |
| message | field | string | bebas |
| command_id | field | string | bila terkait command |
| latency_ms | field | int | jeda command→ack |

**Contoh isi:**

| _time | device_id | event_type | status | message | command_id | latency_ms |
|---|---|---|---|---|---|---|
| 2026-06-10T08:01:00Z | smart_socket | command_ack | ok | konfigurasi diperbarui | cmd-7f3a | 320 |
| 2026-06-10T08:01:05Z | smart_socket | relay_status | ON | — | — | — |
| 2026-06-10T08:05:00Z | smart_socket | connectivity | ONLINE | — | — | — |

**Diisi dari:** topik `devices/+/ack`, `devices/+/relay/status`, `devices/+/status`.

---

## LAPIS 2 — File JSON (state di server)

### Tabel 2.1 — Device Registry — `database/device_registry/devices.json`

Sumber kebenaran daftar device fisik (dibagi worker & API).

**Isi nyata saat ini:**
```json
{
  "schema_version": 1,
  "devices": {
    "smart_socket": {
      "device_id": "smart_socket",
      "label": "Soket Pintar",
      "room": "",
      "mode": "manual",
      "power_threshold_w": 10,
      "pir_timeout_sec": 600,
      "created_at": 1714694400000,
      "updated_at": 1777858096468,
      "last_seen_at": null,
      "online": false
    }
  }
}
```

**Diisi dari:** auto-discovery saat device publish + update konfig dari dashboard
(mode, threshold, PIR) via API. Field `online`/`last_seen_at`/`relay_on`
di-update worker dari pesan status device.

### Tabel 2.2 — Replay Guard — `backend/mqtt_worker/data/replay_state.json`

Menyimpan `ctr` telemetri terakhir per device (anti-replay).
```json
{ "smart_socket": 10482 }
```
**Diisi dari:** counter telemetri tiap paket valid (flush tiap 5 commit).

### Tabel 2.3 — Command Counter — `backend/mqtt_worker/data/command_counter.json`

Menyimpan counter perintah terakhir per device.
```json
{ "smart_socket": 1777858096468000 }
```
**Diisi dari:** generator counter berbasis waktu saat worker mengenkripsi perintah.

---

## LAPIS 3 — NVS flash di ESP32

| Namespace | Key | Isi | Diisi dari |
|---|---|---|---|
| `ascon` | `tx_ctr` | batas atas counter anti-replay | counter TX (reserve +256 tiap mendekati batas) |
| `autocfg` | `pir` | timeout PIR (detik) | perintah `config_update` dari dashboard |
| `autocfg` | `thr` | threshold daya (centi-watt) | perintah `config_update` dari dashboard |

---

## CARA MEMBUKA

### A. InfluxDB — via UI Web (paling mudah)

1. Buka browser ke **http://167.71.195.81:8086**
2. Login (user/password InfluxDB server).
3. Menu **Data Explorer** → pilih bucket `telemetry` → pilih measurement
   (`power_telemetry` / `power_telemetry_encrypted` / `device_event`) → **Submit**.
4. Untuk query manual, pakai bahasa **Flux**:
   ```flux
   from(bucket: "telemetry")
     |> range(start: -1h)
     |> filter(fn: (r) => r._measurement == "power_telemetry")
     |> filter(fn: (r) => r.device_id == "smart_socket")
   ```

### B. InfluxDB — via CLI

```bash
influx query 'from(bucket:"telemetry") |> range(start:-1h) |> filter(fn:(r)=> r._measurement=="power_telemetry")' \
  --host http://167.71.195.81:8086 \
  --org ta_org \
  --token 081391411846
```

### C. InfluxDB — via REST API (curl)

```bash
curl -s http://167.71.195.81:8086/api/v2/query?org=ta_org \
  -H "Authorization: Token 081391411846" \
  -H "Accept: application/csv" \
  -H "Content-Type: application/vnd.flux" \
  -d 'from(bucket:"telemetry") |> range(start:-1h) |> filter(fn:(r)=> r._measurement=="power_telemetry")'
```

### D. File JSON (registry & state)

Cukup buka dengan editor teks / VS Code:
- `database/device_registry/devices.json`
- `backend/mqtt_worker/data/replay_state.json`
- `backend/mqtt_worker/data/command_counter.json`

> File `replay_state.json` dan `command_counter.json` baru muncul setelah worker
> berjalan dan memproses paket pertama.

### E. NVS ESP32 (lanjutan)

Lewat serial monitor saat firmware berjalan (counter dicetak ke log), atau dump
partisi NVS dengan `esptool.py` / `nvs_partition_gen.py` dari ESP-IDF.

---

## Parameter koneksi (ringkas)

| Parameter | Nilai | Sumber |
|---|---|---|
| Influx URL | http://167.71.195.81:8086 | `.env` `INFLUX_URL` |
| Influx Org | ta_org | `.env` `INFLUX_ORG` |
| Influx Bucket | telemetry | `.env` `INFLUX_BUCKET` |
| Influx Token | (lihat `.env`) | `.env` `INFLUX_TOKEN` |
| MQTT Broker | mqtt://167.71.195.81:1883 | `.env` `MQTT_BROKER_URL` |

> **Keamanan:** token InfluxDB, password MQTT, dan `JWT_SECRET` ada di file `.env`.
> Jangan publikasikan nilai aslinya (mis. saat lampiran laporan, sensor/redact dulu).
</content>
