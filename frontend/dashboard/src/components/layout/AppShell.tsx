/* =============================================================================
 * AppShell - wrapper untuk halaman yang butuh TopNav
 *
 * Login page TIDAK pakai shell ini (full screen unik). Semua halaman
 * authenticated memakai shell ini supaya nav konsisten.
 *
 * Notifikasi browser dipasang di sini (bukan di DashboardPage) agar aktif
 * di semua halaman selama user sudah login. Hook membaca sendiri toggle &
 * tarif dari settingsStore, jadi cukup dipanggil tanpa argumen.
 * ========================================================================== */

import type { ReactNode } from "react";
import { TopNav } from "./TopNav";
import { NotificationToasts } from "./NotificationToasts";
import { useDevices } from "../../hooks/useDevices";
import { useNotifications } from "../../hooks/useNotifications";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  // Mengisi deviceStore (GET /api/devices + patch WebSocket + refresh 10 dtk).
  // WAJIB ada di sini: useNotifications membaca daftar perangkat dari store itu untuk
  // mendeteksi perangkat yang SUDAH offline sebelum dashboard dibuka. Sebelumnya hook
  // ini tidak di-mount di komponen mana pun sehingga store selalu kosong dan notifikasi
  // offline tidak pernah muncul. Dipasang di shell agar terisi di semua halaman login.
  useDevices();

  // Hook notifikasi dipasang di level shell agar aktif di semua halaman login.
  // Akan otomatis unsubscribe saat AppShell unmount (user logout).
  const { toasts, dismissToast } = useNotifications();

  return (
    <div className="vg-shell">
      <TopNav />
      <main className="vg-shell__main">
        <div className="vg-shell__container">{children}</div>
      </main>
      <NotificationToasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
