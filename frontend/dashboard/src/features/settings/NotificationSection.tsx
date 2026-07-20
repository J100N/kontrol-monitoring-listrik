/* =============================================================================
 * NotificationSection - pengaturan preferensi notifikasi & peringatan
 *
 * Satu kelompok: kejadian yang dipantau. Notifikasi tampil sebagai pop-up
 * alert di dalam dashboard saat browser terbuka. Nilai disimpan di
 * settingsStore (disimpan via tombol global di bawah halaman).
 * ========================================================================== */

import { Card }         from "../../components/ui/Card";
import { ToggleSwitch } from "../../components/ui/ToggleSwitch";
import { BellIcon }     from "../../components/icons";
import { useSettingsStore, type SettingsValues } from "../../store/settingsStore";

// Hanya field bertipe boolean di SettingsValues (untuk keamanan tipe toggle).
type NotifKey = {
  [K in keyof SettingsValues]: SettingsValues[K] extends boolean ? K : never;
}[keyof SettingsValues];

// Daftar kejadian — `key` menunjuk ke field boolean di settingsStore.
const EVENTS: {
  key:   NotifKey;
  label: string;
  desc:  string;
}[] = [
  {
    key:   "notifyOffline",
    label: "Perangkat offline / terputus",
    desc:  "Kirim alert saat smart socket tidak dapat dijangkau oleh sistem",
  },
  {
    key:   "notifyMonthlyTarget",
    label: "Target konsumsi bulanan tercapai",
    desc:  "Peringatan saat estimasi biaya bulanan melebihi target (Rp) yang ditetapkan",
  },
];

export function NotificationSection() {
  const draft = useSettingsStore((s) => s.draft);
  const setField = useSettingsStore((s) => s.setField);

  return (
    <Card
      title="Notifikasi & peringatan"
      subtitle="Pilih kejadian yang ingin Anda pantau secara aktif"
      headerRight={
        <div className="vg-section__icon vg-section__icon--green">
          <BellIcon size={18} />
        </div>
      }
    >
      <p className="vg-notif__group-label">Kejadian yang dipantau</p>
      <div className="vg-notif__rows">
        {EVENTS.map((ev) => (
          <div className="vg-notif__row" key={ev.key}>
            <div>
              <strong>{ev.label}</strong>
              <p>{ev.desc}</p>
            </div>
            <ToggleSwitch
              checked={Boolean(draft[ev.key])}
              onChange={(v) => setField(ev.key, v)}
              ariaLabel={ev.label}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
