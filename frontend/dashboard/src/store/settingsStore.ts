/* =============================================================================
 * settingsStore.ts — State global pengaturan sistem (Zustand + persist)
 *
 * Semua section di halaman Settings (tarif, MQTT, kontrol otomatis, notifikasi)
 * membaca & menulis ke store ini. Pola "draft vs saved":
 *
 *   - saved  : nilai yang benar-benar tersimpan (dipersist ke localStorage)
 *   - draft  : nilai yang sedang diedit user (belum disimpan)
 *
 * Tombol "Simpan perubahan" memindahkan draft → saved (lalu dipersist).
 * Tombol "Reset" mengembalikan draft → saved. Tombol Simpan hanya aktif jika
 * ada perbedaan (isDirty), sehingga user tahu persis ada perubahan tertunda.
 * ========================================================================== */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Bentuk lengkap seluruh nilai pengaturan sistem. */
export interface SettingsValues {
  // Tarif & biaya
  tariffId:        string;
  ppj:             string;
  bebanBulanan:    string;
  targetBulanan:   string;
  // Kontrol otomatis (parameter ini di-seed dari & dikirim ke perangkat)
  pirTimeout:      string;
  standbyThreshold:string;
  overCurrent:     string;
  // Notifikasi
  notifyOffline:       boolean;
  notifyMonthlyTarget: boolean;
}

/** Nilai awal (default pabrik) bila belum pernah disimpan. */
export const DEFAULT_SETTINGS: SettingsValues = {
  tariffId:        "R1-1300",
  ppj:             "3",
  bebanBulanan:    "0",
  targetBulanan:   "250000",
  pirTimeout:      "600",
  standbyThreshold:"10",
  overCurrent:     "6",
  notifyOffline:       true,
  notifyMonthlyTarget: true,
};

interface SettingsState {
  saved: SettingsValues;
  draft: SettingsValues;
  /** Ubah satu field di draft. */
  setField: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void;
  /** Apakah draft berbeda dari saved (ada perubahan tertunda). */
  isDirty: () => boolean;
  /** Simpan: draft → saved (dipersist). */
  save: () => void;
  /** Batalkan perubahan: draft → saved. */
  resetDraft: () => void;
  /** Kembalikan ke nilai default pabrik (hanya draft, perlu Simpan). */
  resetToDefault: () => void;
  /**
   * Seed parameter kontrol otomatis (PIR timeout & threshold daya) dari nilai
   * NYATA perangkat (registry backend). Menyetel saved + draft agar form
   * mencerminkan kondisi perangkat tanpa langsung dianggap "ada perubahan".
   * Field yang sudah diedit user (draft ≠ saved) tidak ditimpa.
   */
  seedDeviceParams: (pirTimeoutSec: number, powerThresholdW: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      saved: DEFAULT_SETTINGS,
      draft: DEFAULT_SETTINGS,

      setField: (key, value) =>
        set((s) => ({ draft: { ...s.draft, [key]: value } })),

      isDirty: () => {
        const { saved, draft } = get();
        return (Object.keys(saved) as (keyof SettingsValues)[]).some(
          (k) => saved[k] !== draft[k],
        );
      },

      save: () => set((s) => ({ saved: { ...s.draft } })),

      resetDraft: () => set((s) => ({ draft: { ...s.saved } })),

      resetToDefault: () => set({ draft: { ...DEFAULT_SETTINGS } }),

      seedDeviceParams: (pirTimeoutSec, powerThresholdW) =>
        set((s) => {
          const pir = String(Math.round(pirTimeoutSec));
          const thr = String(powerThresholdW);
          // Jangan timpa field yang sedang diedit user.
          const pirUnedited = s.draft.pirTimeout === s.saved.pirTimeout;
          const thrUnedited = s.draft.standbyThreshold === s.saved.standbyThreshold;
          return {
            saved: { ...s.saved, pirTimeout: pir, standbyThreshold: thr },
            draft: {
              ...s.draft,
              pirTimeout:       pirUnedited ? pir : s.draft.pirTimeout,
              standbyThreshold: thrUnedited ? thr : s.draft.standbyThreshold,
            },
          };
        }),
    }),
    {
      name: "voltguard.settings",
      // Hanya `saved` yang dipersist; draft selalu disinkron dari saved saat load.
      partialize: (s) => ({ saved: s.saved }),
      onRehydrateStorage: () => (state) => {
        if (state) state.draft = { ...state.saved };
      },
    },
  ),
);
