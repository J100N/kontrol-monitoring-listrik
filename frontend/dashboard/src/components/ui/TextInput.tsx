/* =============================================================================
 * TextInput - input + label + hint reusable
 *
 * Layout: label (uppercase kecil) -> input (dark bg by default) -> hint (kecil).
 * Pakai prop `light` untuk varian putih (jarang dipakai di mockup tapi tersedia).
 * ========================================================================== */

import type { InputHTMLAttributes, ReactNode } from "react";

// Omit HTML's `size` (number) supaya kita bisa pakai untuk varian visual sm/md
interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: ReactNode;
  /** Style input putih (default = dark bg) */
  light?: boolean;
  /** Tampil compact (height 36px) untuk filter/search inline */
  size?: "sm" | "md";
}

export function TextInput({
  label,
  hint,
  light,
  size = "md",
  className = "",
  id,
  ...rest
}: TextInputProps) {
  // Generate id otomatis kalau tidak diberikan, supaya label htmlFor tetap valid
  const inputId =
    id || (label ? `field-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

  const inputClasses = [
    "vg-input",
    light ? "vg-input--light" : "",
    size === "sm" ? "vg-input--sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="vg-field">
      {label && (
        <label className="vg-field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input id={inputId} className={inputClasses} {...rest} />
      {hint && <span className="vg-field__hint">{hint}</span>}
    </div>
  );
}
