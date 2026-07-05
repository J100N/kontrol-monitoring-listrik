/* =============================================================================
 * VoltGuard - Type Definitions
 *
 * Semua interface TypeScript yang dipakai lintas-komponen ditaruh di sini.
 * Jangan duplikasi tipe di file lain - import dari sini.
 * ========================================================================== */

/** Status koneksi device */
export type DeviceStatus = "online" | "offline";

/** Mode kontrol device: AUTO (PIR-based otomatis) atau MANUAL (kendali user) */
export type DeviceMode = "AUTO" | "MANUAL";

/** Periode tampilan grafik */
export type TimeRange = "Hari" | "Minggu" | "Bulan" | "Tahun";

/** Metric yang bisa ditampilkan di chart utama */
export type EnergyMetric = "Daya" | "Tegangan" | "Arus" | "Energi";

/** Smart socket / device IoT */
export interface SmartDevice {
  id: string; // contoh: "smart_socket"
  label: string; // nama tampilan: "Smart Socket Ruang Tamu"
  room: string; // ruangan: "Ruang Tamu"
  status: DeviceStatus;
  mode: DeviceMode;
  power: number; // Watt (W)
  voltage: number; // Volt (V)
  current: number; // Ampere (A)
  energy: number; // kWh akumulasi
  frequency: number; // Hz (frekuensi PLN, nominal 50 Hz)
  powerFactor: number; // 0–1 (faktor daya, 1 = ideal)
  threshold: number; // ambang batas standby (W)
  pirTimeout: number; // detik
  relayOn?: boolean; // status relay aktual (ON=true / OFF=false); undefined = belum diketahui
  lastUpdateText: string; // "Update 2 detik lalu"
  trend: number[]; // sample data mini-chart per device
}

/** Titik data deret-waktu per-device untuk halaman detail */
export interface DeviceDataPoint {
  label: string;   // "00:00", "Sen", "1 Apr", dll
  ts: number;      // epoch ms titik data (untuk sumbu waktu numerik)
  power: number;   // Watt
  voltage: number; // Volt
  current: number; // Ampere
  energy: number;  // kWh (kumulatif)
}

/** Snapshot agregat seluruh sistem (untuk dashboard) */
export interface SystemSummary {
  totalPower: number; // W
  voltage: number; // V (rata-rata)
  current: number; // A (total)
  energyKwh: number; // kWh konsumsi periode aktif
  socketsActive: number;
  socketsTotal: number;
  socketsOffline: number;
  weeklyCost: number; // Rupiah
  monthlyEstimate: number; // Rupiah
  monthlyKwhEstimate: number;
  weeklyCostDeltaPct: number; // % vs target/minggu lalu
  energyDeltaPct: number; // % vs minggu lalu
  powerDeltaPct: number;
}

/** Akumulasi konsumsi per ruangan (bar chart panel) */
export interface RoomAccumulation {
  room: string;
  kwh: number;
  online: boolean;
  tone: "blue" | "yellow" | "mint" | "gray";
}

/** Titik data deret-waktu untuk chart utama */
export interface TimeSeriesPoint {
  label: string; // "Sen", "Sel", ...
  current: number; // periode ini
  previous: number; // periode sebelumnya (komparasi)
}

/** Tarif PLN */
export interface TariffOption {
  id: string;
  label: string; // "R-1 / 1.300 VA"
  category: string; // "Non-subsidi"
  pricePerKwh: number;
  recommended?: boolean;
}

/** Audit log entry */
export type AuditCategory =
  | "AUTH"
  | "CTRL"
  | "MQTT"
  | "WARN"
  | "SEC"
  | "SYS";

// ═══════════════════════════════════════════════════════════════════════════
// BACKEND API SHAPES  (snake_case, sesuai respons Node.js / InfluxDB)
// ═══════════════════════════════════════════════════════════════════════════

/** Telemetri terkini dari InfluxDB (satu set field dari measurement power_telemetry) */
export interface ApiTelemetry {
  ts: string;
  device_id: string;
  power_w: number;
  voltage_v: number;
  current_a: number;
  energy_wh: number;
  frequency_hz?: number;
  power_factor?: number;
  alarm?: number;
}

/** Device dari device_registry + latest_telemetry yang di-join oleh API */
export interface ApiDevice {
  device_id: string;
  label: string;
  room: string;
  mode: "manual" | "auto";
  online: boolean;
  power_threshold_w: number;
  pir_timeout_sec: number;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
  relay_on?: boolean;
  pending_provisioning?: boolean;
  latest_telemetry: ApiTelemetry | null;
  energy_total_wh?: number | null;
}

/** Satu titik history dari Flux aggregateWindow (hasil pivot) */
export interface ApiHistoryPoint {
  _time: string;
  device_id?: string;
  power_w?: number;
  voltage_v?: number;
  current_a?: number;
  energy_wh?: number;
}

/** Event device dari measurement device_event (InfluxDB pivot) */
export interface ApiDeviceEvent {
  _time: string;
  device_id?: string;
  event_type?: string;
  status?: string;
  message?: string;
  command_id?: string;
  latency_ms?: number;
  channel?: string;
}

/** Pesan broadcast dari realtime_gateway (MQTT → WS) */
export interface WsMessage {
  topic: string;          // "dashboard/devices/{id}/status"
  received_at: number;
  payload: {
    worker?: string;
    device_id: string;
    status: string;       // "ok" | "error"
    channel: string;      // "monitoring" | "manual_control" | "device_state"
    event_type: string;   // "telemetry_ingested" | "connectivity_status_update" | ...
    reason?: string;
    ts?: number;
    power_w?: number;
    voltage_v?: number;
    current_a?: number;
    energy_wh?: number;
    command_id?: string;
    relay_status?: string;           // "RELAY_ON" | "RELAY_OFF"
    connectivity_status?: string;    // "ONLINE" | "OFFLINE"
    latency_ms?: number;
  };
}

export interface AuditEntry {
  time: string; // "19:42:08"
  date?: string; // "31 Mei 2026"
  ts?: number; // epoch ms — untuk pengurutan
  category: AuditCategory;
  message: string;
  source: string; // device_id atau IP atau "system"
  highlight?: "danger" | "warning"; // styling baris
}
