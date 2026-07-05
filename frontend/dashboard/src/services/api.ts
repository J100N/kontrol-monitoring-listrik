/* =============================================================================
 * api.ts — Instance Axios tunggal untuk seluruh pemanggilan REST API
 *
 * Kenapa baseURL kosong ("")?
 *   Supaya path relatif (/api/...) bekerja di dua lingkungan:
 *   - Development : Vite proxy meneruskan /api/* ke http://localhost:8080
 *   - Production  : Nginx meneruskan /api/* ke container api:8080
 *
 * Interceptor request : menambahkan header "Authorization: Bearer <token>"
 *   secara otomatis dari token yang disimpan di localStorage.
 *
 * Interceptor response: normalisasi pesan error menjadi string Indonesia.
 *   Jika server mengembalikan 401 (token kadaluarsa), paksa logout dan
 *   arahkan kembali ke halaman login.
 * ========================================================================== */

import axios from "axios";

// Buat instance Axios dengan konfigurasi dasar
export const api = axios.create({
  baseURL: "",        // Gunakan path relatif agar kompatibel dengan proxy
  timeout: 12_000,    // Batas waktu 12 detik sebelum request dianggap gagal
  headers: { "Content-Type": "application/json" },
});

// ── Interceptor request — sisipkan JWT ke setiap request ─────────────────────
api.interceptors.request.use((config) => {
  try {
    // Ambil token dari localStorage (disimpan oleh Zustand persist)
    // Format storage: { state: { token: "...", user: {...}, isAuthenticated: true } }
    const raw   = localStorage.getItem("voltguard-auth");
    const store = raw ? JSON.parse(raw) : null;
    const token = store?.state?.token as string | undefined;

    // Tambahkan header Authorization jika token tersedia
    if (token) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
  } catch {
    // localStorage tidak tersedia atau data JSON rusak — lanjut tanpa token
  }
  return config;
});

// ── Interceptor response — tangani error dan redirect 401 ────────────────────
api.interceptors.response.use(
  // Response sukses: teruskan langsung tanpa modifikasi
  (res) => res,

  (err) => {
    // Jika server menolak token (kadaluarsa atau tidak valid),
    // hapus data login dari localStorage dan arahkan ke halaman login
    if (err?.response?.status === 401) {
      try {
        localStorage.removeItem("voltguard-auth");
      } catch { /* abaikan jika localStorage tidak tersedia */ }
      window.location.href = "/login";
      return Promise.reject(new Error("Sesi kadaluarsa, silakan login kembali"));
    }

    // Normalisasi pesan error: ambil dari response server, fallback ke pesan network
    const msg: string =
      err?.response?.data?.error ??
      err?.message ??
      "Terjadi kesalahan jaringan";
    return Promise.reject(new Error(msg));
  },
);
