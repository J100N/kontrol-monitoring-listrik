/* =============================================================================
 * AuditLog - tabel jejak aktivitas sistem
 *
 * Filter pakai SegmentedControl. Saat klik "Auth", hanya tampil entry
 * dengan category AUTH. Sortir paling baru di atas.
 * ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import type { AuditCategory, AuditEntry } from "../../types";

interface AuditLogProps {
  entries: AuditEntry[];
}

// Jumlah baris per halaman agar tabel tidak memanjang.
const ROWS_PER_PAGE = 8;

/** Audit log fokus keamanan & akses — "Semua" = no filter */
type FilterTab = "Semua" | "Keamanan" | "Peringatan" | "Autentikasi";

const FILTERS: readonly FilterTab[] = [
  "Semua",
  "Keamanan",
  "Peringatan",
  "Autentikasi",
] as const;

/** Mapping filter tab → set kategori yang ditampilkan */
const FILTER_MAP: Record<FilterTab, AuditCategory[] | null> = {
  Semua: null,
  Keamanan: ["SEC"],
  Peringatan: ["WARN"],
  Autentikasi: ["AUTH"],
};

/** Mapping kategori → tone Badge */
const CATEGORY_TONE: Record<AuditCategory, "info" | "auto" | "neutral" | "warning" | "danger"> = {
  AUTH: "info",
  CTRL: "auto",
  MQTT: "neutral",
  WARN: "warning",
  SEC: "danger",
  SYS: "neutral",
};

export function AuditLog({ entries }: AuditLogProps) {
  const [filter, setFilter] = useState<FilterTab>("Semua");
  const [page, setPage] = useState(1);

  // Filter dilakukan via useMemo supaya hasilnya cached antar render saat
  // entries identik. Ringan untuk dataset kecil tapi best practice.
  const visible = useMemo(() => {
    const allowed = FILTER_MAP[filter];
    if (!allowed) return entries;
    return entries.filter((e) => allowed.includes(e.category));
  }, [entries, filter]);

  // Kembali ke halaman 1 saat filter berganti agar tidak nyangkut di halaman kosong.
  useEffect(() => {
    setPage(1);
  }, [filter]);

  // Paginasi hasil filter.
  const totalPages = Math.max(1, Math.ceil(visible.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = visible.slice(
    (safePage - 1) * ROWS_PER_PAGE,
    safePage * ROWS_PER_PAGE,
  );
  const rangeStart = visible.length === 0 ? 0 : (safePage - 1) * ROWS_PER_PAGE + 1;
  const rangeEnd = Math.min(safePage * ROWS_PER_PAGE, visible.length);

  return (
    <Card
      title="Audit log"
      subtitle="Insiden keamanan, peringatan sistem, & autentikasi"
      headerRight={
        <SegmentedControl<FilterTab>
          options={FILTERS}
          value={filter}
          onChange={setFilter}
        />
      }
    >
      <div className="vg-audit__wrap">
        <table className="vg-audit__table">
          <thead>
            <tr>
              <th>WAKTU</th>
              <th>JENIS</th>
              <th>AKTIVITAS</th>
              <th>SUMBER</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((e, idx) => (
              <tr
                key={`${e.time}-${idx}`}
                className={
                  e.highlight === "danger"
                    ? "vg-audit__row--danger"
                    : e.highlight === "warning"
                    ? "vg-audit__row--warning"
                    : ""
                }
              >
                <td className="vg-audit__time">{e.time}</td>
                <td>
                  <Badge tone={CATEGORY_TONE[e.category]}>{e.category}</Badge>
                </td>
                <td className="vg-audit__msg">{e.message}</td>
                <td className="vg-audit__src">
                  <code>{e.source}</code>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="vg-audit__empty">
                  Tidak ada entri untuk filter ini
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginasi — tampil hanya jika hasil melebihi satu halaman */}
      {visible.length > 0 && (
        <div className="vg-audit__pager">
          <span className="vg-audit__pager-info">
            Menampilkan {rangeStart}–{rangeEnd} dari {visible.length} entri
          </span>
          <div className="vg-audit__pager-controls">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
            >
              ← Sebelumnya
            </Button>
            <span className="vg-audit__pager-page">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
            >
              Berikutnya →
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
