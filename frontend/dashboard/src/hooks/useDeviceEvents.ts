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
 *
 * LIVE UPDATE: pesan WebSocket dari worker memicu refetch otomatis, sehingga
 * log bertambah sendiri tanpa perlu me-refresh halaman.
 * ========================================================================== */

import { useCallback, useEffect, useState } from "react";
import { api }              from "../services/api";
import { wsService }        from "../services/ws";
import { adaptDeviceEvent } from "../lib/adapters";
import type { ApiDeviceEvent, AuditEntry, WsMessage } from "../types";

// Jeda sebelum refetch dipicu WebSocket. influx_writer menulis secara batch
// (flush ~2 detik), jadi beri kelonggaran agar event terbaru sudah bisa dikueri.
const REFETCH_DELAY_MS = 2500;

export function useDeviceEvents(
  deviceId: string | undefined,
  rangeKey  = "7d",  // Rentang waktu default: 7 hari terakhir
  limit     = 50,    // Maksimal jumlah event yang diambil
) {
  const [events,  setEvents]  = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // silent = refetch latar belakang (dipicu WebSocket): tidak menampilkan
  // spinner, dan bila gagal sesaat log lama TIDAK dikosongkan.
  const fetchEvents = useCallback(async (opts?: { silent?: boolean }) => {
    if (!deviceId) return;
    const silent = opts?.silent === true;

    if (!silent) {
      setLoading(true);
      setError(null);
    }

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
      setError(null);
    } catch (err) {
      if (!silent) {
        setError((err as Error).message ?? "Gagal memuat log event");
        setEvents([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [deviceId, rangeKey, limit]);

  // Fetch ulang saat device atau rentang berubah
  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  // Live update: setiap event OPERASIONAL (relay, konektivitas, ACK perintah,
  // aksi auto-control) yang di-push worker via WebSocket memicu refetch log.
  // Sengaja REFETCH — bukan menyisipkan entri sendiri di sisi klien — supaya
  // format pesan, kategori, dan timestamp persis sama dengan data backend,
  // sehingga tidak ada risiko entri ganda atau salah format.
  useEffect(() => {
    if (!deviceId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsub = wsService.subscribe((msg: WsMessage) => {
      if (msg.payload?.device_id !== deviceId) return;

      const type = msg.payload?.event_type;
      // Telemetri datang tiap ~1 detik dan tidak tampil di log operasional.
      if (!type || type === "telemetry_ingested") return;

      // Debounce: rentetan event beruntun cukup memicu satu kali refetch.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void fetchEvents({ silent: true }), REFETCH_DELAY_MS);
    });

    wsService.connect();  // idempoten: tidak membuka koneksi ganda

    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [deviceId, fetchEvents]);

  return { events, loading, error };
}
