/* =============================================================================
 * usePatchDevice — Perbarui konfigurasi device
 *
 * Dua operasi berbeda:
 *
 * patchDevice — update metadata dan parameter perangkat
 *   PATCH /api/devices/:id
 *   Body : { label?, room?, power_threshold_w?, pir_timeout_sec? }
 *   Setelah berhasil: Zustand store di-patch parsial agar UI langsung sinkron
 *
 * setMode — ganti mode operasi antara manual dan otomatis
 *   POST /api/devices/:id/mode
 *   Body : { mode: "manual" | "auto" }
 *   Backend meneruskan perubahan mode ke ESP32 via MQTT
 * ========================================================================== */

import { useCallback, useState } from "react";
import { api }            from "../services/api";
import { adaptDevice }    from "../lib/adapters";
import { useDeviceStore } from "../store/deviceStore";
import type { ApiDevice } from "../types";

// Field yang bisa diperbarui via PATCH /api/devices/:id
interface PatchPayload {
  label?:             string;
  room?:              string;
  power_threshold_w?: number;
  pir_timeout_sec?:   number;
}

export function usePatchDevice() {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const { updateDevice }      = useDeviceStore();

  /**
   * patchDevice — perbarui label, ruangan, threshold, atau timeout PIR.
   * @returns true jika berhasil, false jika gagal
   */
  const patchDevice = useCallback(
    async (deviceId: string, payload: PatchPayload): Promise<boolean> => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.patch<{ ok: boolean; device: ApiDevice }>(
          `/api/devices/${deviceId}`,
          payload,
        );

        // Konversi respons backend dan sinkronkan ke store lokal
        const patched = adaptDevice(res.data.device);
        updateDevice(deviceId, patched);
        return true;
      } catch (err) {
        setError((err as Error).message ?? "Gagal memperbarui device");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [updateDevice],
  );

  /**
   * setMode — ganti mode operasi device.
   * Backend memvalidasi dan meneruskan perubahan ke firmware via MQTT.
   *
   * @param mode - "manual" (kendali pengguna) atau "auto" (sensor PIR)
   * @returns true jika berhasil
   */
  const setMode = useCallback(
    async (deviceId: string, mode: "manual" | "auto"): Promise<boolean> => {
      setLoading(true);
      setError(null);
      try {
        await api.post(`/api/devices/${deviceId}/mode`, { mode });

        // Update store lokal langsung tanpa menunggu event WS
        updateDevice(deviceId, {
          mode: mode === "auto" ? "AUTO" : "MANUAL",
        });
        return true;
      } catch (err) {
        setError((err as Error).message ?? "Gagal mengubah mode device");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [updateDevice],
  );

  /**
   * sendConfig — kirim parameter kontrol otomatis ke ESP32.
   *   POST /api/devices/:id/config  { pir_timeout_sec, power_threshold_w }
   * Backend menyimpan ke registry + meneruskan command config_update terenkripsi
   * ke firmware, yang menerapkannya runtime & menyimpannya ke NVS.
   *
   * @returns true jika berhasil dikirim (HTTP 202)
   */
  const sendConfig = useCallback(
    async (
      deviceId: string,
      params: { pir_timeout_sec: number; power_threshold_w: number },
    ): Promise<boolean> => {
      setLoading(true);
      setError(null);
      try {
        await api.post(`/api/devices/${deviceId}/config`, params);
        updateDevice(deviceId, {
          pirTimeout: params.pir_timeout_sec,
          threshold: params.power_threshold_w,
        });
        return true;
      } catch (err) {
        setError((err as Error).message ?? "Gagal mengirim konfigurasi ke device");
        return false;
      } finally {
        setLoading(false);
      }
    },
    [updateDevice],
  );

  return { patchDevice, setMode, sendConfig, loading, error };
}
