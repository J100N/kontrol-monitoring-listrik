# Infra Stack (EMQX + InfluxDB)

Dokumen ini untuk menjalankan fondasi backend project:

1. Broker MQTT (EMQX)
2. Time-series DB (InfluxDB 2.x)
3. (Opsional) `mqtt_worker`

## 1) Persiapan

1. Salin env template:

```bash
cp .env.example .env
```

Dan untuk worker dalam compose:

```bash
cp mqtt_worker.env.example mqtt_worker.env
```

2. Isi nilai sensitif pada `.env`:

- `EMQX_DASHBOARD_PASSWORD`
- `INFLUXDB_ADMIN_PASSWORD`
- `INFLUXDB_ADMIN_TOKEN`

3. Isi `mqtt_worker.env` agar sinkron dengan stack:

- `MQTT_BROKER_URL=mqtt://emqx:1883`
- `INFLUX_URL=http://influxdb:8086`
- `INFLUX_TOKEN=<token dari .env infra>`
- `INFLUX_ORG=<org dari .env infra>`
- `INFLUX_BUCKET=<bucket dari .env infra>`
- key ASCON sinkron dengan firmware

## 2) Jalankan EMQX + InfluxDB

```bash
docker compose --env-file .env up -d emqx influxdb
```

Cek status:

```bash
docker compose ps
```

## 3) (Opsional) Jalankan mqtt_worker dalam stack yang sama

```bash
docker compose --env-file .env --profile app up -d mqtt_worker
```

> `mqtt_worker` membaca env dari `infra/digitalocean/mqtt_worker.env`.

## 4) Akses Service

1. EMQX Dashboard: `http://<host>:18083`
2. InfluxDB UI: `http://<host>:8086`

## 5) Checklist Integrasi End-to-End

1. Device publish telemetry ke `devices/{device_id}/telemetry`
2. Worker subscribe telemetry dan status dashboard muncul `channel=monitoring`
3. Dashboard publish command ke `dashboard/devices/{device_id}/command`
4. Worker forward command terenkripsi ke `devices/{device_id}/command`
5. Device kirim ACK ke `devices/{device_id}/ack` dan status dashboard channel ter-update
6. Data masuk ke measurement:

- `power_telemetry_encrypted`
- `power_telemetry`

## 6) Catatan Operasional

1. Influx bootstrap (`DOCKER_INFLUXDB_INIT_*`) hanya berjalan saat volume baru.
2. Jika ingin reset total, hapus volume terkait InfluxDB dan EMQX.
3. Untuk produksi, aktifkan TLS MQTT (port 8883) dan batasi akses dashboard EMQX via firewall/VPN.

## 7) Mode DigitalOcean (tanpa localhost)

Jika worker dijalankan langsung dari host lokal (bukan service compose), gunakan
konfigurasi di `backend/mqtt_worker/.env` dan pastikan endpoint menunjuk server DO:

1. `MQTT_BROKER_URL=mqtt://<IP_DO>:1883`
2. `INFLUX_URL=http://<IP_DO>:8086`
3. `INFLUX_TOKEN`, `INFLUX_ORG`, `INFLUX_BUCKET` sama dengan Influx di DO
4. `ASCON_KEYRING_JSON` sama dengan key firmware device

Setelah update env, jalankan:

```bash
cd backend/mqtt_worker
npm start
```

Lalu cek end-to-end:

```bash
npm run e2e:live
```

## 8) Hardening Deployment (Non-Interaktif)

1. Compose sekarang memiliki healthcheck untuk service `mqtt_worker`.
2. Source path worker dibuat configurable via `.env`:

```bash
MQTT_WORKER_SRC=./backend/mqtt_worker
```

3. Deploy backend DO non-interaktif (SSH key):

```bash
DO_HOST=<IP_DO> DO_KEY_PATH=~/.ssh/id_ed25519 ./scripts/deploy_backend.sh
```

4. Verifikasi final satu perintah (deploy + strict e2e + summary):

```bash
DO_HOST=<IP_DO> DO_KEY_PATH=~/.ssh/id_ed25519 ./scripts/final_verify_do.sh
```

Catatan: kedua script di atas menjalankan SSH dengan `BatchMode=yes`, jadi tidak ada prompt password berulang.
