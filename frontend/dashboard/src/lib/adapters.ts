/* =============================================================================
 * adapters.ts - Mapping antara bentuk data backend (snake_case) dan frontend
 *
 * Backend pakai konvensi snake_case (device_id, power_w, energy_wh).
 * Frontend pakai camelCase + unit yang lebih user-friendly (kWh, A, V, Hz).
 * ========================================================================== */

import type {
  ApiDevice,
  ApiDeviceEvent,
  ApiHistoryPoint,
  ApiTelemetry,
  AuditCategory,
  AuditEntry,
  DeviceDataPoint,
  RoomAccumulation,
  SmartDevice,
  SystemSummary,
  TimeSeriesPoint,
} from "../types";

// ── Device ─────────────────────────────────────────────────────────────────

/** Ubah ApiDevice (dari /api/devices) menjadi SmartDevice yang dipahami UI */
export function adaptDevice(api: ApiDevice): SmartDevice {
  const t = api.latest_telemetry;
  // Resolusi energi PZEM-004T = 1 Wh = 0,001 kWh → maksimal 3 desimal bermakna.
  const energyKwh = t
    ? +(t.energy_wh / 1000).toFixed(3)
    : api.energy_total_wh != null
    ? +(api.energy_total_wh / 1000).toFixed(3)
    : 0;

  // PZEM dipasang di sisi beban (setelah relay). Saat relay OFF, PZEM kehilangan
  // daya sehingga tidak ada arus/tegangan yang terbaca → nilai live = 0.
  // Energi (kWh) tetap dipertahankan karena bersifat kumulatif (counter).
  const relayOff = api.relay_on === false;

  return {
    id: api.device_id,
    label: api.label,
    room: api.room,
    status: api.online ? "online" : "offline",
    mode: api.mode === "auto" ? "AUTO" : "MANUAL",
    power: relayOff ? 0 : (t?.power_w ?? 0),
    voltage: relayOff ? 0 : (t?.voltage_v ?? 0),
    current: relayOff ? 0 : (t?.current_a ?? 0),
    energy: energyKwh,
    frequency: t?.frequency_hz ?? 50,
    powerFactor: t?.power_factor ?? 0,
    threshold: api.power_threshold_w,
    pirTimeout: api.pir_timeout_sec,
    relayOn: api.relay_on,
    lastUpdateText: api.last_seen_at
      ? `Update ${formatTimeAgo(api.last_seen_at)}`
      : "Belum pernah online",
    trend: [],
  };
}

/** Terapkan patch telemetri langsung ke SmartDevice (dari WS update) */
export function applyTelemetryPatch(
  device: SmartDevice,
  t: Partial<ApiTelemetry>,
): Partial<SmartDevice> {
  const patch: Partial<SmartDevice> = {};
  if (t.power_w != null)   patch.power   = t.power_w;
  if (t.voltage_v != null) patch.voltage = t.voltage_v;
  if (t.current_a != null) patch.current = t.current_a;
  if (t.energy_wh != null) patch.energy  = +(t.energy_wh / 1000).toFixed(3);
  if (t.frequency_hz != null)  patch.frequency    = t.frequency_hz;
  if (t.power_factor != null)  patch.powerFactor  = t.power_factor;
  return patch;
}

// ── Telemetry history ──────────────────────────────────────────────────────

/** Mapping dari rentang waktu UI ke parameter API */
export const RANGE_MAP: Record<string, string> = {
  "24J": "24h",
  "7H":  "7d",
  "30H": "30d",
  "1h":  "1h",
  "6h":  "6h",
  "24h": "24h",
  "7d":  "7d",
};

/** Ubah satu titik history InfluxDB menjadi DeviceDataPoint untuk chart */
export function adaptHistoryPoint(
  p: ApiHistoryPoint,
  rangeKey: string,
): DeviceDataPoint {
  // Pertahankan presisi sesuai resolusi sensor PZEM-004T (jangan dibulatkan ke
  // integer): daya 0,1 W, tegangan 0,1 V, arus 0,001 A, energi 1 Wh.
  return {
    label:   formatHistoryLabel(p._time, rangeKey),
    ts:      new Date(p._time).getTime(),
    power:   +(p.power_w   ?? 0).toFixed(2),
    voltage: +(p.voltage_v ?? 0).toFixed(2),
    current: +(p.current_a ?? 0).toFixed(3),
    energy:  +((p.energy_wh ?? 0) / 1000).toFixed(3),
  };
}

// ── Device events ──────────────────────────────────────────────────────────

/**
 * Peta ALASAN auto-control dari firmware (channel "auto_control") → kalimat ramah.
 * Selalu diawali "Otomatis:" supaya pengguna tahu aksi ini dari mode otomatis.
 */
const AUTO_REASON_MAP: Record<string, string> = {
  motion_detected_relay_off_auto_on:    "Otomatis: gerakan terdeteksi → listrik dinyalakan",
  motion_detected_keep_on:              "Otomatis: gerakan terdeteksi → listrik tetap menyala",
  no_motion_10m_and_low_power_auto_off: "Otomatis: tidak ada gerakan & daya rendah → listrik dimatikan",
  no_motion_met_but_power_still_high:   "Otomatis: tidak ada gerakan, tapi daya masih tinggi → listrik tetap menyala",
  waiting_no_motion_window:             "Otomatis: menunggu batas waktu tanpa gerakan",
  relay_already_off:                    "Otomatis: listrik memang sudah mati",
  auto_off_disabled:                    "Otomatis: fitur mati-otomatis dinonaktifkan",
};

/**
 * Peta pesan ACK firmware (perintah manual / ganti mode / konfigurasi) → kalimat ramah.
 * Perintah relay manual menyebut aksi & mode secara eksplisit.
 */
const ACK_MESSAGE_MAP: Record<string, string> = {
  "listrik dinyalakan manual":            "Manual: listrik dinyalakan",
  "listrik dimatikan manual":             "Manual: listrik dimatikan",
  "gagal eksekusi relay":                 "Manual: gagal mengubah listrik",
  "command dieksekusi":                   "Manual: perintah listrik dijalankan", // firmware lama (sebelum reflash)
  "mode otomatis aktif":                  "Mode diubah ke Otomatis",
  "mode manual aktif":                    "Mode diubah ke Manual",
  "konfigurasi auto-control diperbarui":  "Konfigurasi otomatis diperbarui (PIR & ambang daya)",
  "gagal menerapkan konfigurasi":         "Gagal menerapkan konfigurasi otomatis",
  "parameter config_update tidak valid":  "Parameter konfigurasi tidak valid",
  "pong":                                 "Uji koneksi perangkat berhasil",
  "command tidak dikenal":                "Perintah tidak dikenali perangkat",
  "decrypt command gagal":                "Perintah gagal didekripsi (keamanan)",
  "format command tidak valid":           "Format perintah tidak valid",
  "relay init gagal":                     "Inisialisasi relay gagal",
};

/** Terjemahkan pesan event mentah menjadi kalimat yang mudah dipahami pengguna */
// Label singkat & ramah-awam per jenis event. Menyembunyikan detail teknis/ID
// mentah (mis. "command id=api-123 tidak menerima ack") agar log mudah dibaca.
const EVENT_TYPE_LABELS: Record<string, string> = {
  command_timeout:             "Perintah tidak direspons perangkat",
  security_injection_rejected: "Payload tidak valid",
  security_tamper_rejected:    "Verifikasi tag gagal",
  // Catatan: TIDAK ada label replay TELEMETRI di sini. Penolakan ctr telemetri adalah
  // dedup operasional (dominan: redelivery QoS 1 saat koneksi labil), bukan serangan —
  // mencatatnya sbg serangan dulu membanjiri Log Keamanan dgn alarm palsu. Lihat
  // telemetryHandler.js pada blok replayGuard.check.
  // Penolakan perintah oleh firmware (dari ACK error) — event_type mengandung
  // "reject" sehingga mapEventCategory memetakannya ke kategori SEC.
  security_command_tamper_rejected:    "Perintah diubah ditolak",
  security_command_injection_rejected: "Perintah tidak valid ditolak",
  security_command_replay_rejected:    "Perintah lama dikirim ulang ditolak",
};

function humanizeEventMessage(e: ApiDeviceEvent): string {
  const raw = (e.message ?? "").trim();
  const key = raw.toLowerCase();

  // 0) Label singkat berdasarkan jenis event (paling diprioritaskan)
  if (EVENT_TYPE_LABELS[e.event_type ?? ""]) {
    return EVENT_TYPE_LABELS[e.event_type ?? ""];
  }

  // 1) Alasan aksi mode OTOMATIS (auto-control)
  if (AUTO_REASON_MAP[key]) return AUTO_REASON_MAP[key];

  // 2) Pesan ACK perintah (manual / ganti mode / konfigurasi)
  if (ACK_MESSAGE_MAP[key]) return ACK_MESSAGE_MAP[key];

  // 3) Status relay terkonfirmasi perangkat: "relay -> ON/OFF"
  const relay = raw.match(/relay\s*(?:->|→)\s*(on|off)/i);
  if (relay) {
    return relay[1].toUpperCase() === "ON" ? "Listrik dinyalakan" : "Listrik dimatikan";
  }

  // 4) Status konektivitas: "connectivity -> ONLINE/OFFLINE"
  const conn = raw.match(/connectivity\s*(?:->|→)\s*(online|offline)/i);
  if (conn) {
    return conn[1].toUpperCase() === "ONLINE"
      ? "Perangkat terhubung ke server"
      : "Perangkat terputus dari server";
  }

  // 5) Ada pesan tapi tak dikenal → rapikan underscore agar tetap terbaca
  if (raw) return raw.replace(/_/g, " ");

  // 6) Tidak ada pesan → gunakan jenis event sebagai fallback
  return `${e.event_type ?? "event"} — ${e.status ?? ""}`.trim();
}

/** Ubah event InfluxDB menjadi AuditEntry yang dipahami AuditLog component */
export function adaptDeviceEvent(e: ApiDeviceEvent): AuditEntry {
  const category = mapEventCategory(e.event_type ?? "", e.channel ?? "");
  const isError  = e.status === "error";
  const isWarn   =
    !isError &&
    (e.event_type?.includes("timeout") ||
      e.event_type?.includes("warn") ||
      e.event_type?.includes("rejected"));

  const ts = (() => {
    const t = new Date(e._time).getTime();
    return Number.isNaN(t) ? 0 : t;
  })();

  return {
    time:      formatIsoToHms(e._time),
    date:      formatIsoToDate(e._time),
    ts,
    category,
    message:   humanizeEventMessage(e),
    source:    e.device_id ?? "system",
    highlight: isError ? "danger" : isWarn ? "warning" : undefined,
  };
}

/** Format ISO → tanggal lokal singkat, mis. "31 Mei 2026" */
function formatIsoToDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return "";
  }
}

// ── System summary (derived) ───────────────────────────────────────────────

/** Hitung SystemSummary dari array device yang sudah ada telemetrinya */
export function deriveSystemSummary(devices: SmartDevice[]): SystemSummary {
  const online = devices.filter((d) => d.status === "online");
  const totalPower   = online.reduce((s, d) => s + d.power, 0);
  const avgVoltage   = online.length
    ? online.reduce((s, d) => s + d.voltage, 0) / online.length
    : 0;
  const totalCurrent = online.reduce((s, d) => s + d.current, 0);
  const totalEnergy  = devices.reduce((s, d) => s + d.energy, 0);
  const TARIFF       = 1444.7;

  return {
    totalPower:         Math.round(totalPower),
    voltage:            +avgVoltage.toFixed(1),
    current:            +totalCurrent.toFixed(2),
    energyKwh:          +totalEnergy.toFixed(1),
    socketsActive:      online.length,
    socketsTotal:       devices.length,
    socketsOffline:     devices.length - online.length,
    weeklyCost:         Math.round(totalEnergy * TARIFF),
    monthlyEstimate:    Math.round(totalEnergy * TARIFF * 4.3),
    monthlyKwhEstimate: +( totalEnergy * 4.3).toFixed(1),
    weeklyCostDeltaPct: 0,
    energyDeltaPct:     0,
    powerDeltaPct:      0,
  };
}

/** Group devices by room → RoomAccumulation[] */
export function deriveRoomAccumulation(devices: SmartDevice[]): RoomAccumulation[] {
  const TONES: RoomAccumulation["tone"][] = ["blue", "yellow", "mint", "gray"];
  const map = new Map<string, { kwh: number; online: boolean }>();

  for (const d of devices) {
    const prev = map.get(d.room) ?? { kwh: 0, online: false };
    map.set(d.room, {
      kwh:    prev.kwh + d.energy,
      online: prev.online || d.status === "online",
    });
  }

  return Array.from(map.entries()).map(([room, v], idx) => ({
    room,
    kwh:    +v.kwh.toFixed(2),
    online: v.online,
    tone:   TONES[idx % TONES.length],
  }));
}

/** Agregasi history multi-device menjadi TimeSeriesPoint[] (untuk dashboard chart) */
export function aggregateHistory(
  allPoints: Record<string, ApiHistoryPoint[]>,
): TimeSeriesPoint[] {
  // Kumpulkan semua label unik, lalu sum power_w per label
  const powerMap = new Map<string, number>();
  for (const points of Object.values(allPoints)) {
    for (const p of points) {
      const label = formatHistoryLabel(p._time, "7d");
      powerMap.set(label, (powerMap.get(label) ?? 0) + Math.round(p.power_w ?? 0));
    }
  }
  const sorted = Array.from(powerMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return sorted.map(([label, current]) => ({ label, current, previous: 0 }));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTimeAgo(epochMs: number): string {
  const delta = Date.now() - epochMs;
  if (delta < 60_000)   return `${Math.floor(delta / 1_000)} detik lalu`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} menit lalu`;
  const d = new Date(epochMs);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function formatIsoToHms(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("id-ID", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatHistoryLabel(iso: string, rangeKey: string): string {
  try {
    const d = new Date(iso);
    if (rangeKey === "24h" || rangeKey === "24J") {
      // "14:00"
      return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    }
    // "Sen", "Sel", dst.
    return d.toLocaleDateString("id-ID", { weekday: "short" });
  } catch {
    return iso;
  }
}

function mapEventCategory(eventType: string, channel: string): AuditCategory {
  if (channel === "manual_control" || channel === "auto_control") {
    if (eventType.includes("ack")) return "CTRL";
    return "CTRL";
  }
  if (channel === "device_state") {
    if (eventType.includes("relay"))        return "CTRL";
    if (eventType.includes("connectivity")) return "SYS";
  }
  if (eventType.includes("telemetry"))  return "MQTT";
  if (eventType.includes("auth"))       return "AUTH";
  if (eventType.includes("reject") || eventType.includes("replay")) return "SEC";
  if (eventType.includes("error") || eventType.includes("failed"))  return "WARN";
  return "SYS";
}
