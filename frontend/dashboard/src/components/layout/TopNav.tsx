/* =============================================================================
 * TopNav - top navigation bar
 *
 * Berisi: Logo (kiri) + Nav links (tengah) + User badge (kanan).
 * Aktif/tidaknya nav link otomatis dari URL via useLocation react-router.
 * ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { Logo } from "./Logo";

/** Daftar menu navigasi - urut sesuai mockup */
const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/settings", label: "Settings" },
];

export function TopNav() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  // Dropdown profil: klik admin -> buka popup kecil berisi tombol Logout.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Jam live di header — diperbarui tiap detik.
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Tutup dropdown saat klik di luar area.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    setMenuOpen(false);
    logout();
    navigate("/login");
  };

  // Generate inisial untuk avatar (max 2 huruf) - fallback "AD"
  const initials = (user?.displayName || "Admin")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="vg-topnav">
      <div className="vg-topnav__inner">
        <Logo size="md" showTagline />

        <nav className="vg-topnav__nav" aria-label="Navigasi utama">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `vg-topnav__link ${isActive ? "vg-topnav__link--active" : ""}`.trim()
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Jam live di antara menu dan profil admin */}
        <div className="vg-topnav__clock" aria-label="Waktu sekarang">
          <span className="vg-topnav__clock-time">
            {now.toLocaleTimeString("id-ID", {
              hour: "2-digit", minute: "2-digit", second: "2-digit",
            })}
          </span>
          <span className="vg-topnav__clock-date">
            {now.toLocaleDateString("id-ID", {
              weekday: "short", day: "2-digit", month: "short", year: "numeric",
            })}
          </span>
        </div>

        <div className="vg-topnav__user-wrap" ref={menuRef}>
          <button
            className="vg-topnav__user"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Klik untuk menu akun"
          >
            <span className="vg-topnav__avatar">{initials}</span>
            <span className="vg-topnav__userinfo">
              <span className="vg-topnav__username">
                {user?.displayName || "Admin Rumah"}
              </span>
              <span className="vg-topnav__role">{user?.role || "Pemilik"}</span>
            </span>
          </button>

          {menuOpen && (
            <div className="vg-topnav__menu" role="menu">
              <button
                className="vg-topnav__menu-item"
                onClick={handleLogout}
                role="menuitem"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
