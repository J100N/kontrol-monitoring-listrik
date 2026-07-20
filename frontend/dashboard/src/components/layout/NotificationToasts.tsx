/* =============================================================================
 * NotificationToasts — toast notifikasi in-app di TENGAH-ATAS dashboard.
 *
 * Dipakai AppShell untuk menampilkan notifikasi (perangkat offline / biaya
 * melewati target) LANGSUNG di halaman — tidak bergantung izin notifikasi OS
 * maupun Focus Assist Windows, sehingga pasti terlihat.
 *
 * Penempatan: fixed tepat di bawah navbar (offset memakai var --topnav-height agar
 * otomatis menyesuaikan bila tinggi navbar berubah) dan di tengah horizontal —
 * area yang paling sering dilihat pengguna. Toast MENETAP sampai tombol silang
 * ditekan, tidak hilang sendiri. Gaya inline agar self-contained (tak menyentuh
 * CSS global).
 * ========================================================================== */

import type { AppToast, ToastKind } from "../../hooks/useNotifications";

interface NotificationToastsProps {
  toasts: AppToast[];
  onDismiss: (id: number) => void;
}

// Warna aksen per jenis notifikasi.
const ACCENT: Record<ToastKind, string> = {
  offline: "#ef4444", // merah — perangkat terputus
  target: "#f59e0b", // amber — target konsumsi tercapai
};

export function NotificationToasts({ toasts, onDismiss }: NotificationToastsProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: "calc(var(--topnav-height) + 16px)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: "min(520px, calc(100vw - 32px))",
        // Toast menetap sampai ditutup manual; hook sudah men-dedup per kondisi
        // (jenis+device) sehingga jumlahnya terbatas. Ini jaring pengaman kalau
        // perangkat bertambah: kolom tidak boleh melewati layar sampai tombol
        // silangnya tak terjangkau.
        maxHeight: "calc(100vh - var(--topnav-height) - 32px)",
        overflowY: "auto",
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            background: "#ffffff",
            color: "#0f172a",
            borderLeft: `4px solid ${ACCENT[t.kind] ?? "#3b82f6"}`,
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
            padding: "12px 14px",
            animation: "vgToastIn 180ms ease-out",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{t.title}</div>
            <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.4 }}>{t.body}</div>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Tutup notifikasi"
            title="Tutup notifikasi"
            style={{
              flexShrink: 0,
              border: "none",
              background: "transparent",
              color: "#64748b",
              fontSize: 20,
              lineHeight: 1,
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: 6,
            }}
          >
            ×
          </button>
        </div>
      ))}
      <style>{`@keyframes vgToastIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
