/* =============================================================================
 * useDeviceEvents — Ambil log event satu device dari InfluxDB (measurement: device_event)
 *
 * Endpoint: GET /api/devices/:id/events?range=<range>&limit=<limit>
 *
 * Jenis event yang disimpan backend:
 *   - relay_on / relay_off    → kontrol relay (manual atau auto)
 *   - command_ack             → konfirmasi perintah dari ESP32
 *   - command_timeout         → perintah tidak direspons dalam 8 detik
 *   - connectivity_*          → perangkat online/offline
 *   - telemetry_ingested      → data sensor diterima
 *
 * Data dikembalikan sebagai AuditEntry[] yang siap ditampilkan
 * di tabel log event pada DeviceDetailPage.
 * ========================================================================== */

import { useCallback, useEffect, useState } from "react";
import { api }              from "../services/api";
import { adaptDeviceEvent } from "../lib/adapters";
import type { ApiDeviceEvent, AuditEntry } from "../types";

export function useDeviceEvents(
  deviceId: string | undefined,
  rangeKey  = "7d",  // Rentang waktu default: 7 hari terakhir
  limit     = 50,    // Maksimal jumlah event yang diambil
) {
  const [events,  setEvents]  = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{
        ok:     boolean;
        range:  string;
        events: ApiDeviceEvent[];
      }>(`/api/devices/${deviceId}/events`, {
        params: { range: rangeKey, limit },
      });

      // Konversi setiap event dari format InfluxDB ke format tabel audit UI
      setEvents((res.data.events ?? []).map(adaptDeviceEvent));
    } catch (err) {
      setError((err as Error).message ?? "Gagal memuat log event");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [deviceId, rangeKey, limit]);

  // Fetch ulang saat device atau rentang berubah
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { events, loading, error };
}
