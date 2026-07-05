/* =============================================================================
 * ToggleSwitch - sliding toggle accessible
 *
 * Implementasi pakai checkbox tersembunyi supaya keyboard & screen reader
 * tetap berfungsi. Visualisasi diatur oleh CSS sibling-selector di primitives.
 * ========================================================================== */

import type { ChangeEvent } from "react";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Label aksesibilitas (wajib jika tidak ada visible label di sekitar) */
  ariaLabel?: string;
  disabled?: boolean;
}

export function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
  disabled,
}: ToggleSwitchProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.checked);
  };

  return (
    <label className="vg-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      <span className="vg-toggle__track" />
      <span className="vg-toggle__thumb" />
    </label>
  );
}
