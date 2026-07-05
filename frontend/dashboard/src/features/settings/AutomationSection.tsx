/* =============================================================================
 * AutomationSection - threshold sensor untuk mode AUTO
 *
 * Berisi 3 input numerik: PIR timeout global, threshold standby, over-current.
 * Semua nilai disimpan di settingsStore (disimpan via tombol global di bawah).
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
          label="PIR Timeout Global"
          type="number"
          value={draft.pirTimeout}
          onChange={(e) => setField("pirTimeout", e.target.value)}
          hint="Detik tanpa gerakan → OFF"
        />
        <TextInput
          label="Threshold Standby"
          type="number"
          value={draft.standbyThreshold}
          onChange={(e) => setField("standbyThreshold", e.target.value)}
          hint="Watt minimum dianggap aktif"
        />
        <TextInput
          label="Proteksi Over-Current"
          type="number"
          value={draft.overCurrent}
          onChange={(e) => setField("overCurrent", e.target.value)}
          hint="Auto-cutoff jika arus > A"
        />
      </div>
    </Card>
  );
}
