/* =============================================================================
 * App - root component & routing tree
 *
 * Routes:
 *   /login                  → LoginPage (tanpa shell)
 *   /dashboard              → DeviceDetailPage socket utama (sistem 1 socket)
 *   /settings               → SettingsPage
 *   /security               → redirect ke /dashboard (menu dihapus)
 *   /devices, /devices/:id  → redirect ke /dashboard (sistem 1 socket)
 *   /                       → redirect ke /dashboard atau /login
 *
 * AuthGuard: kalau user belum login, semua route dilindungi diarahkan ke /login.
 * Sebaliknya, kalau sudah login dan akses /login, diarahkan ke /dashboard.
 * ========================================================================== */

import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { DeviceDetailPage } from "./pages/DeviceDetailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useAuthStore } from "./store/authStore";

// Sistem 1 socket: tampilan utama (Dashboard) langsung menampilkan detail socket ini.
const MAIN_DEVICE_ID = "smart_socket";

/**
 * AuthGuard - redirect ke /login kalau belum auth.
 * Pakai komponen wrapper supaya gampang di-extend (mis. role-based access).
 */
function ProtectedRoute({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <AppShell>{children}</AppShell>;
}

/** Saat sudah login, /login me-redirect ke dashboard supaya tidak terjebak */
function GuestRoute({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestRoute>
            <LoginPage />
          </GuestRoute>
        }
      />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DeviceDetailPage deviceId={MAIN_DEVICE_ID} />
          </ProtectedRoute>
        }
      />

      {/* Menu Devices dihapus (sistem 1 socket). Semua /devices* → dashboard. */}
      <Route path="/devices" element={<Navigate to="/dashboard" replace />} />
      <Route path="/devices/:id" element={<Navigate to="/dashboard" replace />} />

      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />

      {/* Menu Security dihapus. /security → dashboard. */}
      <Route path="/security" element={<Navigate to="/dashboard" replace />} />

      {/* Default & 404 fallback - redirect ke dashboard (yang akan re-route ke
          login kalau belum auth). Ini supaya URL aneh tidak crash app. */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
