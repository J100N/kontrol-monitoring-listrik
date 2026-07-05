/* =============================================================================
 * SegmentedControl - pill tab selector
 *
 * Dipakai untuk pilih periode (Hari/Minggu/Bulan/Tahun) dan filter audit log.
 * Bersifat controlled: parent yang manage state value.
 * ========================================================================== */

interface SegmentedControlProps<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  /** Variant warna aktif: dark (default, bg slate-900) atau brand (bg biru muda) */
  variant?: "dark" | "brand";
  /** Aria label untuk a11y */
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = "dark",
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={`vg-segmented ${variant === "brand" ? "vg-segmented--brand" : ""}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            role="tab"
            aria-selected={active}
            className={`vg-segmented__btn ${
              active ? "vg-segmented__btn--active" : ""
            }`.trim()}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
