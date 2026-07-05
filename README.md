# Sistem Kontrol & Monitoring Listrik

Sistem IoT end-to-end untuk pemantauan dan pengendalian konsumsi listrik rumah
tangga berbasis ESP32-S3, MQTT (EMQX), InfluxDB, REST API Express, WebSocket
gateway, dan dashboard React.

## Pembaruan Terkini Dashboard (Mei 2026)

Berikut fitur dan perbaikan yang baru ditambahkan pada sesi pengembangan ini:

| #   | Fitur                                                                                                                            | File utama                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | **Grafik telemetri real** — `EnergyChart` kini menerima data nyata dari API history semua device, diagregasi per label waktu     | `hooks/useDashboardHistory.ts`              |
| 2   | **Notifikasi browser fungsional** — alert otomatis untuk perangkat offline, insiden keamanan, command timeout, dan overcurrent   | `hooks/useNotifications.ts`, `AppShell.tsx` |
| 3   | **Perbandingan konsumsi** — `deltaPct` dihitung dari separuh pertama vs separuh kedua data history (proxy "periode lalu vs ini") | `hooks/useDashboardHistory.ts`              |
| 4   | **Settings "Umum" berisi konten** — menampilkan status WebSocket, jumlah device online/offline, tarif aktif, dan versi app       | `features/settings/UmumSection.tsx`         |
| 5   | **Detail biaya real-time** — `CostHighlight` menampilkan biaya per jam dan estimasi biaya hari ini berdasarkan daya live         | `features/dashboard/CostHighlight.tsx`      |

**Perbaikan lain:**

- Port REST API dipindah dari 8080 → **3001** (menghindari konflik Apache di Windows)
- `NotificationSection` memanggil `Notification.requestPermission()` saat klik Simpan
- Tile Energi di KPI menampilkan delta real (bukan hardcoded 0)

---

## Migrasi Kriptografi: ASCON-128 v1.2 → Ascon-AEAD128 (Mei 2026)

Sistem ini sebelumnya menggunakan **ASCON-128 v1.2** (Round 3 NIST LWC
finalist, 2023). Pada sesi ini algoritma di-**upgrade** ke standar resmi
**Ascon-AEAD128** sesuai **NIST SP 800-232** (terbit final 13 Agustus 2025).

### Mengapa upgrade

NIST telah meresmikan SP 800-232 sebagai standar federal AS untuk lightweight
cryptography. Memakai versi terbaru memberi:

- ✅ Kesesuaian dengan standar federal NIST terkini
- ✅ Format ciphertext byte-identik dengan referensi IAIK
- ✅ Performa lebih baik (rate 16 byte vs 8 byte → 2× throughput per blok)
- ✅ Hak klaim resmi sebagai implementasi "Ascon-AEAD128 standar NIST"

### Perubahan algoritmik

| Aspek             | ASCON-128 v1.2 (lama)  | Ascon-AEAD128 (SP 800-232)                      |
| ----------------- | ---------------------- | ----------------------------------------------- |
| Rate              | 8 byte (64 bit)        | **16 byte (128 bit)**                           |
| Ronde b           | 6                      | **8**                                           |
| Byte ordering     | Big-endian             | **Little-endian**                               |
| Padding byte      | 0x80                   | **0x01**                                        |
| Domain separation | XOR `0x01` ke x[4]     | **XOR `0x80<<56` ke x[4]**                      |
| IV                | `0x80400C0600000000`   | **`0x1000808C0001`** (terhitung dari parameter) |
| Finalize key XOR  | x[1] ^= K0; x[2] ^= K1 | **x[2] ^= K0; x[3] ^= K1**                      |

**Round function (S-box + linear diffusion) TIDAK berubah** — sama persis.

### File yang berubah

| File                                                   | Aksi                                     |
| ------------------------------------------------------ | ---------------------------------------- |
| `backend/mqtt_worker/src/handlers/asconAead128.js`     | **BARU** — implementasi JS Ascon-AEAD128 |
| `backend/mqtt_worker/src/handlers/asconDecrypt.js`     | **DIHAPUS** (digantikan asconAead128.js) |
| `firmware/core/components/ascon_crypto/ascon.c`        | **DIPERBARUI** — algoritma SP 800-232    |
| `firmware/core/components/ascon_crypto/ascon.h`        | **DIPERBARUI** — komentar header         |
| `backend/mqtt_worker/src/handlers/telemetryHandler.js` | Update import path                       |
| `backend/mqtt_worker/src/handlers/commandHandler.js`   | Update import path                       |
| `tests/ascon128aead/`                                  | **BARU** — pengujian KAT NIST SP 800-232 |
| `tests/ascon128_nist_kat/`                             | **DIHAPUS** (digantikan ascon128aead)    |

### Verifikasi terhadap NIST KAT resmi

```
$ cd tests/ascon128aead
$ node run_kat.js NIST_OFFICIAL.txt
Membaca 1089 test vector dari NIST_OFFICIAL.txt
────────────────────────────────────────────────────────────
Total: 1089   PASS: 1089   FAIL: 0
────────────────────────────────────────────────────────────
✓ Semua test vector LULUS — implementasi BIT-EXACT dengan referensi NIST SP 800-232.
```

### Implikasi deployment (PENTING)

⚠️ Ini **breaking change** sisi protokol — backend baru **tidak kompatibel**
dengan firmware lama (v1.2). Urutan rollout yang aman:

1. **Build firmware baru** dari `firmware/core/` dengan ESP-IDF (`idf.py build`)
2. **Flash semua ESP32** di lapangan (USB atau OTA)
3. **Setelah semua ESP32 sudah on-version baru**, baru deploy backend ke server
4. Selama proses rollout (langkah 2 belum selesai), pertahankan backend lama

Jika backend di-deploy sebelum firmware diperbarui, semua telemetry akan
gagal di-decrypt (tag mismatch) dan command yang dikirim akan ditolak device.

---

## Peta Repository

```
firmware/                     ESP-IDF (ESP32-S3)
  core/components/            wifi, mqtt, ascon, pzem, pir, relay, oled, telemetry, time_sync, device_state, auto_control
  devices/                    smart_socket (entrypoint device)
  shared_protocol/            mqtt_topics.md, payload_schema.json, encryption_rules.md
  provisioning/               script flash + register device

backend/
  mqtt_worker/                Subscribe MQTT, decrypt Ascon-AEAD128 (SP 800-232), anti-replay, validasi AJV, tulis Influx
    src/security/             replayGuard, commandCounter, pendingCommands
    src/device_registry/      registry persisten (devices.json)
    src/device_discovery/     auto-register device baru
    src/handlers/             telemetryHandler, commandHandler, deviceEventHandler, schemaValidator
    src/influx_writer/        batched writer (telemetry / encrypted / device_event)
    src/healthcheck.js        HTTP /healthz, /readyz
  api/                        REST API Express (devices, telemetry, history, control, mode, settings)
    src/{routes,controllers,services,repositories,middleware,config}/
  realtime_gateway/           Bridge MQTT dashboard/* -> WebSocket /ws
  common/                     constants, helpers, schemas yang dishare

frontend/dashboard/           Vite + React + TS
  src/{components,hooks,pages,services,store}/

database/
  device_registry/devices.json  Sumber kebenaran daftar device fisik
  influxdb/                     schema.md, init_bucket.sh

infra/digitalocean/           docker-compose multi-service + nginx + env templates
scripts/                      deploy_backend.sh, deploy_frontend.sh
tests/                        unit (node:test), integration (MQTT), e2e (HTTP+MQTT+WS)
docs/                         desain flow auto-discovery, dashboard dinamis, provisioning
```

## Alur Kerja Sistem (End-to-End)

### 1. Monitoring listrik (device -> cloud -> dashboard)

```
PZEM-004T (UART/Modbus) -> ESP32-S3
ESP32-S3:
  - baca V/A/W/Wh/Hz/PF/alarm
  - bangun JSON telemetry, encrypt Ascon-AEAD128 (kid + ctr unik)
  - publish ke devices/{device_id}/telemetry (QoS 1)
EMQX broker -> MQTT worker:
  - validasi envelope dengan JSON Schema (AJV)
  - device_discovery: auto-register device_id baru
  - replay guard: tolak ctr <= last_ctr per device
  - simpan ciphertext ke Influx measurement power_telemetry_encrypted
  - dekripsi Ascon-AEAD128, validasi telemetry plaintext
  - tulis ke power_telemetry, commit ctr, touch online=true
  - publish event "telemetry_ingested" ke dashboard/devices/{id}/status
Realtime gateway (WS /ws) -> browser:
  - broadcast event ke semua tab dashboard yang terbuka
React dashboard:
  - store Zustand di-update -> kartu device refresh tanpa reload
```

### 2. Kontrol manual (dashboard -> device)

```
User klik ON/OFF di DeviceCard -> POST /api/devices/{id}/control
REST API:
  - validasi body (AJV: command in [RELAY_ON, RELAY_OFF])
  - cek device_id ada di registry
  - publish JSON plaintext ke dashboard/devices/{id}/command
MQTT worker:
  - validasi command
  - encrypt Ascon-AEAD128 dengan counter persistent (commandCounter, kid aktif)
  - publish ciphertext ke devices/{id}/command
  - daftarkan command_id di pendingCommands (timeout 8s)
  - publish "command_forwarded" ke dashboard/*
ESP32-S3:
  - decrypt, eksekusi relay, publish status (relay/status) + ack
MQTT worker:
  - resolve command_id, hitung latency
  - tulis device_event measurement (event_type=command_ack, latency_ms=...)
  - publish "command_ack" ke dashboard/*
  - jika tidak ada ACK 8s: publish "command_timeout" + simpan ke device_event
```

### 3. Kontrol otomatis (di device)

```
ESP32-S3 (auto_control):
  - kalau PIR diam >= 10 menit DAN power_w < 10 W -> relay OFF
  - kalau PIR aktif dan relay OFF -> relay ON
  - publish status relay + ack (command_id "auto-...")
MQTT worker mengenali prefix "auto-" -> kategorikan ke channel auto_control,
arsipkan device_event, broadcast ke dashboard.
```

### 4. Auto-discovery & Add Device Wizard

```
Saat ESP32 baru hidup pertama kali, telemetry pertamanya:
  - device_id belum ada di registry
  - device_discovery.ingest -> registry.upsert (pending_provisioning=true, online=true)
Dashboard:
  - card baru muncul otomatis di Devices/Dashboard
  - wizard di /devices memungkinkan user mengisi label, ruangan, threshold daya, timeout PIR
  - setelah disimpan, pending_provisioning=false
```

### 5. Autentikasi Dashboard

```
Pengguna buka /login → isi username + password
LoginPage → authStore.login() → POST /api/auth/login
Backend:
  - bandingkan username dengan ADMIN_USERNAME di .env
  - bandingkan password dengan hash bcrypt dari ADMIN_PASSWORD
  - jika cocok → terbitkan JWT (berlaku JWT_EXPIRES_IN, default 8 jam)
Frontend:
  - simpan { token, user } ke localStorage (Zustand persist)
  - setiap request berikutnya: Axios request interceptor sisipkan
    "Authorization: Bearer <token>" secara otomatis
  - jika server kembalikan 401 → hapus token + redirect /login
```

**Cara mengganti username/password admin:**
Edit dua baris di file `.env` yang sesuai lalu restart backend.

| File                         | Lingkungan        |
| ---------------------------- | ----------------- |
| `backend/api/.env`           | Development lokal |
| `infra/digitalocean/api.env` | Server production |

```
ADMIN_USERNAME=admin        ← ganti username di sini
ADMIN_PASSWORD=voltguard2024 ← ganti password di sini
JWT_SECRET=<string-acak-min-32-karakter> ← wajib diganti sebelum deploy!
```

---

## Layanan & Port

| Service           | Port  | Catatan                            |
| ----------------- | ----- | ---------------------------------- |
| EMQX MQTT         | 1883  | broker MQTT                        |
| EMQX Dashboard    | 18083 | UI admin broker                    |
| InfluxDB          | 8086  | bucket telemetry                   |
| MQTT worker       | 9101  | hanya HTTP /healthz internal       |
| REST API          | 3001  | /api/devices, /api/devices/.../... |
| Realtime gateway  | 8090  | WebSocket /ws + /healthz           |
| Dashboard (Nginx) | 80    | SPA + reverse proxy /api dan /ws   |

> **Catatan lokal:** REST API berjalan di port **3001** (bukan 8080) untuk menghindari
> konflik dengan Apache HTTP Server yang berjalan sebagai Windows service di port 8080.
> Vite proxy (`vite.config.ts`) sudah dikonfigurasi ke `:3001`.

## Environment & Secret

- `infra/digitalocean/mqtt_worker.env.example` - template worker
- `infra/digitalocean/api.env.example` - template API
- `infra/digitalocean/realtime_gateway.env.example` - template realtime
- `frontend/dashboard/.env.example` - template Vite env (`VITE_API_BASE_URL`, `VITE_WS_URL`)

Salin masing-masing tanpa suffix `.example` lalu isi token Influx, kunci ASCON
keyring, dan kredensial broker. Jangan commit kredensial nyata.

## Cara Menjalankan Lokal (Tanpa Docker)

Prasyarat: Node.js 20, EMQX & InfluxDB running di host.

```bash
# 1. Worker
cd backend/mqtt_worker
cp ../../infra/digitalocean/mqtt_worker.env.example .env
npm install
npm start

# 2. API
cd ../api
cp .env.example .env
npm install
npm start

# 3. Realtime gateway
cd ../realtime_gateway
cp .env.example .env
npm install
npm start

# 4. Dashboard
cd ../../frontend/dashboard
cp .env.example .env
npm install
npm run dev
```

Dashboard tersedia di `http://localhost:5173`.

## Cara Deploy ke DigitalOcean

```bash
# Salin compose stack ke server lalu jalankan
DO_HOST=<ip>  DO_KEY_PATH=~/.ssh/id_ed25519 ./scripts/deploy_backend.sh

# Build dashboard (di host lokal) lalu redeploy nginx container
./scripts/deploy_frontend.sh
```

`docker-compose.yml` di `infra/digitalocean/` sudah mendefinisikan service:
`emqx`, `influxdb`, `mqtt_worker`, `api`, `realtime_gateway`, `dashboard`
(nginx). Konfigurasi reverse proxy `/api` dan WebSocket `/ws` ada di
`infra/digitalocean/nginx/dashboard.conf`.

## Skema InfluxDB

Lihat `database/influxdb/schema.md`. Tiga measurement utama:

- `power_telemetry` - data plaintext hasil dekripsi (V/A/W/Wh/Hz/PF/alarm).
- `power_telemetry_encrypted` - arsip ciphertext untuk audit.
- `device_event` - histori event (relay, ack, connectivity, command_timeout).

Bucket di-bootstrap otomatis oleh container InfluxDB; retention dapat
diinisialisasi via `database/influxdb/init_bucket.sh`.

## Keamanan & Anti-Abuse Worker

- Anti-replay: `replay_state.json` menyimpan `last_ctr` per device. Telemetry
  dengan `ctr` lebih kecil/sama langsung ditolak.
- Counter command persisten: `command_counter.json` mencegah nonce reuse saat
  worker restart.
- Pairing command/ack: setiap command yang dipublish disimpan dengan timer 8
  detik. ACK match -> latency tercatat. Timeout -> event `command_timeout`.
- Validasi ketat: semua payload (envelope, ack, status, telemetry plaintext,
  command dashboard) dicek via AJV memakai `firmware/shared_protocol/payload_schema.json`.
- Registry gate: command ditolak jika `device_id` tidak terdaftar.

## Arsitektur Frontend

```
frontend/dashboard/src/
├── pages/          Halaman utama (Dashboard, Devices, DeviceDetail, Security, Login, Settings)
├── features/       Komponen fitur per halaman
│   ├── dashboard/  EnergyChart, CostHighlight, SmartSocketCard, PerSocketAccumulation
│   └── settings/   UmumSection, TariffSection, MqttSection, AutomationSection,
│                   NotificationSection, ProfileSection
├── components/     Komponen UI generik (Button, Card, Badge, StatTile, ToggleSwitch, …)
├── hooks/          Custom hooks
│   ├── useDevices.ts           Fetch daftar device + subscribe WS patch
│   ├── useDashboardHistory.ts  Fetch history semua device → agregasi → deltaPct
│   └── useNotifications.ts     Browser Notification API + subscribe WS event
├── services/       Klien HTTP (api.ts / Axios) dan WebSocket (ws.ts singleton)
├── store/          State global Zustand
│   ├── authStore.ts    Login/logout + simpan JWT ke localStorage
│   └── deviceStore.ts  Daftar device + wsConnected flag
├── lib/            adapters.ts — konversi format API → format UI
└── types.ts        Definisi TypeScript semua tipe data
```

**Alur data frontend:**

```
Pertama mount      → useDevices/useDevice   → GET /api/*         → adaptDevice → deviceStore
Riwayat chart      → useDashboardHistory    → GET history per id → aggregateHistory → chartData
Realtime update    → wsService.subscribe    → WsMessage          → updateDevice (patch parsial)
Notifikasi browser → useNotifications       → wsService.subscribe → Notification API
Komponen render    → useDeviceStore         → baca state terkini → tampil di UI
Kirim perintah     → useCommand.send        → POST /api/devices/:id/control
```

---

## REST API Endpoints

Semua endpoint `/api/devices/*` memerlukan header `Authorization: Bearer <token>`.
Token diperoleh dari `POST /api/auth/login`.

| Method | Path                                         | Auth                          | Fungsi                    |
| ------ | -------------------------------------------- | ----------------------------- | ------------------------- |
| POST   | /api/auth/login                              | —                             | Login, dapat JWT          |
| GET    | /api/auth/me                                 | ✓                             | Cek token + info pengguna |
| GET    | /healthz                                     | —                             | Liveness API              |
| GET    | /api/devices                                 | List semua device + telemetry |
| POST   | /api/devices                                 | Tambah device baru            |
| GET    | /api/devices/{id}                            | Detail + energi total         |
| PATCH  | /api/devices/{id}                            | Update label/room/threshold   |
| DELETE | /api/devices/{id}                            | Hapus device                  |
| POST   | /api/devices/{id}/mode                       | Ubah manual/auto              |
| POST   | /api/devices/{id}/control                    | Kirim RELAY_ON / RELAY_OFF    |
| GET    | /api/devices/{id}/telemetry/latest           | Telemetry terakhir            |
| GET    | /api/devices/{id}/telemetry/history?range=1h | Histori (15m/1h/6h/24h/7d)    |
| GET    | /api/devices/{id}/events?range=24h&limit=100 | Histori event device          |

## Testing

```bash
cd tests
npm install
npm run test:unit          # node:test - replayGuard, schema, registry
npm run test:integration   # publish dummy command, baca dashboard status
npm run test:e2e           # API healthz + control + WS + MQTT roundtrip
```

Test integration & e2e akan SKIP dengan output ringkas jika service belum
hidup, sehingga aman dijalankan di environment minimal.

---

## Struktur Firmware ESP-IDF (Rapi & Reusable)

Struktur firmware sudah dirapikan agar setiap varian device punya entrypoint sendiri (`app_main.c`) dan build dipilih lewat `DEVICE_VARIANT`:

- `CMakeLists.txt`: root project ESP-IDF, termasuk pemilihan `DEVICE_VARIANT`.
- `firmware/core/components/*`: komponen reusable (wifi_manager, pzem004t, relay, pir, oled, ascon, dll).
- `firmware/devices/smart_socket/app_main.c`: entrypoint device.
- `firmware/devices/smart_socket/device_profile.h`: profile device.

## Alur Kerja Sistem Firmware

1. Saat build dimulai, project membaca `DEVICE_VARIANT` (default: `smart_socket`).
2. CMake memuat folder device yang sesuai: `firmware/devices/<DEVICE_VARIANT>` sebagai komponen aktif.
3. `app_main.c` milik device tersebut membaca `DEVICE_ID`, `WIFI_STA_SSID`, `WIFI_STA_PASSWORD`, `WIFI_MAX_RETRY` dari `device_profile.h`.
4. `wifi_manager` diinisialisasi, lalu melakukan koneksi WiFi STA dengan auto-reconnect.
5. Setelah status connected (sudah dapat IP), sistem siap lanjut ke MQTT, telemetry, dan kontrol aktuator.

## WiFi Manager (ESP-IDF)

Lokasi komponen:

- `firmware/core/components/wifi_manager`

Kemampuan utama:

- Konfigurasi SSID/password lewat struct.
- Auto reconnect dengan batas retry.
- Callback event koneksi untuk integrasi modul lain.
- Fungsi wait hingga connected dengan timeout.

API ringkas:

```c
esp_err_t wifi_manager_init(const wifi_manager_config_t *config,
                            wifi_manager_event_cb_t event_cb,
                            void *user_ctx);

esp_err_t wifi_manager_start(void);
esp_err_t wifi_manager_stop(void);
esp_err_t wifi_manager_connect(void);

bool wifi_manager_is_connected(void);
wifi_manager_state_t wifi_manager_get_state(void);
esp_err_t wifi_manager_wait_until_connected(uint32_t timeout_ms);
```

## Langkah Build Firmware (Device 1 / Device 2)

Jalankan dari root repository setelah environment ESP-IDF aktif.

### Opsi A: Build via Task VS Code (disarankan)

Task sudah disiapkan di `.vscode/tasks.json`:

1. Buka Command Palette (`Ctrl+Shift+P`)
2. Ketik `task`
3. Klik `Tasks: Run Task` (bukan `Tasks: Configure Task`)
4. Pilih task build:

- `Build Device 1 (smart_socket)`
- `Rebuild Device 1 Clean (smart_socket)` (fullclean + build)

Alternatif cepat:

1. Tekan `Ctrl+Shift+B`
2. Pilih task build yang ingin dijalankan

Task ini memakai folder build `build`.

Jika task belum muncul di daftar:

1. Jalankan `Developer: Reload Window`
2. Ulangi langkah `Tasks: Run Task`

### Opsi B: Build via Command Line

Build:

```bash
idf.py -B build -DDEVICE_VARIANT=smart_socket build
```

Contoh flash (opsional):

```bash
idf.py -B build -DDEVICE_VARIANT=smart_socket -p COMx flash monitor
```

Catatan:

- Gunakan port serial yang benar untuk perangkat (`COMx`).
- Sistem ini 1 device (smart_socket), jadi seluruh build memakai satu folder `build`.

## Kenapa Garis Merah Include Bisa Muncul

Jika header ESP-IDF (mis. `esp_wifi.h`) masih merah di editor, penyebabnya biasanya IntelliSense belum mengambil konfigurasi dari project ESP-IDF.

Urutan aman untuk menghilangkan masalah:

1. Buka root repository workspace ini.
2. Aktifkan ESP-IDF extension environment.
3. Jalankan `idf.py reconfigure` atau `idf.py build` sekali.
4. Pastikan `build/compile_commands.json` sudah terbentuk.
5. Reload VS Code window jika perlu.

Setelah compile database terbentuk dari project yang valid, garis merah include biasanya hilang.

## Catatan Integrasi Lanjutan

- Kredensial pada `device_profile.h` saat ini placeholder, bisa diganti provisioning/NVS di tahap berikut.
- Event callback dari `wifi_manager` cocok dipakai untuk trigger reconnect MQTT dan sinkronisasi telemetry.

## Device State + OLED (Integrasi Bertahap)

State runtime perangkat sekarang dipusatkan di komponen:

- `firmware/core/components/device_state/device_state.h`
- `firmware/core/components/device_state/device_state.c`

Field yang dilacak untuk monitoring lokal (OLED) dan sinkron alur kontrol:

- Relay ON/OFF -> status listrik beban
- Mode MANUAL/AUTO -> mode kerja aktif
- PIR MOTION/IDLE -> status gerakan penghuni
- Device ONLINE/OFFLINE -> status perangkat hidup
- Wi-Fi connected -> koneksi router
- MQTT connected -> koneksi broker
- Last power (W) -> daya terbaru PZEM
- Inactivity timer (detik) -> waktu sejak gerakan terakhir

Integrasi OLED saat ini memakai text status 8 baris melalui:

- `firmware/core/components/oled_ssd1306/oled_draw_text_lines(...)`

Di `app_main` alur update dilakukan step-by-step:

1. Update state konektivitas dari event Wi-Fi dan status MQTT.
2. Update state relay + mode ketika command manual diterima.
3. Update state PIR, power PZEM, dan inactivity timer saat loop telemetry berjalan.
4. Saat auto-control mengeksekusi relay ON/OFF, mode diset AUTO dan state dipublish ke backend.
5. Snapshot state dirender ke OLED setiap siklus telemetry.

Catatan praktik:

- Menampilkan status ini di OLED bagus untuk debugging lapangan karena teknisi bisa lihat health device tanpa buka dashboard.
- Untuk produksi, backend/dashboard tetap jadi sumber utama histori dan analitik.

## Integrasi Ascon-AEAD128 + Telemetry (Firmware)

Integrasi firmware sekarang sudah menyatukan tiga alur utama:

1. Monitoring listrik: data PZEM dibentuk ke payload telemetry lalu dienkripsi Ascon-AEAD128 (NIST SP 800-232) sebelum publish MQTT.
2. Kontrol manual: command dari broker bisa diterima dalam format terenkripsi (nonce/tag/cipher), didekripsi di ESP32, lalu relay dieksekusi.
3. Kontrol otomatis: keputusan auto ON/OFF tetap berjalan dari PIR + daya dan statusnya dipublish ke backend.

Komponen yang dipakai:

- `firmware/core/components/ascon_crypto/*` untuk fungsi AEAD Ascon-AEAD128 (SP 800-232).
- `firmware/core/components/telemetry/*` untuk builder payload telemetry terenkripsi dan parser command terenkripsi.

Catatan kompatibilitas migrasi:

- Firmware tetap menerima command plaintext lama sebagai fallback.
- Jika build payload telemetry terenkripsi gagal, firmware fallback publish plaintext agar device tetap operasional.

Catatan keamanan produksi:

- Key ASCON sementara didefinisikan di `device_profile.h` (`ASCON_KEY_BYTES`) untuk akselerasi pengujian.
- Pada deployment produksi, key wajib dipindahkan ke mekanisme secure provisioning atau storage aman (mis. NVS encrypted / secure element).

## Time Sync (NTP) vs Tanpa Time Sync

Komponen sinkronisasi waktu ada di:

- `firmware/core/components/time_sync/time_sync.h`
- `firmware/core/components/time_sync/time_sync.c`

Perbedaan perilaku sistem:

1. Jika memakai time sync (NTP aktif):

- Timestamp telemetry menggunakan epoch waktu nyata (akurasi lintas device lebih konsisten).
- Data dashboard, grafik, dan log event manual/otomatis lebih rapi secara urutan waktu.
- Perhitungan energi/biaya dalam rentang waktu lebih andal karena titik awal-akhir waktu valid.

2. Jika tanpa time sync:

- Timestamp bisa tidak valid saat boot awal (belum ada referensi waktu global).
- Urutan log antar device atau setelah reboot berpotensi melompat/tidak sinkron.
- Analisis histori (per jam/hari) di backend dapat meleset.

Catatan implementasi saat ini:

1. `app_main` mencoba init SNTP lalu menunggu sinkronisasi dengan timeout.
2. Jika sinkronisasi belum berhasil, firmware tetap jalan (fail-soft), tetapi kualitas timestamp menurun.
3. Timezone default diset ke `WIB-7` agar representasi waktu lokal sesuai kebutuhan pemantauan di Indonesia.

## PZEM-004T (ESP32-S3 UART)

Komponen driver PZEM tersedia di:

- `firmware/core/components/pzem004t/pzem.h`
- `firmware/core/components/pzem004t/pzem.c`

Wiring default yang dipakai komponen:

- PZEM `TX` -> ESP32-S3 `RX` (GPIO18)
- PZEM `RX` -> ESP32-S3 `TX` (GPIO17)
- PZEM `GND` -> ESP32-S3 `GND`
- PZEM `5V` -> ESP32-S3 `5V`

Contoh penggunaan singkat:

```c
#include "pzem.h"

void app_main(void)
{
        ESP_ERROR_CHECK(pzem_init(NULL)); // pakai default UART1 TX17 RX18 addr 0xF8

        pzem_data_t data = {0};
        if (pzem_read_data(&data) == ESP_OK) {
                // lanjut publish ke MQTT / simpan ke InfluxDB
        }
}
```

Data yang dibaca per paket:

- Tegangan (V)
- Arus (A)
- Daya aktif (W)
- Energi (Wh)
- Frekuensi (Hz)
- Power factor
- Alarm status

## Sumber Referensi Implementasi PZEM

- ESP-IDF UART API resmi (Espressif):
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/uart.html
- Referensi protokol PZEM-004T v3.0 (Modbus RTU) yang luas dipakai komunitas:
  https://github.com/mandulaj/PZEM-004T-v30

Catatan: implementasi di project ini ditulis ulang menyesuaikan arsitektur ESP-IDF komponen, bukan copy-paste mentah dari library eksternal.

## Ascon-AEAD128 Crypto (AEAD untuk Telemetry dan Command)

Komponen kriptografi Ascon-AEAD128 (NIST SP 800-232, final 13 Agustus 2025) tersedia di:

- `firmware/core/components/ascon_crypto/ascon.h`
- `firmware/core/components/ascon_crypto/ascon.c`

Fitur yang sudah disediakan:

- Encrypt telemetry sensor (`ascon_encrypt_telemetry`)
- Decrypt command dari server (`ascon_decrypt_command`)
- Nonce generation (`ascon_generate_nonce`)
- Tag validation konstan-waktu (`ascon_validate_tag_ct` + validasi internal decrypt)
- Replay protection berbasis counter nonce (`ascon_is_fresh_counter` + `ascon_update_rx_counter`)
- Key management (init, rotate key, active/previous key fallback)

Contoh penggunaan ringkas:

```c
#include "ascon.h"

static ascon_ctx_t s_ascon;

void crypto_init_example(void)
{
    const uint8_t key_128[ASCON_KEY_SIZE] = {
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    };

    ESP_ERROR_CHECK(ascon_init(&s_ascon, key_128, 1));
}

void encrypt_telemetry_example(const uint8_t *telemetry, size_t telemetry_len)
{
    uint8_t nonce[ASCON_NONCE_SIZE] = {0};
    uint8_t tag[ASCON_TAG_SIZE] = {0};
    uint8_t cipher[128] = {0};
    uint64_t counter = 0;
    uint32_t key_id = 0;

    const uint8_t aad[] = "topic:telemetry";

    ESP_ERROR_CHECK(ascon_encrypt_telemetry(
        &s_ascon,
        aad,
        sizeof(aad) - 1,
        telemetry,
        telemetry_len,
        nonce,
        cipher,
        tag,
        &key_id,
        &counter));
}

void decrypt_command_example(
    const uint8_t nonce[ASCON_NONCE_SIZE],
    const uint8_t *cipher,
    size_t cipher_len,
    const uint8_t tag[ASCON_TAG_SIZE])
{
    uint8_t plain[128] = {0};
    uint32_t used_key_id = 0;
    uint64_t counter = 0;

    const uint8_t aad[] = "topic:command";

    ESP_ERROR_CHECK(ascon_decrypt_command(
        &s_ascon,
        nonce,
        aad,
        sizeof(aad) - 1,
        cipher,
        cipher_len,
        tag,
        plain,
        &used_key_id,
        &counter));
}
```

Catatan implementasi penting:

- Nonce harus unik per key. Komponen ini memakai format `nonce = prefix_64bit || counter_64bit`.
- Counter TX/RX sebaiknya dipersist di NVS agar aman terhadap reboot (mencegah nonce reuse/replay).
- Gunakan AAD (misalnya topic MQTT, device_id, key_id, direction) agar konteks paket ikut diikat autentikasi.

## Sumber Referensi Implementasi Ascon-AEAD128

- NIST SP 800-232 (standar resmi Ascon-Based LWC):
  https://csrc.nist.gov/pubs/sp/800/232/final
- Situs resmi Ascon (spesifikasi, paper, referensi):
  https://ascon.iaik.tugraz.at/
- Repository referensi resmi Ascon (ascon-c):
  https://github.com/ascon/ascon-c

Catatan: implementasi pada project ini ditulis ulang dari spesifikasi resmi agar sesuai kebutuhan firmware ESP-IDF Anda.

## MQTT Client (ESP-IDF + EMQX)

Komponen MQTT tersedia di:

- `firmware/core/components/mqtt_client/mqtt_app.h`
- `firmware/core/components/mqtt_client/mqtt_client.c`

Kemampuan yang sudah diimplementasikan:

- Menunggu Wi-Fi tersambung sebelum konek broker MQTT
- Connect MQTT ke EMQX
- Auto reconnect saat putus koneksi
- Subscribe topic command otomatis setelah connect
- Publish telemetry sensor
- Publish status relay
- Publish ACK command
- Last Will and Testament (LWT)

Contoh alur pakai ringkas:

```c
mqtt_app_config_t cfg = {
    .broker_uri = "mqtt://167.71.195.81:1883",
    .username = "dev_socket_01",
    .password = "password-kuat",
    .client_id = "smart_socket",
    .device_id = "smart_socket",
    .topic_command = "devices/smart_socket/command",
    .topic_telemetry = "devices/smart_socket/telemetry",
    .topic_relay_status = "devices/smart_socket/relay/status",
    .topic_ack = "devices/smart_socket/ack",
    .lwt_topic = "devices/smart_socket/status",
    .lwt_payload = "offline",
    .lwt_qos = 1,
    .lwt_retain = true,
    .wifi_wait_timeout_ms = 15000,
    .default_qos = 1,
};

ESP_ERROR_CHECK(mqtt_app_init(&cfg, my_command_cb, NULL));
ESP_ERROR_CHECK(mqtt_app_start());
ESP_ERROR_CHECK(mqtt_app_publish_telemetry("{\"power_w\":120.5}", -1, false));
ESP_ERROR_CHECK(mqtt_app_publish_relay_status(true, -1, false));
ESP_ERROR_CHECK(mqtt_app_publish_ack("cmd-001", "ok", "relay-on", -1, false));
```

Catatan:

- Komponen MQTT tidak cukup hanya file C/H saja; tetap perlu `CMakeLists.txt` komponen agar ikut build.
- Integrasi runtime sudah diterapkan di `firmware/devices/smart_socket/app_main.c`.
- `app_main` sekarang menangani: start MQTT, command callback (`relay_on`, `relay_off`, `relay_toggle`, `ping`), publish telemetry PZEM, publish relay status, dan publish ACK.
- Konfigurasi broker/topic disimpan di `device_profile.h` masing-masing device.

Contoh konfigurasi `device_profile.h` yang perlu diisi sesuai akun broker:

```c
#define MQTT_BROKER_URI "mqtt://167.71.195.81:1883"
#define MQTT_USERNAME "dev_socket_01"
#define MQTT_PASSWORD "ganti_password_mqtt"
#define MQTT_CLIENT_ID DEVICE_ID

#define MQTT_TOPIC_COMMAND "devices/smart_socket/command"
#define MQTT_TOPIC_TELEMETRY "devices/smart_socket/telemetry"
#define MQTT_TOPIC_RELAY_STATUS "devices/smart_socket/relay/status"
#define MQTT_TOPIC_ACK "devices/smart_socket/ack"
#define MQTT_TOPIC_LWT "devices/smart_socket/status"
#define MQTT_LWT_PAYLOAD "offline"
```

## Sumber Referensi Implementasi MQTT

- ESP-IDF MQTT API resmi:
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/protocols/mqtt.html
- MQTT 3.1.1 (OASIS) untuk Last Will and Testament:
  https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/
- Panduan topik MQTT praktis dari EMQX:
  https://www.emqx.com/en/blog/the-easiest-guide-to-getting-started-with-mqtt

## Auto Control (PIR + PZEM + Relay)

Komponen kontrol otomatis tersedia di:

- `firmware/core/components/auto_control/auto_control.h`
- `firmware/core/components/auto_control/auto_control.c`

Logika inti yang diterapkan:

1. Sensor PIR memantau gerakan penghuni secara kontinu.
2. Bila ada gerakan, timer no-motion langsung reset ke 0.
3. Auto OFF hanya boleh terjadi jika:
   - benar-benar tidak ada gerakan kontinu selama 10 menit penuh, dan
   - daya PZEM di bawah 10 watt.
4. Bila relay sedang OFF lalu PIR mendeteksi gerakan, sistem auto ON.
5. Setiap aksi auto ON/OFF dicatat di log dan dikirim ke backend via MQTT:
   - publish status relay (`topic_relay_status`)
   - publish ACK (`topic_ack`) dengan reason aksi otomatis.

Parameter auto control di profile device:

```c
#define AUTO_CONTROL_NO_MOTION_OFF_SEC 600U
#define AUTO_CONTROL_POWER_THRESHOLD_W 10.0f
```

Integrasi runtime sudah diterapkan di:

- `firmware/devices/smart_socket/app_main.c`

## Sumber Referensi Implementasi Auto Control

- ESP-IDF High Resolution Timer (`esp_timer`) untuk timer no-motion:
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/system/esp_timer.html
- ESP-IDF GPIO API (dasar baca PIR dan kendali relay):
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/gpio.html

## Relay SLA-5VDC-SL-C (Aktif-High)

Komponen driver relay tersedia di:

- `firmware/core/components/relay_sla5vdcslc/relay.h`
- `firmware/core/components/relay_sla5vdcslc/relay.c`

Konfigurasi default komponen:

- Input kontrol relay pada GPIO5 ESP32-S3
- Logika aktif-high: level HIGH = relay ON, level LOW = relay OFF

Contoh penggunaan singkat:

```c
#include "relay.h"

void app_main(void)
{
    ESP_ERROR_CHECK(relay_init(NULL)); // default GPIO5 aktif-high, kondisi awal OFF

    ESP_ERROR_CHECK(relay_on());
    ESP_ERROR_CHECK(relay_off());
}
```

## Sumber Referensi Implementasi Relay

- ESP-IDF GPIO API resmi (Espressif):
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/gpio.html

Catatan: perilaku aktif-high ditetapkan di firmware melalui parameter `active_level` agar konsisten untuk modul relay yang digunakan.

## HC-SR501 PIR (Aktif-High)

Komponen driver PIR tersedia di:

- `firmware/core/components/pir_hcsr501/pir.h`
- `firmware/core/components/pir_hcsr501/pir.c`

Konfigurasi default komponen:

- Output sinyal HC-SR501 dibaca pada GPIO4 ESP32-S3
- Logika aktif-high: level HIGH = gerakan terdeteksi

Contoh penggunaan singkat:

```c
#include "pir.h"

void app_main(void)
{
    ESP_ERROR_CHECK(pir_init(NULL)); // default GPIO4 aktif-high

    if (pir_is_motion_detected()) {
        // ada gerakan
    }
}
```

## Sumber Referensi Implementasi PIR

- ESP-IDF GPIO API resmi (Espressif):
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/gpio.html
- Referensi karakteristik output HC-SR501 (DOUT high saat motion):
  https://components101.com/sensors/hc-sr501-pir-sensor

Catatan: pada firmware ESP32-S3, pin `GPIO4` dikonfigurasi sebagai INPUT karena yang dikeluarkan sensor adalah sinyal digital `OUT` menuju ESP.

## OLED SSD1306 (I2C)

Komponen driver OLED tersedia di:

- `firmware/core/components/oled_ssd1306/oled.h`
- `firmware/core/components/oled_ssd1306/oled.c`

Konfigurasi pin default:

- OLED SDA -> GPIO9
- OLED SCL -> GPIO10

Konfigurasi default panel:

- Resolusi 128x64
- Alamat I2C 0x3C
- Clock I2C 400 kHz

Contoh penggunaan singkat:

```c
#include "oled.h"

void app_main(void)
{
    ESP_ERROR_CHECK(oled_init(NULL));
    ESP_ERROR_CHECK(oled_clear());
}
```

API utama:

- `oled_init()`
- `oled_deinit()`
- `oled_clear()`
- `oled_draw_buffer()`
- `oled_set_display_on()`

## Sumber Referensi Implementasi OLED

- Dokumentasi resmi ESP-IDF LCD API (Espressif):
  https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32s3/api-reference/peripherals/lcd/index.html
- Contoh resmi Espressif `i2c_oled` (SSD1306 + esp_lcd):
  https://github.com/espressif/esp-idf/tree/v5.3.1/examples/peripherals/lcd/i2c_oled
- SSD1306 datasheet:
  https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf
