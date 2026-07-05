/* =============================================================================
 * Logo - VoltGuard brand mark
 *
 * Render logo (icon rumah + petir) bersama nama brand. Bisa dipakai di:
 * - Login page (size lg)
 * - TopNav (size md)
 * - Footer (size sm)
 * ========================================================================== */

interface LogoProps {
  size?: "sm" | "md" | "lg";
  /** Tampilkan tagline kecil di bawah brand name (untuk login hero) */
  showTagline?: boolean;
  /** Force warna teks - default mengikuti context parent */
  inverted?: boolean;
}

const SIZE_MAP = {
  sm: { box: 28, font: 16 },
  md: { box: 36, font: 18 },
  lg: { box: 44, font: 22 },
};

export function Logo({ size = "md", showTagline, inverted }: LogoProps) {
  const dim = SIZE_MAP[size];
  return (
    <div
      className="vg-logo"
      style={{ color: inverted ? "#ffffff" : "var(--text-strong)" }}
    >
      {/* Icon: rounded square biru dengan rumah putih + petir kuning di tengah */}
      <span
        className="vg-logo__mark"
        style={{ width: dim.box, height: dim.box }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 32 32" width={dim.box} height={dim.box}>
          <rect width="32" height="32" rx="9" fill="#1f7ad6" />
          <path
            d="M16 6l8 7v10a2 2 0 0 1-2 2h-4v-7h-4v7h-4a2 2 0 0 1-2-2V13z"
            fill="#ffffff"
          />
          <path
            d="M16.5 12l-3 5h2.2l-1 4 3.3-5.5h-2.2z"
            fill="#f5b41c"
          />
        </svg>
      </span>
      <span className="vg-logo__text" style={{ fontSize: dim.font }}>
        <span className="vg-logo__name">VoltGuard</span>
        {showTagline && (
          <span className="vg-logo__tagline">SECURE IoT ENERGY</span>
        )}
      </span>
    </div>
  );
}
