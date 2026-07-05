/* =============================================================================
 * authStore.ts — State global autentikasi (Zustand)
 *
 * Tanggung jawab:
 *   - Menyimpan status login pengguna (token JWT + info user)
 *   - Memanggil POST /api/auth/login saat pengguna klik "Masuk"
 *   - Mempersist data login ke localStorage agar refresh browser tidak logout
 *   - Menyediakan fungsi logout untuk menghapus semua data sesi
 *
 * Alur login:
 *   1. Pengguna isi form → panggil login(username, password)
 *   2. Store kirim request ke /api/auth/login
 *   3. Backend verifikasi → kembalikan { token, user }
 *   4. Token disimpan di state + localStorage
 *   5. Axios interceptor di api.ts membaca token ini untuk setiap request berikutnya
 *
 * Cara mengubah username/password:
 *   Edit ADMIN_USERNAME dan ADMIN_PASSWORD di file:
 *   - backend/api/.env               (untuk development lokal)
 *   - infra/digitalocean/api.env     (untuk server production)
 * ========================================================================== */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import axios from "axios";

// Tipe data informasi pengguna yang tersimpan setelah login
interface User {
  username:    string;
  displayName: string;
  role:        string;
}

// Definisi lengkap state dan aksi yang tersedia di store ini
interface AuthState {
  user:            User | null;
  token:           string | null;    // JWT yang dipakai untuk Authorization header
  isAuthenticated: boolean;          // Shortcut: true jika token ada dan valid
  login:           (username: string, password: string) => Promise<void>;
  logout:          () => void;
}

export const useAuthStore = create<AuthState>()(
  // persist: simpan state ke localStorage secara otomatis
  persist(
    (set) => ({
      // ── State awal ────────────────────────────────────────────────────
      user:            null,
      token:           null,
      isAuthenticated: false,

      /**
       * login — kirim kredensial ke backend dan simpan token jika berhasil.
       * Melempar Error jika input kosong atau server menolak kredensial.
       */
      login: async (username, password) => {
        // Validasi dasar di sisi klien sebelum kirim request
        if (!username || !password) {
          throw new Error("Username dan password wajib diisi");
        }

        // Kirim request ke endpoint login backend
        // Menggunakan axios langsung (bukan instance api.ts) agar tidak ada
        // sirkular dependency dengan interceptor 401 di api.ts
        const res = await axios.post<{
          ok:    boolean;
          token: string;
          user:  User;
        }>("/api/auth/login", { username, password });

        if (!res.data.ok) {
          throw new Error("Login gagal");
        }

        // Simpan token dan info pengguna ke state (otomatis persist ke localStorage)
        set({
          user:            res.data.user,
          token:           res.data.token,
          isAuthenticated: true,
        });
      },

      /**
       * logout — hapus semua data sesi dan kembalikan state ke awal.
       * localStorage juga dibersihkan oleh Zustand persist secara otomatis.
       */
      logout: () => {
        set({ user: null, token: null, isAuthenticated: false });
      },
    }),

    {
      name: "voltguard-auth", // Kunci di localStorage

      // Hanya simpan data, bukan fungsi (fungsi tidak bisa di-serialize ke JSON)
      partialize: (s) => ({
        user:            s.user,
        token:           s.token,
        isAuthenticated: s.isAuthenticated,
      }),
    },
  ),
);
