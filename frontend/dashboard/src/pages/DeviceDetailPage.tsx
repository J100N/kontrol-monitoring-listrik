/* =============================================================================
 * DeviceDetailPage - halaman detail satu smart socket
 *
 * Komposisi:
 *   1. Breadcrumb (← Manajemen Device / nama device)
 *   2. Hero header (icon, nama, ID, ruangan, badges, relay quick-toggle)
 *   3. 4 metric tile (Daya, Tegangan, Arus, Energi)
 *   4. Grafik riwayat daya + sidebar: relay control + konfigurasi device
 *   5. Log event per-device
 *
 * Route: /devices/:id  — id diambil dari useParams().
 * Data: useDevice + useTelemetryHistory + useDeviceEvents + useCommand + usePatchDevice
 * ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import {
  ArrowLeftIcon,
  ClockIcon,
  PlugIcon,
  PowerIcon,
} from "../components/icons";
import { useDevice }           from "../hooks/useDevice";
import { useTelemetryHistory } from "../hooks/useTelemetryHistory";
import { useDeviceEvents }     from "../hooks/useDeviceEvents";
import { useCommand }          from "../hooks/useCommand";
import { usePatchDevice }      from "../hooks/usePatchDevice";
import { useSettingsStore }    from "../store/settingsStore";
import { tariffOptions }       from "../data/tariffs";
import type { AuditCategory } from "../types";
import "./device-detail.css";

// ── Konstanta lokal ────────────────────────────────────────────────────────

type DetailTimeRange = "24J" | "7H" | "30H";
const TIME_RANGES: readonly DetailTimeRange[] = ["24J", "7H", "30H"];

// Label rentang waktu untuk subjudul grafik agar jelas datanya periode apa.
const RANGE_LABEL: Record<DetailTimeRange, string> = {
  "24J": "24 jam terakhir",
  "7H":  "7 hari terakhir",
  "30H": "30 hari terakhir",
};

// ── Metrik grafik yang bisa dipilih (Daya/Tegangan/Arus/Energi) ─────────────
type MetricLabel = "Daya" | "Tegangan" | "Arus" | "Energi";
const METRIC_LABELS: readonly MetricLabel[] = ["Daya", "Tegangan", "Arus", "Energi"];

interface MetricConfig {
  key:      "power" | "voltage" | "current" | "energy"; // field di DeviceDataPoint
  unit:     string;
  color:    string;
  decimals: number; // jumlah desimal sesuai resolusi sensor
}

const METRIC_CFG: Record<MetricLabel, MetricConfig> = {
  Daya:     { key: "power",   unit: "W",   color: "#1f7ad6", decimals: 2 },
  Tegangan: { key: "voltage", unit: "V",   color: "#8b5cf6", decimals: 2 },
  Arus:     { key: "current", unit: "A",   color: "#f59e0b", decimals: 3 },
  Energi:   { key: "energy",  unit: "kWh", color: "#10b981", decimals: 3 },
};

/** Format angka gaya Indonesia dengan presisi tertentu (mis. 1.234,56) */
const formatNum = (v: number, decimals: number) =>
  Number(v).toLocaleString("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });

// Jumlah baris log event per halaman (paginasi) agar kartu tidak memanjang.
const EVENTS_PER_PAGE = 6;

// Log Event Device hanya menampilkan event OPERASIONAL perangkat (relay, mode,
// auto-control, koneksi, telemetri). Event keamanan/akses dipisah ke Audit log
// di halaman Security agar tidak tumpang tindih.
const OPERATIONAL_CATEGORIES = new Set<AuditCategory>(["CTRL", "SYS", "MQTT"]);

// Sistem 1 socket — aksen warna tunggal (biru). Fallback "blue" untuk id apa pun.
const DEVICE_ACCENT: Record<string, string> = {
  smart_socket: "blue",
};

const ACCENT_COLORS: Record<string, { bg: string; color: string }> = {
  blue: { bg: "linear-gradient(135deg,#e0f2fe,#bae6fd)", color: "#1f7ad6" },
};

// ── Sub-komponen MetricTile ────────────────────────────────────────────────

interface MetricTileProps {
  label: string;
  value: string;
  unit:  string;
  color: string;
  sub?:  string;
}

function MetricTile({ label, value, unit, color, sub }: MetricTileProps) {
  return (
    <div className="vg-detail-metric">
      <div className="vg-detail-metric__head">
        <span
          className="vg-detail-metric__dot"
          style={{ background: color }}
          aria-hidden="true"
        />
        <span className="vg-detail-metric__label">{label}</span>
      </div>
      <div className="vg-detail-metric__value">
        <span className="vg-detail-metric__num">{value}</span>
        {unit && <span className="vg-detail-metric__unit">{unit}</span>}
      </div>
      {sub && <p className="vg-detail-metric__sub">{sub}</p>}
    </div>
  );
}

// ── Komponen utama ─────────────────────────────────────────────────────────

export function DeviceDetailPage({ deviceId }: { deviceId?: string } = {}) {
  // deviceId di-pass saat halaman ini dipakai sebagai tampilan utama (1 socket).
  // Jika tidak, ambil dari URL (/devices/:id).
  const params = useParams<{ id: string }>();
  const id = deviceId ?? params.id;
  const embedded = Boolean(deviceId); // mode tampilan utama: tanpa breadcrumb

  const { device, loading: devLoading, error: devError } = useDevice(id);
  const [timeRange, setTimeRange] = useState<DetailTimeRange>("24J");
  const [metricLabel, setMetricLabel] = useState<MetricLabel>("Daya");
  const { points, loading: histLoading } = useTelemetryHistory(id, timeRange);
  const { events, loading: evtLoading }  = useDeviceEvents(id, "7d", 50);
  const { send, sending } = useCommand();
  const { patchDevice, setMode, loading: patching } = usePatchDevice();

  // Tarif tersimpan (dari Settings) untuk estimasi biaya — sinkron dengan golongan.
  const tariffId = useSettingsStore((s) => s.saved.tariffId);
  const ppjPct   = useSettingsStore((s) => s.saved.ppj);

  // Local UI state — dibaca dari device, disinkronkan saat device berubah
  const [relayOn,       setRelayOnLocal]  = useState(false);
  const [isAuto,        setIsAutoLocal]   = useState(false);
  const [threshold,     setThreshold]     = useState(10);
  const [pirTimeout,    setPirTimeout]    = useState(600);
  const [configDirty,   setConfigDirty]   = useState(false);
  const [saveMsg,       setSaveMsg]       = useState<string | null>(null);
  const [eventsPage,    setEventsPage]    = useState(1);

  // Hanya event operasional, diurutkan terbaru di atas (untuk paginasi log).
  const sortedEvents = useMemo(
    () =>
      events
        .filter((e) => OPERATIONAL_CATEGORIES.has(e.category))
        .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)),
    [events],
  );

  // Sync state lokal dengan device dari backend (hanya saat pertama / device berganti)
  useEffect(() => {
    if (!device) return;
    setRelayOnLocal(device.relayOn ?? (device.status === "online"));
    setIsAutoLocal(device.mode === "AUTO");
    setThreshold(device.threshold ?? 10);
    setPirTimeout(device.pirTimeout ?? 600);
    setConfigDirty(false);
    setEventsPage(1);
  }, [device?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sinkronkan tampilan relay dengan status aktual realtime (auto-control / perintah).
  useEffect(() => {
    if (device?.relayOn !== undefined) setRelayOnLocal(device.relayOn);
  }, [device?.relayOn]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (devLoading) {
    return (
      <div className="vg-detail-notfound">
        <p>Memuat data device…</p>
      </div>
    );
  }

  // ── Error / Not Found ────────────────────────────────────────────────────
  if (devError || !device) {
    return (
      <div className="vg-detail-notfound">
        <div className="vg-detail-notfound__icon" aria-hidden="true">
          <PlugIcon size={32} />
        </div>
        <h2>Device Tidak Ditemukan</h2>
        <p>
          {devError ?? (
            <>
              ID <code>{id}</code> tidak terdaftar dalam registry sistem
              VoltGuard.
            </>
          )}
        </p>
        <Link to="/devices">
          <Button
            variant="secondary"
            iconLeft={<ArrowLeftIcon size={15} />}
          >
            Kembali ke Manajemen Device
          </Button>
        </Link>
      </div>
    );
  }

  // ── Derivasi visual ──────────────────────────────────────────────────────
  const accent = DEVICE_ACCENT[device.id] ?? "blue";
  const { bg: accentBg, color: accentColor } = ACCENT_COLORS[accent];

  // Konfigurasi metrik grafik yang sedang dipilih (Daya/Tegangan/Arus/Energi).
  const metric = METRIC_CFG[metricLabel];

  // ── Sumbu waktu numerik per rentang ───────────────────────────────────────
  // Bingkai waktu tetap berbasis kalender (zona waktu browser) supaya grafik
  // selalu mulai dari awal periode & label tanggal/jam rapi tanpa duplikasi.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const dayEnd = dayStart + DAY_MS;

  const formatClock = (t: number) =>
    new Date(t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const formatDate = (t: number) =>
    new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short" });

  /** Bangun deret tick harian dari start hingga end (inklusif) per stepHari */
  const buildDayTicks = (start: number, end: number, stepDays: number) => {
    const ticks: number[] = [];
    for (let t = start; t <= end + 1; t += stepDays * DAY_MS) ticks.push(t);
    return ticks;
  };

  // Domain, tick, dan format label sumbu X bergantung rentang terpilih.
  let xDomain: [number, number];
  let xTicks: number[];
  let xTickFormat: (t: number) => string;
  let xTooltipFormat: (t: number) => string;

  if (timeRange === "24J") {
    xDomain = [dayStart, dayEnd]; // 00.00 → 24.00 hari ini
    xTicks = buildDayTicks(dayStart, dayEnd, 0.125); // tiap 3 jam
    xTickFormat = (t) => (t === dayEnd ? "24.00" : formatClock(t));
    xTooltipFormat = (t) => `Pukul ${formatClock(t)}`;
  } else if (timeRange === "7H") {
    const start = dayStart - 6 * DAY_MS; // 7 hari kalender termasuk hari ini
    xDomain = [start, dayEnd];
    xTicks = buildDayTicks(start, dayEnd, 1); // label tiap hari
    xTickFormat = (t) => formatDate(t);
    xTooltipFormat = (t) =>
      new Date(t).toLocaleString("id-ID", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
  } else {
    const start = dayStart - 29 * DAY_MS; // 30 hari kalender
    xDomain = [start, dayEnd];
    xTicks = buildDayTicks(start, dayEnd, 5); // label tiap 5 hari
    xTickFormat = (t) => formatDate(t);
    xTooltipFormat = (t) =>
      new Date(t).toLocaleString("id-ID", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
  }
  const isOffline = device.status === "offline";

  // Harga per kWh mengikuti golongan tarif terpilih di Settings (fallback ke
  // opsi recommended bila id tak ditemukan), lalu ditambah PPJ (% pajak).
  const pricePerKwh =
    tariffOptions.find((o) => o.id === tariffId)?.pricePerKwh ??
    tariffOptions.find((o) => o.recommended)?.pricePerKwh ??
    tariffOptions[0].pricePerKwh;
  const ppjFactor = 1 + (Number(ppjPct) || 0) / 100;
  const costEstimate = (device.energy * pricePerKwh * ppjFactor).toLocaleString(
    "id-ID",
    {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    },
  );

  // Paginasi log event: potong jadi beberapa halaman agar kartu tidak memanjang.
  const eventsTotalPages = Math.max(
    1,
    Math.ceil(sortedEvents.length / EVENTS_PER_PAGE),
  );
  const eventsSafePage = Math.min(eventsPage, eventsTotalPages);
  const pagedEvents = sortedEvents.slice(
    (eventsSafePage - 1) * EVENTS_PER_PAGE,
    eventsSafePage * EVENTS_PER_PAGE,
  );
  const eventsRangeStart = sortedEvents.length === 0
    ? 0
    : (eventsSafePage - 1) * EVENTS_PER_PAGE + 1;
  const eventsRangeEnd = Math.min(eventsSafePage * EVENTS_PER_PAGE, sortedEvents.length);

  const pirLabel =
    pirTimeout < 60
      ? `${pirTimeout} dtk`
      : `${Math.floor(pirTimeout / 60)} mnt`;

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleRelayToggle = async () => {
    if (isOffline || !id) return;
    const cmd = relayOn ? "RELAY_OFF" : "RELAY_ON";
    const result = await send(id, cmd);
    if (result?.ok) {
      setRelayOnLocal((v) => !v);
      // Kontrol relay manual → device pindah ke MANUAL; samakan tampilan mode.
      setIsAutoLocal(false);
    }
  };

  const handleModeToggle = async (next: boolean) => {
    if (!id) return;
    setIsAutoLocal(next);
    await setMode(id, next ? "auto" : "manual");
  };

  const handleSaveConfig = async () => {
    if (!id) return;
    setSaveMsg(null);
    const ok = await patchDevice(id, {
      power_threshold_w: threshold,
      pir_timeout_sec:   pirTimeout,
    });
    setSaveMsg(ok ? "Konfigurasi tersimpan!" : "Gagal menyimpan konfigurasi.");
    setConfigDirty(false);
    setTimeout(() => setSaveMsg(null), 3000);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* ================================================================
       * BREADCRUMB (disembunyikan saat dipakai sebagai tampilan utama)
       * ============================================================== */}
      {!embedded && (
        <nav className="vg-detail-breadcrumb" aria-label="Navigasi halaman">
          <Link to="/devices" className="vg-detail-back">
            <ArrowLeftIcon size={15} />
            Manajemen Device
          </Link>
          <span className="vg-detail-breadcrumb__sep" aria-hidden="true">/</span>
          <span className="vg-detail-breadcrumb__current">{device.label}</span>
        </nav>
      )}

      {/* ================================================================
       * HERO HEADER
       * ============================================================== */}
      <Card className="vg-detail-hero">
        <div className="vg-detail-hero__left">
          <div
            className="vg-detail-hero__icon"
            style={{ background: accentBg, color: accentColor }}
            aria-hidden="true"
          >
            <PlugIcon size={28} />
          </div>

          <div className="vg-detail-hero__info">
            <h1 className="vg-detail-hero__name">{device.label}</h1>
            <div className="vg-detail-hero__badges">
              <Badge tone={isOffline ? "danger" : "success"} dot>
                {isOffline ? "OFFLINE" : "ONLINE"}
              </Badge>
              <Badge tone={isAuto ? "auto" : "manual"}>
                {isAuto ? "AUTO" : "MANUAL"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="vg-detail-hero__right">
          <span className="vg-detail-hero__update">
            <ClockIcon size={13} />
            {device.lastUpdateText}
          </span>

          <div className="vg-detail-relay-quick">
            <div
              className={`vg-detail-relay-quick__indicator ${
                relayOn && !isOffline
                  ? "vg-detail-relay-quick__indicator--on"
                  : "vg-detail-relay-quick__indicator--off"
              }`}
              aria-hidden="true"
            >
              <PowerIcon size={22} />
            </div>
            <div>
              <div
                className={
                  relayOn && !isOffline
                    ? "vg-detail-relay-quick__status--on"
                    : "vg-detail-relay-quick__status--off"
                }
              >
                {relayOn && !isOffline ? "RELAY AKTIF" : "RELAY MATI"}
              </div>
            </div>
            <Button
              variant={relayOn && !isOffline ? "danger" : "primary"}
              size="sm"
              disabled={isOffline || sending}
              onClick={handleRelayToggle}
            >
              {sending
                ? "…"
                : relayOn && !isOffline
                ? "Matikan"
                : "Nyalakan"}
            </Button>
          </div>
        </div>
      </Card>

      {/* ================================================================
       * 6 METRIC TILES
       * ============================================================== */}
      <section
        className="vg-detail-metrics"
        aria-label="Metrik langsung device"
      >
        <MetricTile
          label="Daya"
          value={isOffline ? "—" : `${device.power}`}
          unit={isOffline ? "" : "W"}
          color="#1f7ad6"
          sub={isOffline ? "Tidak terhubung" : "Konsumsi saat ini"}
        />
        <MetricTile
          label="Tegangan"
          value={isOffline ? "—" : `${device.voltage}`}
          unit={isOffline ? "" : "V"}
          color="#8b5cf6"
          sub={isOffline ? undefined : "Nominal 220 V"}
        />
        <MetricTile
          label="Arus"
          value={isOffline ? "—" : `${device.current}`}
          unit={isOffline ? "" : "A"}
          color="#f59e0b"
          sub={isOffline ? undefined : "Batas aman 10 A"}
        />
        <MetricTile
          label="Energi"
          value={`${device.energy}`}
          unit="kWh"
          color="#10b981"
          sub={`≈ ${costEstimate}`}
        />
      </section>

      {/* ================================================================
       * GRAFIK + SIDEBAR KONTROL
       * ============================================================== */}
      <section className="vg-detail-main">
        {/* ── Grafik riwayat (Daya/Tegangan/Arus/Energi) ─────────────── */}
        <Card
          className="vg-detail-chart-card"
          title={`Riwayat ${metricLabel}`}
          subtitle={`Grafik ${metricLabel.toLowerCase()} (${metric.unit}) — ${RANGE_LABEL[timeRange]}`}
          headerRight={
            <SegmentedControl<DetailTimeRange>
              options={TIME_RANGES}
              value={timeRange}
              onChange={setTimeRange}
              ariaLabel="Pilih rentang waktu grafik"
            />
          }
        >
          {/* Pemilih metrik yang ditampilkan pada grafik */}
          <div className="vg-detail-chart__metrics">
            <SegmentedControl<MetricLabel>
              options={METRIC_LABELS}
              value={metricLabel}
              onChange={setMetricLabel}
              ariaLabel="Pilih metrik grafik"
            />
          </div>

          <div className="vg-detail-chart__plot">
            {histLoading ? (
              <div className="vg-detail-chart__loading">Memuat grafik…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={points}
                  margin={{ top: 8, right: 12, bottom: 0, left: 4 }}
                >
                  <defs>
                    <linearGradient
                      id="vgDetailGrad"
                      x1="0" y1="0" x2="0" y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={metric.color}
                        stopOpacity={0.4}
                      />
                      <stop
                        offset="100%"
                        stopColor={metric.color}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>

                  <CartesianGrid
                    strokeDasharray="3 6"
                    stroke="#e2e8f0"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="ts"
                    type="number"
                    scale="time"
                    domain={xDomain}
                    allowDataOverflow
                    ticks={xTicks}
                    tickFormatter={(t: number) => xTickFormat(t)}
                    stroke="#94a3b8"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={72}
                    domain={[0, "auto"]}
                    allowDecimals
                    tickFormatter={(v: number) => formatNum(v, metric.decimals)}
                    unit={` ${metric.unit}`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0f172a",
                      border: "none",
                      borderRadius: 10,
                      color: "white",
                      fontSize: 12,
                      padding: "8px 12px",
                    }}
                    labelStyle={{ color: "#94a3b8", fontWeight: 600 }}
                    cursor={{ stroke: "#cbd5e1", strokeWidth: 1 }}
                    formatter={(v: number) => [
                      `${formatNum(v, metric.decimals)} ${metric.unit}`,
                      metricLabel,
                    ]}
                    labelFormatter={(label) => xTooltipFormat(Number(label))}
                  />

                  {/* Garis ambang standby hanya relevan untuk grafik Daya */}
                  {metricLabel === "Daya" && (
                    <ReferenceLine
                      y={threshold}
                      stroke="#f59e0b"
                      strokeDasharray="5 4"
                      label={{
                        value: `Ambang standby ${threshold} W`,
                        fontSize: 10,
                        fontWeight: 600,
                        fill: "#b45309",
                        position: "insideTopLeft",
                      }}
                    />
                  )}

                  <Area
                    type="monotone"
                    dataKey={metric.key}
                    stroke={metric.color}
                    strokeWidth={2.5}
                    fill="url(#vgDetailGrad)"
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "white" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="vg-detail-chart__legend">
            <span
              className="vg-detail-chart__legend-dot"
              style={{ background: metric.color }}
            />
            <span>
              {metricLabel} ({metric.unit})
            </span>
            {metricLabel === "Daya" && (
              <>
                <span
                  className="vg-detail-chart__legend-dot vg-detail-chart__legend-dot--dash"
                  style={{ borderColor: "#f59e0b" }}
                />
                <span>Ambang standby ({threshold} W)</span>
              </>
            )}
          </div>
        </Card>

        {/* ── Sidebar: relay + konfigurasi ──────────────────────────── */}
        <aside className="vg-detail-sidebar">
          <Card title="Kontrol Relay" className="vg-detail-relay-card">
            <div className="vg-detail-relay">
              {/* Pemilih mode yang jelas: Otomatis / Manual */}
              <div
                className="vg-detail-mode"
                role="group"
                aria-label="Pilih mode operasi"
              >
                <button
                  type="button"
                  className={`vg-detail-mode__btn ${
                    isAuto ? "vg-detail-mode__btn--active" : ""
                  }`}
                  onClick={() => handleModeToggle(true)}
                  disabled={isOffline || patching}
                >
                  Otomatis
                </button>
                <button
                  type="button"
                  className={`vg-detail-mode__btn ${
                    !isAuto ? "vg-detail-mode__btn--active" : ""
                  }`}
                  onClick={() => handleModeToggle(false)}
                  disabled={isOffline || patching}
                >
                  Manual
                </button>
              </div>

              <button
                className={`vg-detail-relay__btn ${
                  relayOn && !isOffline
                    ? "vg-detail-relay__btn--on"
                    : "vg-detail-relay__btn--off"
                }`}
                onClick={handleRelayToggle}
                disabled={isOffline || sending}
                aria-label={
                  isOffline
                    ? "Device offline, tidak dapat dikontrol"
                    : relayOn
                    ? "Matikan relay"
                    : "Nyalakan relay"
                }
              >
                <PowerIcon size={36} />
              </button>

              <p className="vg-detail-relay__label">
                {isOffline
                  ? "Device Offline"
                  : relayOn
                  ? "Relay Aktif"
                  : "Relay Mati"}
              </p>
              <p className="vg-detail-relay__hint">
                {isOffline
                  ? "Perangkat tidak terhubung"
                  : isAuto
                  ? "Mode Otomatis aktif — tekan relay untuk ambil alih (jadi Manual)"
                  : "Mode Manual — tekan tombol untuk nyala/mati relay"}
              </p>
            </div>
          </Card>

          <Card title="Konfigurasi" className="vg-detail-config-card">
            <div className="vg-detail-config">
              {/* Feedback simpan */}
              {saveMsg && (
                <p
                  className={`vg-detail-config__msg ${
                    saveMsg.startsWith("Gagal")
                      ? "vg-detail-config__msg--err"
                      : "vg-detail-config__msg--ok"
                  }`}
                >
                  {saveMsg}
                </p>
              )}

              {/* Mode operasi dipindah ke kartu Kontrol Relay (tombol Otomatis/Manual). */}

              {/* Threshold standby */}
              <div className="vg-detail-config__field">
                <div className="vg-detail-config__field-header">
                  <span className="vg-detail-config__label">
                    Threshold Standby
                  </span>
                  <span className="vg-detail-config__field-val">
                    {threshold} W
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={threshold}
                  onChange={(e) => {
                    setThreshold(Number(e.target.value));
                    setConfigDirty(true);
                  }}
                  className="vg-detail-slider"
                  disabled={isOffline}
                  aria-label="Threshold standby dalam Watt"
                />
                <div className="vg-detail-config__field-limits">
                  <span>1 W</span>
                  <span>50 W</span>
                </div>
              </div>

              {/* PIR Timeout */}
              <div className="vg-detail-config__field">
                <div className="vg-detail-config__field-header">
                  <span className="vg-detail-config__label">PIR Timeout</span>
                  <span className="vg-detail-config__field-val">{pirLabel}</span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={3600}
                  step={30}
                  value={pirTimeout}
                  onChange={(e) => {
                    setPirTimeout(Number(e.target.value));
                    setConfigDirty(true);
                  }}
                  className="vg-detail-slider"
                  disabled={isOffline}
                  aria-label="PIR timeout dalam detik"
                />
                <div className="vg-detail-config__field-limits">
                  <span>30 dtk</span>
                  <span>60 mnt</span>
                </div>
              </div>

              <Button
                variant="primary"
                block
                size="sm"
                disabled={isOffline || patching || !configDirty}
                onClick={handleSaveConfig}
              >
                {patching ? "Menyimpan…" : "Simpan Konfigurasi"}
              </Button>
            </div>
          </Card>
        </aside>
      </section>

      {/* ================================================================
       * LOG EVENT DEVICE
       * ============================================================== */}
      <section className="vg-detail-events">
        <Card
          title="Log Event Device"
          subtitle={`Aktivitas operasional ${device.label} — relay, mode, auto-control & koneksi`}
        >
          <div className="vg-detail-events__wrap">
            {evtLoading ? (
              <p className="vg-detail-events__empty">Memuat log event…</p>
            ) : (
              <table className="vg-detail-events__table">
                <thead>
                  <tr>
                    <th>WAKTU</th>
                    <th>AKTIVITAS</th>
                    <th>SUMBER</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedEvents.map((e, idx) => (
                    <tr
                      key={`${e.ts ?? e.time}-${idx}`}
                      className={
                        e.highlight === "danger"
                          ? "vg-detail-events__row--danger"
                          : e.highlight === "warning"
                          ? "vg-detail-events__row--warning"
                          : ""
                      }
                    >
                      <td className="vg-detail-events__time">
                        <span className="vg-detail-events__time-h">{e.time}</span>
                        {e.date && (
                          <span className="vg-detail-events__date">{e.date}</span>
                        )}
                      </td>
                      <td className="vg-detail-events__msg">{e.message}</td>
                      <td className="vg-detail-events__src">
                        <code>{e.source}</code>
                      </td>
                    </tr>
                  ))}
                  {events.length === 0 && (
                    <tr>
                      <td colSpan={3} className="vg-detail-events__empty">
                        Tidak ada log event tersedia untuk device ini
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Paginasi — tampil hanya jika event melebihi satu halaman */}
          {!evtLoading && sortedEvents.length > 0 && (
            <div className="vg-detail-events__pager">
              <span className="vg-detail-events__pager-info">
                Menampilkan {eventsRangeStart}–{eventsRangeEnd} dari{" "}
                {sortedEvents.length} event
              </span>
              <div className="vg-detail-events__pager-controls">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEventsPage((p) => Math.max(1, p - 1))}
                  disabled={eventsSafePage <= 1}
                >
                  ← Sebelumnya
                </Button>
                <span className="vg-detail-events__pager-page">
                  {eventsSafePage} / {eventsTotalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setEventsPage((p) => Math.min(eventsTotalPages, p + 1))
                  }
                  disabled={eventsSafePage >= eventsTotalPages}
                >
                  Berikutnya →
                </Button>
              </div>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
