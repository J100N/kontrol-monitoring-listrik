/* =============================================================================
 * StatTile - kartu KPI (label uppercase + angka besar + hint)
 *
 * Dipakai di Dashboard (Daya Total / Tegangan / Arus / dll) dan Security
 * (Paket Terenkripsi / Paket Ditolak / dll).
 * ========================================================================== */

import type { ReactNode } from "react";
import { TrendDownIcon, TrendUpIcon } from "../icons";

interface StatTileProps {
  /** Warna titik di samping label (mis. kuning untuk DAYA, biru untuk TEGANGAN) */
  indicatorColor?: string;
  label: string;
  /** Angka besar utama */
  value: ReactNode;
  /** Unit kecil di belakang angka (W, V, A, kWh, dll) */
  unit?: string;
  /** Teks hint di bawah angka */
  hint?: ReactNode;
  /** Tampilkan arrow naik/turun di hint */
  trend?: "up" | "down";
}

export function StatTile({
  indicatorColor = "#1f7ad6",
  label,
  value,
  unit,
  hint,
  trend,
}: StatTileProps) {
  // Class hint berbeda kalau ada arah trend supaya warnanya semantic
  const hintClass = [
    "vg-stat__hint",
    trend === "up" ? "vg-stat__hint--up" : "",
    trend === "down" ? "vg-stat__hint--down" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="vg-stat">
      <div className="vg-stat__head">
        <span
          className="vg-stat__indicator"
          style={{ background: indicatorColor }}
        />
        <span className="vg-stat__label">{label}</span>
      </div>
      <div className="vg-stat__value">
        <span>{value}</span>
        {unit && <span className="vg-stat__unit">{unit}</span>}
      </div>
      {hint && (
        <div className={hintClass}>
          {trend === "up" && <TrendUpIcon />}
          {trend === "down" && <TrendDownIcon />}
          <span>{hint}</span>
        </div>
      )}
    </div>
  );
}
