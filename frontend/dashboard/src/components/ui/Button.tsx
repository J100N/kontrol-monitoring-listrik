/* =============================================================================
 * Button - tombol reusable
 *
 * Variant: primary (biru gradient), secondary (outline), ghost (no bg),
 * danger (merah). Size: sm (32px), md (40px), lg (48px).
 * ========================================================================== */

import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** Render full-width (mengisi 100% lebar parent) */
  block?: boolean;
  /** Icon di kiri label (komponen SVG) */
  iconLeft?: ReactNode;
  /** Icon di kanan label */
  iconRight?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  block,
  iconLeft,
  iconRight,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    "vg-btn",
    `vg-btn--${variant}`,
    `vg-btn--${size}`,
    block ? "vg-btn--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} {...rest}>
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
