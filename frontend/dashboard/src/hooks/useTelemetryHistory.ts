/* =============================================================================
 * useTelemetryHistory — Ambil riwayat telemetri satu device dari InfluxDB
 *
 * Endpoint: GET /api/devices/:id/telemetry/history?range=<apiRange>
 *
 * Pemetaan rentang waktu (UI → API):
 *   "24J" → "24h"   (24 jam terakhir, label per jam)
 *   "7H"  → "7d"    (7 hari terakhir, label per hari)
 *   "30H" → "7d"    (30 hari tidak didukung, fallback ke 7d)
 *
 * Data yang dikembalikan: DeviceDataPoint[] → { label: string, power: number }
 * Dipakai langsung sebagai data pada Recharts AreaChart di DeviceDetailPage.
 * ========================================================================== */

import { useCallback, useEffect, useState } from "react";
import { api }                from "../services/api";
import { adaptHistoryPoint, RANGE_MAP } from "../lib/adapters";
import type { ApiHistoryPoint, DeviceDataPoint } from "../types";

export function useTelemetryHistory(
  deviceId: string | undefined,
  rangeKey:  string,              // Kunci rentang dari UI ("24J", "7H", "30H")
) {
  const [points,  setPoints]  = useState<DeviceDataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!deviceId) return;

    // Terjemahkan kunci rentang UI ke parameter API yang didukung backend
    const apiRange = RANGE_MAP[rangeKey] ?? "24h";
    setLoading(true);
    setError(null);

    try {
      const res = await api.get<{
        ok:     boolean;
        range:  string;
        points: ApiHistoryPoint[];
      }>(`/api/devices/${deviceId}/telemetry/history`, {
        params: { range: apiRange },
      });

      // Konversi setiap titik data: format timestamp → label yang mudah dibaca
      setPoints(
        (res.data.points ?? []).map((p) => adaptHistoryPoint(p, rangeKey)),
      );
    } catch (err) {
      setError((err as Error).message ?? "Gagal memuat riwayat");
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, [deviceId, rangeKey]);

  // Fetch ulang setiap kali deviceId atau rentang waktu berubah
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { points, loading, error };
}
