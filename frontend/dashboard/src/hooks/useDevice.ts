/* =============================================================================
 * useDevice — Ambil detail satu device + update real-time via WebSocket
 *
 * Perbedaan dengan useDevices:
 *   - Hanya fetch satu device berdasarkan deviceId
 *   - Filter pesan WS: hanya proses pesan untuk device ini (cek device_id)
 *   - Dipakai di DeviceDetailPage untuk data yang lebih kaya (frekuensi, PF)
 *
 * Alur:
 *   1. GET /api/devices/:id → simpan ke state lokal
 *   2. WS subscriber: filter event_type → patch state lokal langsung
 * ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { api }         from "../services/api";
import { wsService }   from "../services/ws";
import { adaptDevice } from "../lib/adapters";
import type { ApiDevice, SmartDevice, WsMessage } from "../types";

// Interval auto-refresh latar belakang (jaring pengaman bila WebSocket putus).
const REFRESH_INTERVAL_MS = 10_000;

export function useDevice(deviceId: string | undefined) {
  const [device,  setDevice]  = useState<SmartDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Guard fetch — reset saat deviceId berganti (navigasi antar device)
  const fetchedRef = useRef(false);

  /**
   * Ambil data device dari REST API.
   * opts.silent = true → refresh latar belakang (tidak menampilkan spinner /
   * menimpa error), dipakai oleh auto-refresh berkala agar tampilan tidak berkedip.
   */
  const fetchDevice = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!deviceId) return;
      if (!opts?.silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await api.get<{ ok: boolean; device: ApiDevice }>(
          `/api/devices/${deviceId}`,
        );
        setDevice(adaptDevice(res.data.device));
      } catch (err) {
        if (!opts?.silent) {
          setError((err as Error).message ?? "Gagal memuat data device");
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [deviceId],
  );

  // Reset guard saat berpindah ke device lain
  useEffect(() => {
    fetchedRef.current = false;
  }, [deviceId]);

  // Fetch sekali saat pertama render (atau setelah deviceId berubah)
  useEffect(() => {
    if (fetchedRef.current || !deviceId) return;
    fetchedRef.current = true;
    fetchDevice();
  }, [fetchDevice, deviceId]);

  // WebSocket: update telemetri dan status hanya untuk device ini
  useEffect(() => {
    if (!deviceId) return;

    const unsub = wsService.subscribe((msg: WsMessage) => {
      // Abaikan pesan dari device lain
      if (msg.payload?.device_id !== deviceId) return;

      const {
        event_type, power_w, voltage_v, current_a, energy_wh,
        connectivity_status, relay_status,
      } = msg.payload;

      if (event_type === "telemetry_ingested") {
        // Patch state device: hanya field yang hadir di pesan
        setDevice((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            // Menerima telemetri = perangkat pasti hidup → tandai online segera
            // (melengkapi cek kesegaran di backend agar transisi kembali instan).
            status:         "online" as const,
            power:          power_w   ?? prev.power,
            voltage:        voltage_v ?? prev.voltage,
            current:        current_a ?? prev.current,
            // Resolusi energi PZEM = 1 Wh = 0,001 kWh → 3 desimal (samakan
            // dengan adaptDevice; toFixed(2) dulu membuat 2 Wh membulat ke 0
            // sehingga kartu berkedip 2↔0 saat update WS tiba).
            energy:         energy_wh != null
                              ? +(energy_wh / 1000).toFixed(3)
                              : prev.energy,
            lastUpdateText: "Baru saja diperbarui",
          };
        });

      } else if (event_type === "connectivity_status_update") {
        // Update status konektivitas perangkat
        setDevice((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            status: connectivity_status === "ONLINE" ? "online" : "offline",
          };
        });

      } else if (event_type === "relay_status_update") {
        // Status relay aktual berubah (mis. dari auto-control / perintah).
        // Relay OFF → PZEM tak bertenaga, nilai live langsung 0 (energi tetap).
        const on = relay_status === "ON" || relay_status === "RELAY_ON";
        setDevice((prev) =>
          prev
            ? {
                ...prev,
                relayOn: on,
                ...(on ? {} : { power: 0, voltage: 0, current: 0 }),
              }
            : prev,
        );
      }
    });

    wsService.connect();
    return unsub;
  }, [deviceId]);

  // Auto-refresh berkala sebagai JARING PENGAMAN: kalau koneksi WebSocket
  // sempat terputus (jaringan/proxy), data tetap diperbarui sendiri tanpa
  // perlu refresh manual. Saat WS sehat, update tetap instan via WS.
  useEffect(() => {
    if (!deviceId) return;
    const timer = setInterval(() => {
      void fetchDevice({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [deviceId, fetchDevice]);

  return { device, loading, error, refetch: fetchDevice };
}
