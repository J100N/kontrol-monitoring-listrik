# EMQX — Broker MQTT VoltGuard

EMQX adalah broker MQTT yang menjadi pusat komunikasi antara firmware ESP32,
mqtt_worker, dan realtime_gateway di sistem VoltGuard.

## Peran dalam Sistem

```
ESP32  ──→  EMQX  ──→  mqtt_worker  ──→  InfluxDB
                   ──→  realtime_gateway ──→  WebSocket klien
Dashboard ──→  EMQX  ──→  mqtt_worker  ──→  ESP32
```

## Topic yang Digunakan

| Topic Pattern                        | Arah          | Fungsi                                      |
|--------------------------------------|---------------|---------------------------------------------|
| `devices/{id}/telemetry`             | ESP32 → Broker | Data sensor terenkripsi ASCON               |
| `devices/{id}/ack`                   | ESP32 → Broker | Konfirmasi perintah diterima firmware        |
| `devices/{id}/relay/status`          | ESP32 → Broker | Status relay real-time setelah perubahan     |
| `devices/{id}/status`                | ESP32 → Broker | Konektivitas (online/offline via LWT)        |
| `devices/{id}/command`               | Broker → ESP32 | Perintah relay terenkripsi dari worker       |
| `dashboard/devices/{id}/command`     | Dashboard → Broker | Perintah dari dashboard ke worker       |
| `dashboard/devices/{id}/status`      | Broker → Dashboard | Status update dari worker ke dashboard  |

## Konfigurasi Deployment

EMQX dijalankan via Docker Compose di `infra/digitalocean/docker-compose.yml`:

```yaml
emqx:
  image: emqx:5
  ports:
    - "1883:1883"   # MQTT (plaintext — untuk dev/lokal)
    - "8883:8883"   # MQTT over TLS (produksi)
    - "18083:18083" # Dashboard web EMQX
```

### Variabel Lingkungan Penting

| Variabel                   | Nilai Default   | Keterangan                        |
|----------------------------|-----------------|-----------------------------------|
| `EMQX_MQTT__MAX_PACKET_SIZE` | `1MB`         | Batas ukuran paket MQTT           |
| `EMQX_LOG__LEVEL`          | `warning`       | Level log broker                  |

## Akses Dashboard EMQX

- URL: `http://localhost:18083` (dev) atau `http://server-ip:18083` (produksi)
- Login default: `admin` / `public` (ganti segera setelah deploy)

## Hardening Produksi (Rekomendasi)

1. **Aktifkan TLS** — gunakan port 8883, pasang sertifikat dari Let's Encrypt
2. **ACL per client** — batasi topic yang bisa diterbitkan/dilanggani per client ID
3. **Autentikasi** — gunakan username/password atau mTLS untuk setiap koneksi
4. **Firewall** — port 1883 hanya boleh diakses dari jaringan internal; 18083 hanya dari IP tertentu

## Artefak yang Bisa Ditambahkan di Folder Ini

- `acl.conf` — aturan otorisasi topic per client
- `tls/` — sertifikat TLS broker
- `emqx.conf` — konfigurasi tambahan EMQX
