/* =============================================================================
 * tariffs.ts — Daftar golongan dan tarif dasar listrik PLN (per kWh)
 *
 * Data bersumber dari tarif penyesuaian PLN 2023.
 * Digunakan di SettingsPage untuk memilih golongan daya pengguna.
 * ========================================================================== */

import type { TariffOption } from "../types";

export const tariffOptions: TariffOption[] = [
  {
    id:          "R1-450",
    label:       "R-1 / 450 VA",
    category:    "Bersubsidi",
    pricePerKwh: 415,
  },
  {
    id:          "R1-900",
    label:       "R-1 / 900 VA",
    category:    "Bersubsidi",
    pricePerKwh: 605,
  },
  {
    id:          "R1-1300",
    label:       "R-1 / 1.300 VA",
    category:    "Non-subsidi",
    pricePerKwh: 1444.7,
    recommended: true,
  },
  {
    id:          "R1-2200",
    label:       "R-1 / 2.200 VA",
    category:    "Non-subsidi",
    pricePerKwh: 1444.7,
  },
  {
    id:          "R1-3500",
    label:       "R-1 / 3.500–5.500 VA",
    category:    "Non-subsidi",
    pricePerKwh: 1699.53,
  },
  {
    id:          "R2-6600",
    label:       "R-2 / 6.600 VA ke atas",
    category:    "Non-subsidi",
    pricePerKwh: 1699.53,
  },
];
