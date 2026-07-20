/* =============================================================================
 * useDevices — Ambil daftar semua device + update real-time via WebSocket
 *
 * Alur data:
 *   1. Saat pertama mount: GET /api/devices → adaptDevice → simpan ke deviceStore
 *   2. WebSocket aktif: setiap pesan dari realtime_gateway di-patch ke store
 *      - event_type "telemetry_ingested"        → update daya/tegangan/arus/energi
 *      - event_type "connectivity_status_update" → update status online/offline
 *
 * Mengapa pakai Zustand store (bukan state lokal)?
 *   Agar semua komponen (Dashboard, Devices, Security) berbagi data yang sama
 *   tanpa fetch ulang — cukup subscribe ke useDeviceStore.
 * ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { api }             from "../services/api";
import { wsService }       from "../services/ws";
import { adaptDevice }     from "../lib/adapters";
import { useDeviceStore }  from "../store/deviceStore";
import type { ApiDevice, WsMessage } from "../types";

// Interval auto-refresh latar belakang (jaring pengaman bila WebSocket putus).
const REFRESH_INTERVAL_MS = 10_000;

export function useDevices() {
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState<string | null>(null);

  // Tanpa selector = berlangganan SELURUH store, jadi pemanggil hook ini ikut
  // re-render tiap kali store berubah (mis. tiap telemetri masuk). Disengaja:
  // hook ini memang mengembalikan `devices`. Pemakai yang hanya butuh sebagian
  // sebaiknya subscribe langsung dgn selector, mis. useDeviceStore((s) => s.devices).
  const { devices, setDevices, updateDevice } = useDeviceStore();

  // Guard agar tidak fetch dua kali di React StrictMode (double-invoke useEffect)
  const fetchedRef = useRef(false);

  /**
   * Ambil semua device dari REST API lalu simpan ke Zustand store.
   * opts.silent = true → refresh latar belakang (tanpa spinner/menimpa error).
   */
  const fetchDevices = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await api.get<{ ok: boolean; devices: ApiDevice[] }>("/api/devices");
        // Konversi format API (snake_case) ke format UI (camelCase) via adapter
        setDevices(res.data.devices.map(adaptDevice));
      } catch (err) {
        if (!opts?.silent) {
          setError((err as Error).message ?? "Gagal memuat data device");
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [setDevices],
  );

  // Fetch sekali saat komponen pertama mount
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchDevices();
  }, [fetchDevices]);

  // Berlangganan pesan WebSocket untuk update realtime
  useEffect(() => {
    const unsub = wsService.subscribe((msg: WsMessage) => {
      const {
        event_type, device_id,
        power_w, voltage_v, current_a, energy_wh,
        connectivity_status, relay_status,
      } = msg.payload;

      // Abaikan pesan tanpa device_id (pesan sistem)
      if (!device_id) return;

      if (event_type === "telemetry_ingested") {
        // Patch parsial: hanya update field yang ada di pesan
        const patch: Record<string, unknown> = {};
        if (power_w   != null) patch.power   = power_w;
        if (voltage_v != null) patch.voltage = voltage_v;
        if (current_a != null) patch.current = current_a;
        // Konversi Wh → kWh, 3 desimal (resolusi PZEM 1 Wh); konsisten dgn adapter
        if (energy_wh != null) patch.energy  = +(energy_wh / 1000).toFixed(3);
        // Menerima telemetri = perangkat pasti hidup → tandai online segera, sama
        // seperti useDevice.ts. Tanpa ini status tertinggal "offline" sampai refetch
        // 10 dtk berikutnya: badge jadi bertentangan (kartu OFFLINE tapi daya live
        // berubah), dan useNotifications mengira perangkat masih mati lalu memunculkan
        // toast offline baru setiap pesan telemetri masuk.
        patch.status = "online";
        patch.lastUpdateText = "Baru saja diperbarui";
        updateDevice(device_id, patch);

      } else if (event_type === "connectivity_status_update") {
        // Update status koneksi perangkat
        updateDevice(device_id, {
          status: connectivity_status === "ONLINE" ? "online" : "offline",
          lastUpdateText:
            connectivity_status === "ONLINE" ? "Baru saja online" : "Tidak terhubung",
        });

      } else if (event_type === "relay_status_update") {
        // Status relay aktual berubah (auto-control / perintah manual)
        const isOn = relay_status === "ON" || relay_status === "RELAY_ON";
        // Relay OFF → PZEM tak bertenaga (sisi beban), nilai live langsung 0.
        // Energi tidak di-reset karena bersifat kumulatif.
        updateDevice(device_id, {
          relayOn: isOn,
          ...(isOn ? {} : { power: 0, voltage: 0, current: 0 }),
        });
      }
    });

    // Pastikan koneksi WS aktif
    wsService.connect();

    // Cleanup: batalkan subscribe saat komponen di-unmount
    return unsub;
  }, [updateDevice]);

  // Auto-refresh berkala sebagai JARING PENGAMAN: bila WebSocket terputus,
  // data tetap diperbarui sendiri tanpa perlu refresh manual.
  useEffect(() => {
    const timer = setInterval(() => {
      void fetchDevices({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchDevices]);

  return { devices, loading, error, refetch: fetchDevices };
}
