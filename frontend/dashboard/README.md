# VoltGuard - Dashboard Frontend

Frontend web untuk sistem **VoltGuard** (Kontrol & Monitoring Listrik IoT
berbasis ESP32-S3 + ASCON-128). Menampilkan ringkasan konsumsi listrik,
manajemen smart socket, pengaturan tarif/MQTT/otomasi, dan audit keamanan.

> Dibangun dengan React 18 + TypeScript + Vite. Tidak memakai library UI eksternal
> (Tailwind/MUI/Antd) supaya bundle ringan dan setiap pixel bisa dikontrol penuh
> via design tokens.

---

## Daftar Isi

1. [Tampilan Halaman](#tampilan-halaman)
2. [Tech Stack](#tech-stack)
3. [Struktur Folder](#struktur-folder)
4. [Alur Kerja Sistem](#alur-kerja-sistem)
5. [Design System](#design-system)
6. [Cara Menjalankan](#cara-menjalankan)
7. [Integrasi Backend (Roadmap)](#integrasi-backend-roadmap)
8. [Konvensi Kode](#konvensi-kode)

---

## Tampilan Halaman

| Halaman      | Path         | Fungsi |
|--------------|--------------|--------|
| **Login**    | `/login`     | Masuk dashboard. Branding VoltGuard di kiri, form login di kanan. |
| **Dashboard**| `/dashboard` | KPI realtime, grafik konsumsi, biaya minggu ini, akumulasi per ruangan, kartu setiap smart socket. |
| **Devices**  | `/devices`   | Daftar device, statistik, form tambah device baru. |
| **Security** | `/security`  | Status enkripsi ASCON-128, trafik per-device, audit log. |
| **Settings** | `/settings`  | Konfigurasi tarif PLN, broker MQTT, parameter otomasi (PIR, threshold standby, dll). |

---

## Tech Stack

| Layer            | Pilihan                                              |
|------------------|------------------------------------------------------|
| Framework        | React 18.3                                           |
| Bahasa           | TypeScript 5.6                                       |
| Build tool       | Vite 5.4                                             |
| Routing          | React Router 6                                       |
| State global     | Zustand 4.5 (auth)                                   |
| Chart            | Recharts 2.13 (chart utama) + SVG inline (sparkline) |
| HTTP client      | Axios (siap dipakai untuk integrasi backend)         |
| Styling          | Plain CSS dengan design tokens (CSS variables)       |
| Font             | Inter (Google Fonts, weight 400-800)                 |

---

## Struktur Folder

```
frontend/dashboard/
├── README.md                     ← Dokumen ini
├── index.html                    ← HTML root + preload font
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.tsx                  ← Entry point Vite (mount React + import CSS global)
    ├── App.tsx                   ← Router tree + ProtectedRoute/GuestRoute
    ├── types.ts                  ← Semua tipe TypeScript shared
    │
    ├── styles/                   ← Design system layer
    │   ├── tokens.css            ← Variabel design (warna, spacing, font, shadow, radius)
    │   ├── globals.css           ← Reset CSS + base elemen + scrollbar
    │   └── primitives.css        ← Style untuk UI primitives reusable
    │
    ├── data/
    │   └── mockData.ts           ← Data demo (statistik, device, audit log, dll)
    │
    ├── store/
    │   └── authStore.ts          ← Zustand state autentikasi (persist localStorage)
    │
    ├── components/
    │   ├── icons.tsx             ← Inline SVG icons (Home, Bolt, Shield, dll)
    │   ├── ui/                   ← Komponen primitif reusable
    │   │   ├── Card.tsx
    │   │   ├── Button.tsx
    │   │   ├── TextInput.tsx
    │   │   ├── Select.tsx
    │   │   ├── Badge.tsx
    │   │   ├── StatTile.tsx
    │   │   ├── ToggleSwitch.tsx
    │   │   ├── SegmentedControl.tsx
    │   │   └── ProgressBar.tsx
    │   └── layout/               ← Komponen struktural (header, shell)
    │       ├── AppShell.tsx
    │       ├── TopNav.tsx
    │       ├── Logo.tsx
    │       └── layout.css
    │
    ├── features/                 ← Domain-specific components per halaman
    │   ├── dashboard/
    │   │   ├── EnergyChart.tsx       ← Recharts area+line dengan tab metric
    │   │   ├── CostHighlight.tsx     ← Kartu biaya (gradient navy)
    │   │   ├── PerSocketAccumulation.tsx
    │   │   └── SmartSocketCard.tsx
    │   ├── devices/
    │   │   ├── DeviceTable.tsx
    │   │   └── AddDeviceForm.tsx
    │   ├── settings/
    │   │   ├── SettingsSidebar.tsx
    │   │   ├── TariffSection.tsx
    │   │   ├── MqttSection.tsx
    │   │   └── AutomationSection.tsx
    │   └── security/
    │       ├── EncryptionPanel.tsx
    │       ├── DeviceTraffic.tsx
    │       └── AuditLog.tsx
    │
    └── pages/                    ← Page-level components + CSS-nya
        ├── LoginPage.tsx
        ├── login.css
        ├── DashboardPage.tsx
        ├── dashboard.css
        ├── DevicesPage.tsx
        ├── devices.css
        ├── SettingsPage.tsx
        ├── settings.css
        ├── SecurityPage.tsx
        └── security.css
```

### Filosofi pembagian folder

- **`styles/`** — *Design tokens & dasar.* Semua nilai estetika bermula dari sini.
- **`components/ui/`** — *Primitif tanpa domain.* Bisa dipakai ulang di halaman manapun (Card, Button, dll).
- **`components/layout/`** — *Struktural.* Wrapper halaman (AppShell, TopNav).
- **`features/<domain>/`** — *Komponen yang punya konteks bisnis.* `SmartSocketCard` tahu tentang model `SmartDevice`, jadi tinggal di `features/dashboard/`.
- **`pages/`** — *Komposisi level halaman.* Hanya merangkai komponen dari folder lain, sedikit logic, plus CSS spesifik halaman.

---

## Alur Kerja Sistem

### 1. Boot & Routing

```
index.html
   ↓ mount #root
src/main.tsx
   ↓ import CSS global (tokens → globals → primitives → layout)
   ↓ render <BrowserRouter><App/></BrowserRouter>
src/App.tsx
   ↓ definisikan Routes
   ↓ setiap protected route dibungkus <ProtectedRoute>
       └─ cek useAuthStore.isAuthenticated
           ├─ true  → render <AppShell>{page}</AppShell>
           └─ false → <Navigate to="/login" />
```

### 2. Autentikasi (Demo)

`store/authStore.ts` adalah **Zustand store** dengan middleware `persist`
sehingga state login bertahan setelah refresh browser (disimpan di
`localStorage` dengan key `voltguard-auth`).

**Saat ini login menerima username/password apapun** (asal tidak kosong)
karena fokus task adalah desain frontend. Untuk produksi, ganti aksi `login`
supaya hit endpoint REST backend dan simpan JWT.

```ts
// store/authStore.ts (real backend)
login: async (username, password) => {
  const { data } = await axios.post("/api/auth/login", { username, password });
  set({ user: data.user, isAuthenticated: true });
  localStorage.setItem("voltguard-token", data.token);
}
```

### 3. Render Page Authenticated

Setelah login, user diarahkan ke `/dashboard`. Layout `AppShell` membungkus
halaman dengan **TopNav sticky** (Logo + nav + user badge) dan kontainer
dengan `max-width: 1280px`.

### 4. Data Flow

Saat ini semua data berasal dari `data/mockData.ts`.
Komponen halaman mengimport langsung array/object yang dibutuhkan.

```
DashboardPage
   ↓ import { systemSummary, weeklyEnergySeries, roomAccumulation, smartDevices }
   ↓ teruskan ke <StatTile/>, <EnergyChart/>, <CostHighlight/>, dst
```

Untuk integrasi backend, tinggal ganti import dari `mockData` menjadi custom
hook (`useDevices()`, `useTelemetry()`) yang fetch via Axios.

### 5. Komunikasi dengan Backend (saat sudah live)

```
Frontend  ──HTTPS──▶  Backend API (Express, /api/devices)        ──▶  InfluxDB
                                                                  ──▶  Device Registry (JSON)
Frontend  ◀─WSS──   Realtime Gateway (ws, port 8090)             ◀──  MQTT Broker (EMQX)
                          ▲                                       ▲
                          │                                       │
                          └── ESP32-S3 Smart Socket ──MQTT────────┘
                              (telemetri ASCON-128 encrypted)
```

- **REST API** (`http://api/api/...`) untuk CRUD device, query history.
- **WebSocket** (`wss://gateway/ws`) untuk push update telemetri realtime ke
  dashboard tanpa polling.
- **Frontend tidak menyentuh MQTT langsung.** Realtime Gateway yang
  bridge MQTT → WebSocket karena browser tidak punya akses MQTT native.

---

## Design System

Semua nilai visual didefinisikan di **`src/styles/tokens.css`** sebagai CSS
custom properties. Mengubah tema (mis. dark mode) cukup override variabel di
selektor lain.

### Palette utama

| Token                | Hex       | Pemakaian                        |
|----------------------|-----------|----------------------------------|
| `--brand-navy-800`   | `#0e3a5c` | Hero banner, login panel kiri    |
| `--brand-blue-500`   | `#2196f3` | Tombol primary, link aktif       |
| `--brand-blue-600`   | `#1f7ad6` | Logo bg, hover primary           |
| `--success-500`      | `#10b981` | Status online, badge sukses      |
| `--warning-500`      | `#f59e0b` | Aksen, daya, target              |
| `--danger-500`       | `#ef4444` | Offline, error, paket ditolak    |
| `--mint-500`         | `#14b8a6` | Mode AUTO, socket aktif          |
| `--violet-500`       | `#8b5cf6` | Energi, mode manual              |
| `--bg-page`          | `#eef4fb` | Background halaman               |
| `--surface-white`    | `#ffffff` | Surface kartu                    |
| `--surface-dark`     | `#111827` | Background input (gaya finansial)|

### Spacing & Radius

Spacing kelipatan **4px**: `--space-1` (4px) → `--space-16` (64px).
Radius mulai `--radius-xs` (6px) → `--radius-2xl` (24px) + `--radius-pill` (999px).

### Typography

Font **Inter** (Google Fonts) dengan weight 400/500/600/700/800.
Ukuran skala: `--font-size-xs` (11px) → `--font-size-4xl` (36px).

### Shadow Tier

- `--shadow-sm` — border-like (input, stat tile idle)
- `--shadow-md` — kartu default
- `--shadow-lg` — modal / hover kartu interaktif
- `--shadow-brand` — tombol primary biru

### Responsive Breakpoint

| Breakpoint  | Layout |
|-------------|--------|
| ≥ 1100px    | Desktop full grid (KPI 5 kolom, dashboard 2-kolom) |
| 720-1099px  | Tablet (KPI 2-3 kolom, dashboard stack) |
| 480-719px   | Mobile (KPI 2 kolom, semua section stack) |
| < 480px     | Mobile sempit (KPI 1 kolom, tagline disembunyikan) |

---

## Cara Menjalankan

### Prasyarat
- Node.js ≥ 18
- npm ≥ 9

### Install dependency

```bash
cd frontend/dashboard
npm install
```

### Mode development (hot reload)

```bash
npm run dev
```

Buka [http://localhost:5173](http://localhost:5173). Login dengan
`admin@voltguard` (password apapun, demo mode).

### Build production

```bash
npm run build
```

Output di `dist/`. Bisa langsung di-serve dengan Nginx (lihat
[infra/digitalocean/nginx/dashboard.conf](../../infra/digitalocean/nginx/dashboard.conf))
atau static host lain.

### Preview build

```bash
npm run preview
```

---

## Integrasi Backend (Roadmap)

Saat ini frontend memakai **mock data**. Untuk live mode, tambahkan:

1. **Service layer** baru di `src/services/`:

   ```ts
   // src/services/api.ts
   import axios from "axios";
   export const api = axios.create({
     baseURL: import.meta.env.VITE_API_BASE_URL,
     timeout: 8000,
   });
   ```

2. **Custom hooks** di `src/hooks/`:

   ```ts
   // src/hooks/useDevices.ts
   import { useEffect, useState } from "react";
   import { api } from "../services/api";
   import type { SmartDevice } from "../types";

   export function useDevices() {
     const [devices, setDevices] = useState<SmartDevice[]>([]);
     useEffect(() => {
       api.get("/api/devices").then((r) => setDevices(r.data.devices));
     }, []);
     return devices;
   }
   ```

3. **Ganti import** di pages:

   ```diff
   - import { smartDevices } from "../data/mockData";
   + import { useDevices } from "../hooks/useDevices";
   ...
   - <SmartSocketCard device={smartDevices[0]} />
   + const devices = useDevices();
   + <SmartSocketCard device={devices[0]} />
   ```

4. **WebSocket realtime** untuk live telemetri:

   ```ts
   // src/services/ws.ts
   const ws = new WebSocket(import.meta.env.VITE_WS_URL);
   ws.onmessage = (e) => { /* update store */ };
   ```

5. **Environment variables** di `.env`:

   ```
   VITE_API_BASE_URL=https://api.voltguard.local
   VITE_WS_URL=wss://gateway.voltguard.local/ws
   ```

---

## Konvensi Kode

| Hal                        | Aturan |
|----------------------------|--------|
| Penamaan komponen          | PascalCase, satu komponen per file |
| Penamaan CSS class         | Prefix `vg-` + BEM (`vg-card__title`, `vg-btn--primary`) |
| Import order               | (1) external libs, (2) internal absolute, (3) relative, (4) CSS |
| Komentar                   | Indonesia. Setiap file punya header banner; setiap section diberi label `========` |
| Bahasa user-facing         | Indonesia (sesuai target user) |
| Currency                   | Rupiah, format `id-ID` (`Rp 1.444,70`) |
| Tipe                       | Definisi shared di `types.ts`. Hindari `any`. |
| State                      | Local `useState` jika hanya satu komponen; Zustand jika lintas-halaman |
| File CSS                   | Satu CSS per page (`pages/<name>.css`) + `primitives.css` global |

---

## Lisensi

Internal — bagian dari Tugas Akhir. Tidak untuk distribusi publik tanpa izin.
