/* =============================================================================
 * deviceStore.ts — State global daftar device (Zustand)
 *
 * Diisi pertama kali oleh useDevices hook (fetch REST API).
 * Diperbarui secara inkremental setiap kali ada pesan WebSocket masuk
 * (telemetri baru atau perubahan status konektivitas).
 *
 * Komponen yang perlu data device cukup subscribe:
 *   const devices = useDeviceStore((s) => s.devices);
 * tanpa perlu mount hook fetch berulang di setiap komponen.
 * ========================================================================== */

import { create } from "zustand";
import type { SmartDevice } from "../types";

// Definisi lengkap state dan aksi yang tersedia di store ini
interface DeviceState {
  devices:      SmartDevice[];  // Daftar semua device yang terdaftar
  wsConnected:  boolean;        // Status koneksi WebSocket (untuk indikator UI)

  /** Ganti seluruh daftar device (dipanggil saat fetch awal berhasil) */
  setDevices:     (devices: SmartDevice[]) => void;

  /** Patch parsial satu device berdasarkan ID — hanya field yang diberikan yang diubah */
  updateDevice:   (id: string, patch: Partial<SmartDevice>) => void;

  /** Update status koneksi WebSocket (dipanggil oleh ws.ts) */
  setWsConnected: (connected: boolean) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  // ── State awal ────────────────────────────────────────────────────────────
  devices:     [],
  wsConnected: false,

  // Ganti seluruh array device (saat fetch pertama atau refresh)
  setDevices: (devices) => set({ devices }),

  // Patch parsial: map array dan hanya ubah device yang ID-nya cocok
  // Contoh: updateDevice("smart_socket", { power: 120, lastUpdateText: "..." })
  updateDevice: (id, patch) =>
    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === id ? { ...d, ...patch } : d,
      ),
    })),

  setWsConnected: (wsConnected) => set({ wsConnected }),
}));
