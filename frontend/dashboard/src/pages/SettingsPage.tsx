/* =============================================================================
 * SettingsPage - pengaturan sistem VoltGuard
 *
 * Semua section terkontrol oleh settingsStore (pola draft/saved). Di bawah
 * halaman terdapat SATU save-bar lengket (sticky) berisi tombol "Simpan
 * perubahan" yang benar-benar mempersist seluruh pengaturan ke localStorage.
 * ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { TariffSection }       from "../features/settings/TariffSection";
import { AutomationSection }   from "../features/settings/AutomationSection";
import { NotificationSection } from "../features/settings/NotificationSection";
import { Button }              from "../components/ui/Button";
import { tariffOptions }       from "../data/tariffs";
import { useSettingsStore }    from "../store/settingsStore";
import { usePatchDevice }      from "../hooks/usePatchDevice";
import { useDevice }           from "../hooks/useDevice";
import "./settings.css";

// Sistem 1-socket: parameter auto-control dikirim ke device ini.
const DEVICE_ID = "smart_socket";

export function SettingsPage() {
  const draft            = useSettingsStore((s) => s.draft);
  const isDirty          = useSettingsStore((s) => s.isDirty)();
  const save             = useSettingsStore((s) => s.save);
  const resetDraft       = useSettingsStore((s) => s.resetDraft);
  const resetToDefault   = useSettingsStore((s) => s.resetToDefault);
  const seedDeviceParams = useSettingsStore((s) => s.seedDeviceParams);

  const { sendConfig } = usePatchDevice();
  // Ambil nilai NYATA perangkat untuk men-seed form kontrol otomatis.
  const { device } = useDevice(DEVICE_ID);

  // Status feedback untuk save-bar
  const [status, setStatus] = useState<
    "idle" | "saved" | "denied" | "device_failed" | "saving"
  >("idle");

  // Sinkronkan draft dari saved sekali saat halaman dibuka (jaga-jaga).
  useEffect(() => {
    resetDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed PIR timeout & threshold dari perangkat saat data tiba (sekali).
  const seededRef = useRef(false);
  useEffect(() => {
    if (device && !seededRef.current) {
      seededRef.current = true;
      seedDeviceParams(device.pirTimeout, device.threshold);
    }
  }, [device, seedDeviceParams]);

  const handleSave = async () => {
    setStatus("saving");

    // Jika ada notifikasi aktif & izin browser belum diberikan, minta izin
    // dulu (harus dari klik tombol). Simpan tetap dilanjutkan apa pun hasilnya.
    let denied = false;
    if (
      (draft.notifyOffline || draft.notifyMonthlyTarget) &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      const result = await Notification.requestPermission();
      denied = result !== "granted";
    } else if (
      (draft.notifyOffline || draft.notifyMonthlyTarget) &&
      typeof Notification !== "undefined" &&
      Notification.permission === "denied"
    ) {
      denied = true;
    }

    // Kirim parameter kontrol otomatis ke ESP32 (timeout PIR + threshold daya).
    // Tarif, MQTT broker, & notifikasi hanya tersimpan di dashboard.
    const deviceOk = await sendConfig(DEVICE_ID, {
      pir_timeout_sec:   Math.round(Number(draft.pirTimeout)) || 600,
      power_threshold_w: Number(draft.standbyThreshold) || 0,
    });

    // Persist seluruh pengaturan ke localStorage.
    save();

    if (!deviceOk) setStatus("device_failed");
    else if (denied) setStatus("denied");
    else setStatus("saved");
    setTimeout(() => setStatus("idle"), 4000);
  };

  return (
    <>
      <div className="vg-page-header">
        <div>
          <h1 className="vg-page-header__title">Pengaturan sistem</h1>
          <p className="vg-page-header__subtitle">
            Konfigurasi tarif, kontrol otomatis, dan notifikasi VoltGuard
          </p>
        </div>
      </div>

      <div className="vg-settings__content">
        <TariffSection options={tariffOptions} />
        <AutomationSection />
        <NotificationSection />
      </div>

      {/* ── Save-bar lengket: satu tombol simpan untuk seluruh halaman ───── */}
      <div className={`vg-savebar ${isDirty ? "vg-savebar--dirty" : ""}`}>
        <div className="vg-savebar__inner">
          <span className="vg-savebar__status">
            {status === "saving" ? (
              <span className="vg-savebar__status--dirty">
                Menyimpan & mengirim ke perangkat…
              </span>
            ) : status === "saved" ? (
              <span className="vg-savebar__status--ok">
                ✓ Tersimpan & parameter dikirim ke perangkat
              </span>
            ) : status === "device_failed" ? (
              <span className="vg-savebar__status--warn">
                ✓ Tersimpan di dashboard — perangkat tidak merespons (cek koneksi)
              </span>
            ) : status === "denied" ? (
              <span className="vg-savebar__status--warn">
                ✓ Tersimpan — namun izin notifikasi browser ditolak
              </span>
            ) : isDirty ? (
              <span className="vg-savebar__status--dirty">
                <span className="vg-savebar__dot" />
                Ada perubahan yang belum disimpan
              </span>
            ) : (
              <span className="vg-savebar__status--idle">
                Semua perubahan tersimpan
              </span>
            )}
          </span>

          <div className="vg-savebar__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={resetToDefault}
              title="Kembalikan semua nilai ke default pabrik"
            >
              Default
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={resetDraft}
              disabled={!isDirty}
            >
              Batalkan
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={!isDirty}>
              Simpan perubahan
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
