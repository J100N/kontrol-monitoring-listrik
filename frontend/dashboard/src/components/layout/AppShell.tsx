/* =============================================================================
 * AppShell - wrapper untuk halaman yang butuh TopNav
 *
 * Login page TIDAK pakai shell ini (full screen unik). Semua halaman
 * authenticated memakai shell ini supaya nav konsisten.
 *
 * Notifikasi browser dipasang di sini (bukan di DashboardPage) agar aktif
 * di semua halaman selama user sudah login — termasuk Devices dan Security.
 * thresholdMap dibangun dari field `threshold` tiap device (default 2000 W).
 * ========================================================================== */

import type { ReactNode } from "react";
import { useMemo } from "react";
import { TopNav } from "./TopNav";
import { useNotifications } from "../../hooks/useNotifications";
import { useDeviceStore }   from "../../store/deviceStore";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const devices = useDeviceStore((s) => s.devices);

  // Bangun { device_id: thresholdWatt } dari data device yang sudah di-fetch.
  // Fallback 2000 W jika device belum punya threshold yang dikonfigurasi.
  const thresholdMap = useMemo(
    () =>
      Object.fromEntries(
        devices.map((d) => [d.id, d.threshold ?? 2000]),
      ),
    [devices],
  );

  // Hook notifikasi dipasang di level shell agar aktif di semua halaman login.
  // Akan otomatis unsubscribe saat AppShell unmount (user logout).
  useNotifications({ enabled: true, thresholdMap });

  return (
    <div className="vg-shell">
      <TopNav />
      <main className="vg-shell__main">
        <div className="vg-shell__container">{children}</div>
      </main>
    </div>
  );
}
