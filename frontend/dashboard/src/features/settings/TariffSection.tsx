/* =============================================================================
 * TariffSection - konfigurasi golongan tarif PLN + biaya tambahan
 *
 * UX: 4 kartu pilihan tarif (radio-style) di atas, lalu 3 input numerik
 * (PPJ%, biaya beban, target bulanan). Semua nilai disimpan di settingsStore.
 * ========================================================================== */

import { Card } from "../../components/ui/Card";
import { TextInput } from "../../components/ui/TextInput";
import { Badge } from "../../components/ui/Badge";
import { BoltIcon } from "../../components/icons";
import { useSettingsStore } from "../../store/settingsStore";
import type { TariffOption } from "../../types";

interface TariffSectionProps {
  options: TariffOption[];
}

export function TariffSection({ options }: TariffSectionProps) {
  const draft = useSettingsStore((s) => s.draft);
  const setField = useSettingsStore((s) => s.setField);

  return (
    <Card
      title="Tarif & perhitungan biaya"
      subtitle="Konfigurasi golongan PLN dan parameter konversi kWh ke rupiah"
      headerRight={
        <div className="vg-section__icon vg-section__icon--yellow">
          <BoltIcon size={18} />
        </div>
      }
    >
      <div className="vg-field">
        <span className="vg-field__label">Golongan Tarif PLN</span>
        <div className="vg-tariff__grid">
          {options.map((opt) => {
            const active = opt.id === draft.tariffId;
            return (
              <button
                key={opt.id}
                type="button"
                className={`vg-tariff__card ${
                  active ? "vg-tariff__card--active" : ""
                }`}
                onClick={() => setField("tariffId", opt.id)}
                aria-pressed={active}
              >
                <span className="vg-tariff__label">{opt.label}</span>
                <span className="vg-tariff__cat">
                  {opt.category}
                  {active && (
                    <Badge tone="success" className="vg-tariff__rec">
                      ✓
                    </Badge>
                  )}
                </span>
                <span className="vg-tariff__price">
                  Rp {opt.pricePerKwh.toLocaleString("id-ID")}
                  <span className="vg-tariff__price-unit">/kWh</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="vg-tariff__row">
        <TextInput
          label="PPJ / Pajak (%)"
          type="text"
          inputMode="decimal"
          value={draft.ppj === "" ? "0" : draft.ppj}
          onChange={(e) => {
            // Boleh desimal (terima koma/titik). Digit & satu titik, buang nol
            // depan, dibatasi maksimal 10% (batas PPJ menurut UU).
            let v = e.target.value
              .replace(/,/g, ".")
              .replace(/[^\d.]/g, "")
              .replace(/(\..*)\./g, "$1")
              .replace(/^0+(?=\d)/, "");
            if (Number(v) > 10) v = "10";
            setField("ppj", v);
          }}
          hint="Persen dari biaya pemakaian (maks 10%, boleh desimal)"
        />
        <TextInput
          label="Biaya Minimum/Bulan"
          type="text"
          inputMode="numeric"
          value={`Rp ${Number(draft.bebanBulanan || 0).toLocaleString("id-ID")}`}
          onChange={(e) =>
            setField("bebanBulanan", e.target.value.replace(/[^\d]/g, ""))
          }
          hint="Rekening minimum pascabayar (0 jika token)"
        />
        <TextInput
          label="Target Bulanan"
          type="text"
          inputMode="numeric"
          value={`Rp ${Number(draft.targetBulanan || 0).toLocaleString("id-ID")}`}
          onChange={(e) =>
            setField("targetBulanan", e.target.value.replace(/[^\d]/g, ""))
          }
          hint="Notifikasi jika biaya melebihi angka ini"
        />
      </div>
    </Card>
  );
}
