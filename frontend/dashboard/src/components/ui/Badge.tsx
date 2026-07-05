/* =============================================================================
 * Badge - pill kecil untuk status/label
 *
 * Tone: success (online/aktif), warning, danger (offline), info, neutral,
 * auto (hijau mint untuk mode AUTO), manual (ungu untuk mode MANUAL).
 * `dot` = tampilkan titik kecil di awal (status indicator).
 * ========================================================================== */

import type { ReactNode } from "react";

interface BadgeProps {
  tone?:
    | "success"
    | "warning"
    | "danger"
    | "info"
    | "neutral"
    | "auto"
    | "manual";
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({
  tone = "neutral",
  dot,
  children,
  className = "",
}: BadgeProps) {
  return (
    <span className={`vg-badge vg-badge--${tone} ${className}`.trim()}>
      {dot && <span className="vg-badge__dot" />}
      {children}
    </span>
  );
}
