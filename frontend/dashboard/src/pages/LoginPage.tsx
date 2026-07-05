/* =============================================================================
 * LoginPage - halaman masuk VoltGuard
 *
 * Layout split-screen:
 *   - Kiri (navy gelap): branding + value proposition + 3 bullet fitur kunci
 *   - Kanan (putih): form login + footer encryption badge
 *
 * Demo: form menerima username/password apapun (lihat authStore.login).
 * ========================================================================== */

import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { TextInput } from "../components/ui/TextInput";
import { Logo } from "../components/layout/Logo";
import { LockIcon } from "../components/icons";
import { useAuthStore } from "../store/authStore";
import "./login.css";

/** Ikon mata untuk tombol show/hide password */
function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

/** Daftar value proposition di panel kiri */
const FEATURES = [
  "Enkripsi end-to-end ASCON-128",
  "Monitoring real-time per smart socket",
  "Kontrol manual & otomatis",
];

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  // State form lokal - tidak dimasukkan ke global store karena hanya transient
  const [username,    setUsername]    = useState("");
  const [password,    setPassword]    = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate("/dashboard");
    } catch (err) {
      // Tampilkan pesan error dari authStore (atau fallback generik)
      const message =
        err instanceof Error ? err.message : "Login gagal. Coba lagi.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="vg-login">
      {/* ============================================================
       * Panel kiri: branding + tagline + bullet
       * ========================================================= */}
      <aside className="vg-login__hero" aria-hidden="false">
        {/* Lingkaran dekoratif (pure CSS) supaya tidak ribet asset */}
        <div className="vg-login__deco vg-login__deco--1" />
        <div className="vg-login__deco vg-login__deco--2" />
        <div className="vg-login__deco vg-login__deco--3" />

        <div className="vg-login__hero-top">
          <Logo size="lg" showTagline inverted />
        </div>

        <div className="vg-login__hero-content">
          <h1 className="vg-login__headline">
            Pantau dan amankan konsumsi listrik rumah Anda
          </h1>
          <p className="vg-login__subline">
            Sistem IoT terenkripsi ASCON-128 untuk monitoring real-time setiap
            smart socket di rumah Anda.
          </p>
        </div>

        <ul className="vg-login__features">
          {FEATURES.map((f) => (
            <li key={f} className="vg-login__feature">
              <span className="vg-login__bullet" />
              {f}
            </li>
          ))}
        </ul>
      </aside>

      {/* ============================================================
       * Panel kanan: form login
       * ========================================================= */}
      <section className="vg-login__form-wrap">
        <div className="vg-login__form">
          <header className="vg-login__form-header">
            <h2 className="vg-login__welcome">Selamat datang kembali</h2>
            <p className="vg-login__welcome-sub">
              Masuk untuk mengakses dashboard energi Anda
            </p>
          </header>

          <form onSubmit={handleSubmit} className="vg-login__fields" noValidate>
            <TextInput
              label="Username"
              type="text"
              value={username}
              autoComplete="off"
              placeholder="Masukkan username"
              onChange={(e) => setUsername(e.target.value)}
              required
            />

            {/* Password field dengan tombol show/hide di kanan */}
            <div className="vg-login__password-wrap">
              <TextInput
                label="Password"
                type={showPassword ? "text" : "password"}
                value={password}
                autoComplete="current-password"
                placeholder="••••••••••••"
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="vg-login__eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>

            <div className="vg-login__row">
              <span />
              <a href="#forgot" className="vg-login__forgot">
                Lupa password?
              </a>
            </div>

            {error && <div className="vg-login__error">{error}</div>}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              disabled={submitting}
            >
              {submitting ? "Memproses..." : "Masuk ke dashboard"}
            </Button>
          </form>

          <footer className="vg-login__footer">
            <LockIcon size={14} />
            <span>Terlindungi enkripsi ASCON-128</span>
          </footer>
        </div>
      </section>
    </div>
  );
}
