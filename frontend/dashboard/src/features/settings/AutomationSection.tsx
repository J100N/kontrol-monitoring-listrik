/* =============================================================================
 * AutomationSection - threshold sensor untuk mode AUTO
 *
 * Berisi 2 input numerik: PIR timeout global & threshold standby (keduanya
 * dikirim ke perangkat). Semua nilai disimpan di settingsStore (via tombol
 * global "Simpan perubahan" di bawah).
 * ========================================================================== */

import { Card } from "../../components/ui/Card";
import { TextInput } from "../../components/ui/TextInput";
import { ClockIcon } from "../../components/icons";
import { useSettingsStore } from "../../store/settingsStore";

export function AutomationSection() {
  const draft = useSettingsStore((s) => s.draft);
  const setField = useSettingsStore((s) => s.setField);

  return (
    <Card
      title="Kontrol otomatis (mode AUTO)"
      subtitle="Threshold sensor untuk pengaturan ON/OFF otomatis"
      headerRight={
        <div className="vg-section__icon vg-section__icon--violet">
          <ClockIcon size={18} />
        </div>
      }
    >
      <div className="vg-mqtt__grid">
        <TextInput
          label="PIR Timeout (detik)"
          type="text"
          inputMode="numeric"
          value={`${Number(draft.pirTimeout) || 0}`}
          onChange={(e) =>
            setField("pirTimeout", e.target.value.replace(/[^\d]/g, ""))
          }
          hint="Lama tanpa gerakan sebelum relay OFF (detik)"
        />
        <TextInput
          label="Threshold Standby (watt)"
          type="text"
          inputMode="decimal"
          value={draft.standbyThreshold === "" ? "0" : draft.standbyThreshold}
          onChange={(e) => {
            // Boleh desimal (koma/titik), tanpa minus, maks 5000 W (batas firmware).
            let v = e.target.value
              .replace(/,/g, ".")
              .replace(/[^\d.]/g, "")
              .replace(/(\..*)\./g, "$1")
              .replace(/^0+(?=\d)/, "");
            if (Number(v) > 5000) v = "5000";
            setField("standbyThreshold", v);
          }}
          hint="Daya di bawah nilai ini dianggap standby (watt)"
        />
      </div>
    </Card>
  );
}
