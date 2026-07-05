# InfluxDB — Penyimpanan Data Time-Series VoltGuard

InfluxDB menyimpan semua data telemetri sensor (daya, tegangan, arus) dan
log event perangkat dari sistem VoltGuard.

## Peran dalam Sistem

```
mqtt_worker  ──→  InfluxDB  ──→  API (baca)  ──→  Dashboard
```

mqtt_worker menulis data ke InfluxDB setelah mendekripsi payload ASCON dari ESP32.
API membaca data dari InfluxDB untuk endpoint telemetry/history dan events.

## Measurement yang Digunakan

### `power_telemetry`
Data sensor yang sudah didekripsi — sumber utama untuk chart dashboard.

| Field / Tag   | Tipe    | Keterangan                        |
|---------------|---------|-----------------------------------|
| `device_id`   | tag     | ID unik perangkat                 |
| `room`        | tag     | Lokasi fisik device               |
| `voltage_v`   | field   | Tegangan (Volt)                   |
| `current_a`   | field   | Arus (Ampere)                     |
| `power_w`     | field   | Daya aktif (Watt)                 |
| `energy_kwh`  | field   | Energi kumulatif (kWh)            |
| `pf`          | field   | Faktor daya (0–1)                 |
| `relay_on`    | field   | Status relay (true/false)         |
| `rssi_db`     | field   | Sinyal WiFi ESP32 (dBm)           |

### `power_telemetry_encrypted`
Salinan payload terenkripsi asli — untuk keperluan audit/forensik.

| Field / Tag   | Tipe    | Keterangan                        |
|---------------|---------|-----------------------------------|
| `device_id`   | tag     | ID unik perangkat                 |
| `raw_cipher`  | field   | Ciphertext ASCON (hex)            |
| `nonce`       | field   | Nonce enkripsi (hex)              |
| `tag`         | field   | Authentication tag ASCON (hex)    |
| `kid`         | field   | ID kunci enkripsi                 |
| `ctr`         | field   | Counter anti-replay               |

### `device_event`
Log peristiwa penting per perangkat.

| Field / Tag   | Tipe    | Keterangan                             |
|---------------|---------|----------------------------------------|
| `device_id`   | tag     | ID unik perangkat                      |
| `event_type`  | tag     | Jenis event (relay_change, mode, dst.) |
| `detail`      | field   | Detail event dalam format JSON string  |

## Konfigurasi Deployment

InfluxDB dijalankan via Docker Compose di `infra/digitalocean/docker-compose.yml`:

```yaml
influxdb:
  image: influxdb:2.7
  ports:
    - "8086:8086"
  volumes:
    - influxdb_data:/var/lib/influxdb2
```

### Variabel Lingkungan (dari `infra/digitalocean/influxdb.env`)

| Variabel                        | Keterangan                     |
|---------------------------------|--------------------------------|
| `DOCKER_INFLUXDB_INIT_MODE`     | `setup` saat pertama kali      |
| `DOCKER_INFLUXDB_INIT_ORG`      | Nama organisasi                |
| `DOCKER_INFLUXDB_INIT_BUCKET`   | Nama bucket data               |
| `DOCKER_INFLUXDB_INIT_PASSWORD` | Password admin                 |
| `DOCKER_INFLUXDB_INIT_ADMIN_TOKEN` | Token API untuk akses        |

## Akses UI InfluxDB

- URL: `http://localhost:8086` (dev) atau `http://server-ip:8086`
- Login: sesuai variabel `INIT_USERNAME` dan `INIT_PASSWORD`

## Retention Policy (Rekomendasi)

Tambahkan Task di UI InfluxDB untuk menghapus data lama:

```flux
// Hapus data telemetri lebih dari 90 hari
import "influxdata/influxdb/tasks"

option task = {name: "retention-90d", every: 1d}

from(bucket: "voltguard")
  |> range(start: -inf, stop: -90d)
  |> filter(fn: (r) => r._measurement == "power_telemetry")
  |> to(bucket: "voltguard_archive")
```

## Artefak yang Bisa Ditambahkan di Folder Ini

- `retention_task.flux` — task Flux untuk retention policy
- `dashboard_queries.flux` — kumpulan query Flux siap pakai
- `backup.sh` — script backup dan restore data InfluxDB
