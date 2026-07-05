/* =============================================================================
 * Card - container putih reusable
 *
 * Digunakan sebagai wadah utama untuk semua section dashboard. Variant:
 * - default: white card dengan padding
 * - dark: gradient biru (untuk hero card cost)
 * - flush: tanpa padding (kalau children punya layout sendiri)
 * - interactive: hover effect (cursor pointer + shadow naik)
 * ========================================================================== */

import type { HTMLAttributes, ReactNode } from "react";

// Omit HTML's `title` (string | undefined) supaya kita bisa terima ReactNode
interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  variant?: "default" | "dark";
  flush?: boolean;
  interactive?: boolean;
  /** Header opsional di atas children. Pakai jika butuh title + action button. */
  title?: ReactNode;
  subtitle?: ReactNode;
  headerRight?: ReactNode;
}

export function Card({
  variant = "default",
  flush,
  interactive,
  title,
  subtitle,
  headerRight,
  className = "",
  children,
  ...rest
}: CardProps) {
  // Compose className manual supaya bisa override dari luar via prop className
  const classes = [
    "vg-card",
    variant === "dark" ? "vg-card--dark" : "",
    flush ? "vg-card--flush" : "",
    interactive ? "vg-card--interactive" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {(title || headerRight) && (
        <div className="vg-card__header">
          <div>
            {title && <div className="vg-card__title">{title}</div>}
            {subtitle && <div className="vg-card__subtitle">{subtitle}</div>}
          </div>
          {headerRight && <div>{headerRight}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
