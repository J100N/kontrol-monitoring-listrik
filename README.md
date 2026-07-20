# Sistem Kontrol & Monitoring Listrik Berbasis IoT

Soket pintar berbasis **ESP32-S3** yang mengukur parameter listrik (PZEM-004T), mengendalikan aliran listrik (relay), dan mengirim telemetri terenkripsi **Ascon-AEAD128 (NIST SP 800-232)** ke server melalui **MQTT**. Data ditampilkan pada dashboard web, dengan kontrol manual jarak jauh maupun kontrol otomatis berbasis sensor gerak.

---

# 1. Daftar Referensi Implementasi

Sumber resmi yang menjadi acuan penulisan tiap komponen program.

## 1.1 Ascon-AEAD128 (Kriptografi)

- NIST SP 800-232 — standar resmi Ascon-Based Lightweight Cryptography:
  https://csrc.nist.gov/pubs/sp/800/232/final
- Situs resmi Ascon (spesifikasi, paper, implementasi referensi):
  https://ascon.iaik.tugraz.at/
- Repository referensi resmi Ascon (`ascon-c`):
  https://github.com/ascon/ascon-c

> Implementasi pada proyek ini **ditulis ulang dari spesifikasi resmi**, disesuaikan dengan arsitektur komponen ESP-IDF.

## 1.2 MQTT

- ESP-IDF MQTT API resmi:
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/protocols/mqtt.html
- MQTT 3.1.1 (OASIS) — acuan _Last Will and Testament_:
  https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/
- Panduan topik MQTT praktis (EMQX):
  https://www.emqx.com/en/blog/the-easiest-guide-to-getting-started-with-mqtt

## 1.3 PZEM-004T (Sensor Parameter Listrik)

- ESP-IDF UART API resmi (Espressif):
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/uart.html
- Referensi protokol PZEM-004T v3.0 (Modbus RTU):
  https://github.com/mandulaj/PZEM-004T-v30

> Ditulis ulang menyesuaikan arsitektur komponen ESP-IDF, bukan salinan mentah pustaka eksternal.

## 1.4 Auto Control (PIR + PZEM + Relay)

- ESP-IDF High Resolution Timer (`esp_timer`) untuk timer _no-motion_:
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/system/esp_timer.html
- ESP-IDF GPIO API:
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/gpio.html

## 1.5 Relay SLA-5VDC-SL-C (Aktif-High)

- ESP-IDF GPIO API resmi (Espressif):
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/gpio.html

> Perilaku aktif-high ditetapkan lewat parameter `active_level` agar konsisten dengan modul relay yang dipakai.

## 1.6 HC-SR501 PIR (Aktif-High)

- ESP-IDF GPIO API resmi (Espressif):
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/gpio.html
- Karakteristik output HC-SR501 (DOUT high saat _motion_):
  https://components101.com/sensors/hc-sr501-pir-sensor

> `GPIO4` dikonfigurasi sebagai INPUT karena sensor mengeluarkan sinyal digital `OUT` menuju ESP32.

## 1.7 OLED SSD1306 (I2C)

- Dokumentasi resmi ESP-IDF LCD API (Espressif):
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/lcd/index.html
- Contoh resmi Espressif `i2c_oled` (SSD1306 + `esp_lcd`):
  https://github.com/espressif/esp-idf/tree/v5.3.1/examples/peripherals/lcd/i2c_oled
- Datasheet SSD1306:
  https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf

---

# 2. Peta Repository (Referensi Kode Program)

```
firmware/                       ESP-IDF v5.3.1 (ESP32-S3)
  core/
    CMakeLists.txt              ROOT PROYEK ESP-IDF (project(kontrol_monitoring_listrik_fw))
    sdkconfig.defaults          CONFIG_IDF_TARGET="esp32s3"
    components/
      ascon_crypto/             Ascon-AEAD128 (enkripsi/dekripsi + tag otentikasi)
      pzem004t/                 UART1 Modbus RTU -> tegangan, arus, daya, energi
      relay_sla5vdcslc/         Kendali relay (aktif-high)
      pir_hcsr501/              Sensor gerak
      oled_ssd1306/             Tampilan status I2C
      auto_control/             Logika ON/OFF otomatis (PIR + ambang daya)
      mqtt_client/              Koneksi broker, publish/subscribe, LWT
      wifi_manager/             Koneksi & reconnect WiFi
      telemetry/                Susun & parse envelope terenkripsi
      time_sync/                Sinkronisasi waktu SNTP
      device_state/             State terpusat + format 8 baris OLED
  devices/smart_socket/
    app_main.c                  ENTRYPOINT: loop utama, handler perintah, NVS
    device_profile.h            Identitas device, kredensial WiFi/MQTT, definisi topik
    CMakeLists.txt              Registrasi komponen device
  shared_protocol/              mqtt_topics.md, payload_schema.json, encryption_rules.md

backend/
  mqtt_worker/                  Subscribe MQTT -> dekripsi -> anti-replay -> tulis Influx
    src/handlers/
      telemetryHandler.js       Alur telemetri + anti-replay + audit keamanan
      commandHandler.js         Enkripsi perintah dashboard -> device
      deviceEventHandler.js     ACK, status relay, konektivitas, audit SEC
      asconAead128.js           Enkripsi/dekripsi sisi server
      schemaValidator.js        Validasi struktur envelope (anti-injeksi)
    src/security/
      replayGuard.js            Anti-replay telemetri (counter per device)
      commandCounter.js         Counter perintah (monotonik, ber-seed waktu)
    src/device_registry/        Registry persisten (devices.json)
    src/influx_writer/          Penulis batch (plaintext / ciphertext / event)
  api/                          REST API Express
    src/services/deviceService.js     Status online (cek kesegaran last_seen)
    src/services/commandService.js    Kirim perintah kontrol
    src/repositories/influxRepo.js    Query Flux (riwayat grafik, agregasi 2-tahap)
    src/controllers/, routes/, middleware/
  realtime_gateway/             Bridge MQTT dashboard/* -> WebSocket /ws
  common/schemas/api_schemas.js Batas validasi resmi (threshold 0-5000 W, PIR 5-7200 dtk)

frontend/dashboard/             Vite + React + TypeScript
  src/hooks/
    useDevices.ts               Daftar device + patch WebSocket + refresh 10 dtk
    useDevice.ts                Detail satu device
    useNotifications.ts         Notifikasi offline & target bulanan
    useTelemetryHistory.ts      Riwayat grafik
  src/lib/adapters.ts           Konversi snake_case -> camelCase + label event
  src/pages/DeviceDetailPage.tsx  Halaman utama (grafik, kontrol, konfigurasi, log)
  src/components/layout/        AppShell, TopNav, NotificationToasts
  src/store/                    deviceStore, settingsStore, authStore (Zustand)

database/
  device_registry/devices.json  Sumber kebenaran daftar device fisik
  influxdb/                     schema.md, init_bucket.sh

infra/digitalocean/             docker-compose + nginx + template env
tests/
  ascon128aead/                 Pengujian KAT resmi NIST SP 800-232
  simulasi_serangan/            Simulator uji keamanan (baseline tanpa enkripsi)
docs/                           Dokumen desain & pengujian
```

---

# 3. Spesifikasi Perangkat Keras

| Komponen            | Antarmuka          | Pin / Alamat                             |
| ------------------- | ------------------ | ---------------------------------------- |
| PZEM-004T           | UART1 (Modbus RTU) | TX `GPIO17`, RX `GPIO18`, slave `0xF8`   |
| Relay SLA-5VDC-SL-C | GPIO (aktif-high)  | `GPIO5`                                  |
| HC-SR501 PIR        | GPIO (input)       | `GPIO4`                                  |
| OLED SSD1306        | I2C                | SDA `GPIO9`, SCL `GPIO10`, alamat `0x3C` |

**Topologi kelistrikan (penting untuk memahami perilaku sistem):**

```
Sumber PLN ──→ [Relay] ──→ [PZEM-004T] ──→ Soket / Beban
                  │              │
              (saklar)      (alat ukur)

Catu daya ESP32 diambil di HULU relay → rangkaian kontrol SELALU menyala,
tidak peduli relay ON atau OFF.
```

---

# 4. Alur Kerja Sistem (Langkah demi Langkah)

## 4.1 Urutan Boot Firmware

**Tampilan status muncul lebih dulu, pengukuran listrik menyusul:**

1. Inisialisasi **NVS** (flash) — agar counter anti-replay dapat dibaca
2. Inisialisasi **Ascon** + pulihkan counter TX telemetri dari NVS
3. Pulihkan **counter anti-replay perintah** dari NVS
4. Inisialisasi **device_state** + pulihkan mode kerja terakhir
5. Inisialisasi **OLED** → **tampilkan status awal** (nilai masih default: `WIFI:OFF MQTT:OFF`)
6. Inisialisasi **PZEM** → **pembacaan listrik pertama** → perbarui OLED
7. Inisialisasi **relay** → dipulihkan ke keadaan terakhir dari NVS (bukan selalu ON)
8. Pulihkan **energi kumulatif** dari NVS
9. Inisialisasi **PIR** + **auto_control**
10. Buat **`connectivity_task`** → **di sinilah WiFi & MQTT baru mulai tersambung**
11. Masuk **loop utama** (1 Hz)

> Pada langkah 5 status koneksi memang sudah **ditampilkan**, tetapi nilainya belum bermakna (`OFF`) karena WiFi belum diinisialisasi sama sekali. Nilainya baru valid setelah langkah 10.

## 4.2 Loop Utama (1 Hz)

Setiap satu detik, dengan **periode tetap**:

1. Baca sensor PIR
2. Jika relay **ON** → baca PZEM; jika relay **OFF** → lewati (PZEM tidak bertenaga), daya dianggap 0
3. Susun sampel → **enkripsi Ascon-AEAD128** → publish MQTT
4. Evaluasi **auto_control** (diterapkan hanya bila mode AUTO)
5. **Perbarui tampilan OLED**
6. Tidur sampai periode 1 detik berikutnya

## 4.3 Monitoring: Device → Server → Dashboard

```
ESP32 ukur → enkripsi Ascon → publish devices/smart_socket/telemetry (ciphertext)
   ↓
mqtt_worker:
   1. Validasi struktur envelope        → gagal: tolak + catat  (anti-injeksi)
   2. Cek device terdaftar (registry)   → gagal: tolak
   3. Cek counter anti-replay           → gagal: tolak diam-diam (dedup operasional)
   4. SIMPAN CIPHERTEXT ke InfluxDB     (arsip forensik)
   5. DEKRIPSI Ascon-AEAD128            → gagal: tolak + catat  (anti-tampering)
   6. SIMPAN PLAINTEXT ke InfluxDB
   7. Publish status ke dashboard/*
   ↓
realtime_gateway → WebSocket /ws → dashboard menampilkan data
```

**Urutan ringkas:** simpan ciphertext → dekripsi → simpan plaintext → tampilkan plaintext.

> Dekripsi dilakukan atas envelope yang **masih berada di memori** saat pesan tiba — bukan dibaca ulang dari database. Penyimpanan ciphertext bersifat arsip agar tetap ada jejak bila dekripsi gagal.

## 4.4 Kontrol Manual: Dashboard → Device

```
Dashboard tekan ON/OFF
   ↓
api (Express) → publish JSON POLOS ke topik internal dashboard/*
   ↓
mqtt_worker → ENKRIPSI Ascon DI SINI → publish devices/smart_socket/command
   ↓
ESP32:
   1. Parse format envelope     → gagal: ACK "format command tidak valid"
   2. Dekripsi Ascon            → gagal: ACK "decrypt command gagal"
   3. Cek counter anti-replay   → gagal: ACK "replay command ditolak"
   4. Eksekusi relay + paksa mode MANUAL + simpan ke NVS
   5. Publish status relay (plaintext) + ACK
```

> **Enkripsi perintah terjadi di `mqtt_worker`, bukan di `api`.** Layanan `api` hanya mengirim JSON polos ke topik internal yang tidak pernah keluar dari server.

## 4.5 Kontrol Otomatis (Sepenuhnya Lokal di Device)

```
PIR mendeteksi gerakan?
   ├─ YA    → relay ON
   └─ TIDAK → sudah melewati ambang waktu PIR DAN daya < ambang standby?
                ├─ YA    → relay OFF
                └─ TIDAK → biarkan
```

Berjalan **di dalam ESP32 tanpa melewati jaringan sama sekali** — tidak ada envelope, MQTT, maupun counter. Karena itu jalur ini **tidak memerlukan anti-replay**: tidak ada pesan jaringan yang dapat direkam lalu dikirim ulang.

---

# 5. Cara Menjalankan Sistem

## 5.1 Firmware (ESP32-S3)

Root proyek ESP-IDF berada di **`firmware/core`** (bukan `firmware/devices/smart_socket`, yang hanya berupa komponen).

```bash
# PowerShell / CMD — ESP-IDF TIDAK mendukung Git Bash (MSys/Mingw)
cd firmware\core
. C:\Users\<user>\esp\v5.3.1\esp-idf\export.ps1

idf.py build
idf.py -p COM7 flash monitor
```

Kredensial WiFi & broker diatur di `firmware/devices/smart_socket/device_profile.h`.

## 5.2 Backend (Server)

Backend berjalan sebagai kumpulan container Docker.

```bash
# Salin perubahan kode (source di-mount ke container)
scp -i ~/.ssh/<key> backend/<path>/<file>.js root@<server>:/opt/iot-listrik/backend/<path>/

# Node TIDAK memuat ulang kode secara otomatis — WAJIB restart
docker restart mqtt_worker      # atau: api
docker ps --filter name=api --format "{{.Status}}"    # tunggu sampai (healthy)
```

## 5.3 Frontend (Dashboard)

```bash
cd frontend/dashboard
npm run build                   # hasil di dist/

scp -i ~/.ssh/<key> -r dist/* root@<server>:/opt/iot-listrik/frontend/dashboard/dist/
```

Nginx menyajikan berkas statis langsung dari `dist/` — **tidak perlu restart container**. Nama berkas bundel mengandung _hash_, jadi lakukan **hard-refresh (Ctrl+Shift+R)** setelah deploy.

## 5.4 Layanan & Port

| Layanan           | Port     | Protokol                  |
| ----------------- | -------- | ------------------------- |
| dashboard (nginx) | 80 → 443 | HTTP redirect → **HTTPS** |
| api               | 8080     | HTTP (internal)           |
| realtime_gateway  | 8090     | HTTP/WebSocket (internal) |
| influxdb          | 8086     | HTTP (internal)           |
| emqx (MQTT)       | 1883     | **MQTT polos, tanpa TLS** |
| emqx dashboard    | 18083    | HTTP (internal)           |

---

# 6. Detail Sistem

## 6.1 Topik MQTT

| Topik                               | Isi                          | Terenkripsi            |
| ----------------------------------- | ---------------------------- | ---------------------- |
| `devices/smart_socket/telemetry`    | Parameter listrik            | **Ya** (Ascon-AEAD128) |
| `devices/smart_socket/command`      | Perintah kendali             | **Ya** (Ascon-AEAD128) |
| `devices/smart_socket/relay/status` | Status relay ON/OFF          | Tidak                  |
| `devices/smart_socket/ack`          | Konfirmasi eksekusi perintah | Tidak                  |
| `devices/smart_socket/status`       | Konektivitas (LWT broker)    | Tidak                  |

Status relay dikirim pada **topik terpisah** dari telemetri dan **tidak dienkripsi** — termasuk ketika dipicu oleh mode otomatis.

## 6.2 Spesifikasi Kriptografi

Menggunakan **Ascon-AEAD128** sesuai **NIST SP 800-232** (bukan ASCON-128 v1.2 lama):

| Parameter     | Nilai             |
| ------------- | ----------------- |
| Rate          | 16 byte (128 bit) |
| Ronde b       | 8                 |
| Byte ordering | Little-endian     |
| Padding byte  | `0x01`            |
| Panjang kunci | 128 bit           |

**Verifikasi terhadap KAT resmi NIST:**

```
$ cd tests/ascon128aead
$ node run_kat.js NIST_OFFICIAL.txt
Total: 1089   PASS: 1089   FAIL: 0
✓ Implementasi BIT-EXACT dengan referensi NIST SP 800-232.
```

## 6.3 Letak Kunci Ascon

|                | Firmware (ESP32)                         | Backend (server)                          |
| -------------- | ---------------------------------------- | ----------------------------------------- |
| Penyimpanan    | _Hardcoded_, ikut terkompilasi ke binari | _Environment variable_ (berkas `.env`)    |
| Lokasi         | `device_profile.h` (`ASCON_KEY_BYTES`)   | `ASCON_KEYRING_JSON` + `ASCON_ACTIVE_KID` |
| Jumlah kunci   | Satu kunci tetap                         | **Keyring** — banyak _key-id_, satu aktif |
| Cara mengganti | Wajib _reflash_ fisik                    | Sunting `.env` + restart proses           |

> Berkas `.env` tidak diikutkan ke repository (`.gitignore`).

## 6.4 Pertahanan MITM

| Serangan      | Mekanisme                                          | Letak                                                           |
| ------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| **Sniffing**  | Enkripsi Ascon-AEAD128                             | Payload telemetri & perintah                                    |
| **Injection** | Validasi struktur envelope                         | `schemaValidator.js` (server), parser format (firmware)         |
| **Tampering** | Tag otentikasi AEAD — melekat pada proses dekripsi | Dekripsi di server (telemetri) & firmware (perintah)            |
| **Replay**    | Perbandingan counter                               | `replayGuard` (telemetri, server) & counter perintah (firmware) |

**Poin kunci:** tag AEAD hanya membuktikan **keaslian & keutuhan**, bukan **kesegaran**. Envelope lama yang direkam penyerang tetap ber-tag sah sehingga lolos dekripsi — hanya perbandingan counter yang menolaknya.

Dampak kedua jalur berbeda jauh:

- Replay **telemetri** → paling banter data ganda. Ditolak, tetapi diperlakukan sebagai **dedup operasional** dan **tidak** dicatat sebagai serangan, karena secara teknis tak terbedakan dari duplikat QoS 1 (perilaku MQTT normal saat koneksi labil).
- Replay **perintah** → benar-benar dapat menyalakan/mematikan relay → **dicatat ke Log Keamanan**.

Label pada Log Keamanan memetakan 1:1 dengan skenario uji:

| Serangan  | Label                               |
| --------- | ----------------------------------- |
| Injeksi   | Perintah tidak valid ditolak        |
| Tampering | Perintah diubah ditolak             |
| Replay    | Perintah lama dikirim ulang ditolak |

## 6.5 HTTP, HTTPS, dan MQTT

```
Browser ──HTTPS/443──→ [nginx + TLS Let's Encrypt] ──HTTP──→ api:8080
                                                    ──HTTP──→ realtime_gateway:8090 (/ws)
Browser ──HTTP/80───→ 301 redirect ke HTTPS

ESP32 ──MQTT/1883 (polos, TANPA TLS)──→ EMQX
```

- **HTTPS hanya berada di pintu depan (nginx).** Seluruh lalu lintas di dalam server berupa HTTP polos — aman karena tidak pernah keluar dari mesin.
- Karena halaman diakses melalui HTTPS, WebSocket `/ws` otomatis berjalan sebagai **wss://**.
- **MQTT tidak memakai TLS** (port 1883, bukan 8883). Jalur ESP32↔broker dilindungi **pada level payload oleh Ascon-AEAD128**, bukan pada level transport.

> Inilah sebabnya _sniffing_ dengan Wireshark tetap dapat menangkap paket MQTT, tetapi isinya berupa _ciphertext_.

## 6.6 Pengukuran PZEM

**Satuan energi adalah Wh (watt-hour), bukan kWh.** Register 32-bit PZEM dibaca **tanpa penskalaan** (`energy_wh = (float)energy_raw`), berbeda dengan field lain yang diskalakan: tegangan `/10`, arus `/1000`, daya `/10`, frekuensi `/10`, faktor daya `/100`. Resolusi 1 Wh. Konversi ke kWh dilakukan di dashboard (`/1000`).

**Mengapa PZEM tidak dapat mengukur saat relay OFF?**

PZEM dipasang di **sisi beban (hilir relay)**. Ketika relay memutus:

1. PZEM ikut kehilangan catu daya → tidak dapat merespons perintah UART (timeout — kondisi **wajar**, bukan kerusakan sensor)
2. Memang tidak ada arus yang mengalir untuk diukur

Karena itu firmware **sengaja tidak membaca PZEM saat relay OFF** dan langsung menganggap daya = 0. Akumulator energi tersimpan pada EEPROM internal PZEM sehingga **tidak hilang** — nilainya dibekukan, lalu dilanjutkan saat relay menyala kembali.

**Mengukur dengan watt meter eksternal:**

| Titik pemasangan                    | Saat relay OFF                                                              |
| ----------------------------------- | --------------------------------------------------------------------------- |
| **Sisi output** (alat yang dicolok) | Membaca **0** — aliran diputus relay di hulu                                |
| **Sisi input** (dinding)            | **Terbaca** — konsumsi _standby_ rangkaian kontrol (ESP32, WiFi, OLED, PIR) |

Untuk mengukur konsumsi standby perangkat, pasang di **sisi input**. Untuk memvalidasi akurasi PZEM, bandingkan keduanya pada beban yang sama **saat relay ON**.

## 6.7 Perilaku Saat Perangkat Offline

Perangkat **tetap berfungsi** — "offline" hanya berarti tidak terjangkau dari jarak jauh:

| Aspek                          | Status saat WiFi putus                                          |
| ------------------------------ | --------------------------------------------------------------- |
| Keadaan relay                  | **Dipertahankan** — tidak ada kode yang mematikannya saat putus |
| Mode OTOMATIS                  | **Berjalan penuh** — PIR + ambang daya diproses lokal di ESP32  |
| Keadaan relay setelah _reboot_ | **Dipulihkan dari NVS**                                         |
| Kontrol manual dari dashboard  | Hilang                                                          |
| Ubah konfigurasi               | Hilang                                                          |
| Monitoring _real-time_         | Hilang                                                          |

Ini merupakan sifat **graceful degradation**: sistem kehilangan lapisan kendali-jauh dan monitoring, tetapi mempertahankan operasi otonom lokal beserta _state_-nya.

> **Keterbatasan:** tidak tersedia tombol fisik. Bila perangkat sedang dalam mode **MANUAL** lalu offline permanen, relay terkunci pada keadaan terakhir. Pada mode **AUTO** hal ini tidak menjadi masalah karena PIR yang mengendalikan.

## 6.8 Tampilan OLED (8 Baris)

```
DEV:ONLINE
WIFI:OK MQTT:OK
RELAY:ON
MODE:AUTOMATIC
PIR:IDLE
PWR:134.1W          ← daya real-time, diperbarui tiap detik
INACT:0s
CTRL:MAN/AUTO READY
```

Diperbarui melalui dua jalur: **loop utama** (tiap 1 detik) dan **callback event WiFi** (seketika saat status koneksi berubah).

---

# 7. Skema Penyimpanan InfluxDB

| Measurement                 | Isi                                                               |
| --------------------------- | ----------------------------------------------------------------- |
| `power_telemetry`           | Plaintext hasil dekripsi — sumber data dashboard & grafik         |
| `power_telemetry_encrypted` | Arsip ciphertext (forensik)                                       |
| `device_event`              | Log kejadian: ACK, status relay, konektivitas, **audit keamanan** |

**Grafik riwayat menggunakan agregasi 2-tahap** (`influxRepo.js`):

1. `aggregateWindow(1m, max)` — pra-agregasi halus yang dapat di-_pushdown_ ke storage (cepat), sekaligus mengisolasi _glitch_ UART ke jendela 1 menitnya sendiri
2. `SANITY_FILTER` — membuang jendela berisi nilai mustahil secara fisik
3. `aggregateWindow(windowEvery, max)` — agregasi ke jendela tampilan (24J = 15m, 7H = 1h, 30H = 6h)

Pendekatan ini menjaga **nilai puncak konsisten lintas rentang waktu** dan waktu kueri di bawah 1 detik.

---

# 8. Riwayat Perbaikan Terkini

## Firmware

| Perbaikan                             | Keterangan                                                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Laju telemetri 1 Hz**               | `vTaskDelay` → `xTaskDelayUntil` (periode tetap). Sebelumnya periode 1,17 dtk (0,855 sampel/dtk) karena durasi kerja loop ikut menambah jeda                                                    |
| **Reset acuan saat tenggat terlewat** | Mencegah _burst_ mengejar ketertinggalan (terukur: 13 sampel berjarak 97 ms setelah jeda 47 dtk)                                                                                                |
| **Anti-replay perintah**              | Counter perintah masuk dibandingkan lalu disimpan ke NVS. Sebelumnya counter hanya dicatat ke log dan **tidak pernah dibandingkan** — perintah hasil rekaman dapat benar-benar menyalakan relay |
| **Energi dipulihkan dari NVS**        | Disimpan pada transisi relay ON→OFF (hemat umur flash). Sebelumnya _reboot_ dengan relay OFF membuat perangkat melaporkan energi 0                                                              |
| **MQTT saat WiFi telat**              | `mqtt_app_start` tidak lagi gagal permanen; klien tetap dijalankan dan _auto-reconnect_ menyambung begitu WiFi tersedia                                                                         |

## Backend

| Perbaikan            | Keterangan                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Kueri grafik**     | Agregasi 2-tahap — dari 17 detik (timeout → grafik kosong) menjadi ~0,1 detik                                                              |
| **Replay telemetri** | Dikembalikan menjadi _dedup_ senyap; tidak lagi membanjiri Log Keamanan dengan alarm palsu dari duplikat QoS 1                             |
| **Audit keamanan**   | Gate registry dijalankan **sebelum** penulisan audit — mencegah `device_id` sembarang dari penyerang meledakkan kardinalitas seri InfluxDB |
| **Status online**    | `withFreshOnline` diterapkan pada `patchDevice` & `setMode` agar badge tidak kembali ONLINE untuk perangkat yang sudah mati                |

## Frontend

| Perbaikan               | Keterangan                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Notifikasi offline**  | `useDevices()` dipasang di `AppShell` — sebelumnya tidak pernah di-_mount_ sehingga store selalu kosong dan notifikasi tak pernah muncul        |
| **Peredam alarm palsu** | Alarm offline ditunda 15 detik dan dibatalkan bila ada tanda kehidupan; toast otomatis dihapus saat perangkat kembali online                    |
| **Target bulanan**      | Memakai konsumsi **bulan berjalan** (baseline per bulan), bukan akumulator seumur hidup; sampel ber-energi 0 dilewati agar baseline tidak rusak |
| **Batas masukan**       | Threshold & PIR dibatasi sesuai skema API (0–5000 W, 5–7200 dtk); slider tidak lagi diam-diam meruntuhkan nilai yang diketik                    |

---

# 9. Catatan Operasional

- **ESP-IDF tidak mendukung Git Bash** (MSys/Mingw). Gunakan PowerShell atau CMD.
- **Node tidak memuat ulang kode secara otomatis** — setelah menyalin berkas backend, container **wajib** di-restart.
- **Nginx menyajikan `dist/` secara langsung** — deploy frontend tidak memerlukan restart container, tetapi perlu _hard-refresh_ di peramban.
- Berkas _state_ berikut **tidak boleh ditimpa** saat deploy: `database/device_registry/devices.json`, `backend/mqtt_worker/data/replay_state.json`, `command_counter.json`, serta seluruh berkas `.env`.
- Ukuran binari firmware saat ini **97% dari partisi aplikasi**. Penambahan fitur besar memerlukan perbesaran partisi.
- Kredensial (kunci Ascon, sandi broker, token InfluxDB) **tidak dicantumkan** dalam dokumen ini dan tidak boleh masuk ke repository.
