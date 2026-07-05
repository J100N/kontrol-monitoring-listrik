/* =============================================================================
 * SecurityPage - monitoring keamanan & audit
 *
 * Komposisi:
 *   1. Header
 *   2. Hero banner navy "Enkripsi end-to-end aktif" (ASCON-128)
 *   3. 3 KPI yang dihitung dari data NYATA (event log + status device)
 *   4. AuditLog (full width) — diisi event asli dari backend
 *
 * Catatan: semua angka di halaman ini diturunkan dari data nyata
 * (event device + status online), bukan nilai contoh.
 * ========================================================================== */

import { useMemo } from "react";
import { StatTile } from "../components/ui/StatTile";
import { Badge } from "../components/ui/Badge";
import { ShieldIcon } from "../components/icons";
import { AuditLog } from "../features/security/AuditLog";
import { useDevices } from "../hooks/useDevices";
import { useDeviceEvents } from "../hooks/useDeviceEvents";
import type { AuditCategory } from "../types";
import "./security.css";

// Sistem 1 socket.
const MAIN_DEVICE_ID = "smart_socket";

// Audit log HANYA menampilkan event keamanan & akses (tidak tumpang tindih
// dengan Log Event Device di dashboard yang menampilkan event operasional).
const AUDIT_CATEGORIES = new Set<AuditCategory>(["SEC", "WARN", "AUTH"]);

export function SecurityPage() {
  const { devices } = useDevices();
  const { events, loading } = useDeviceEvents(MAIN_DEVICE_ID, "7d", 100);

  const onlineCount = devices.filter((d) => d.status === "online").length;

  // Saring hanya event keamanan/akses untuk audit log + KPI.
  const auditEvents = useMemo(
    () => events.filter((e) => AUDIT_CATEGORIES.has(e.category)),
    [events],
  );
  const securityIncidents = useMemo(
    () => auditEvents.filter((e) => e.category === "SEC").length,
    [auditEvents],
  );
  const warnings = useMemo(
    () => auditEvents.filter((e) => e.category === "WARN").length,
    [auditEvents],
  );

  const anyOnline = onlineCount > 0;

  return (
    <>
      {/* HEADER */}
      <div className="vg-page-header">
        <div>
          <h1 className="vg-page-header__title">Security &amp; audit</h1>
          <p className="vg-page-header__subtitle">
            Insiden keamanan, peringatan, &amp; autentikasi — terpisah dari log
            operasional perangkat di dashboard
          </p>
        </div>
      </div>

      {/* HERO BANNER (navy gradient) */}
      <section className="vg-sec-banner">
        <div className="vg-sec-banner__icon">
          <ShieldIcon size={26} />
        </div>
        <div className="vg-sec-banner__text">
          <h2>Enkripsi end-to-end aktif</h2>
          <p>
            Seluruh komunikasi MQTT antara smart socket dan broker dilindungi
            ASCON-128 (AEAD) dengan proteksi anti-replay counter
          </p>
        </div>
        <div className="vg-sec-banner__status">
          <Badge tone={anyOnline ? "success" : "neutral"} dot>
            {anyOnline ? "OPERATIONAL" : "OFFLINE"}
          </Badge>
          <span className="vg-sec-banner__uptime">
            Perangkat online: {onlineCount}/{devices.length || 0}
          </span>
        </div>
      </section>

      {/* KPI — dihitung dari event keamanan/akses nyata */}
      <section className="vg-sec__kpis">
        <StatTile
          indicatorColor={securityIncidents > 0 ? "#ef4444" : "#10b981"}
          label="Insiden Keamanan"
          value={loading ? "…" : securityIncidents.toLocaleString("id-ID")}
          hint="Dekripsi gagal / percobaan replay"
        />
        <StatTile
          indicatorColor={warnings > 0 ? "#f59e0b" : "#10b981"}
          label="Peringatan Sistem"
          value={loading ? "…" : warnings.toLocaleString("id-ID")}
          hint="Error / timeout komunikasi"
        />
        <StatTile
          indicatorColor="#10b981"
          label="Perangkat Online"
          value={`${onlineCount}/${devices.length || 0}`}
          hint="Status konektivitas saat ini"
        />
      </section>

      {/* AUDIT LOG — khusus event keamanan/akses */}
      <section className="vg-sec__audit">
        <AuditLog entries={auditEvents} />
      </section>
    </>
  );
}
