/* =============================================================================
 * useNotifications — Notifikasi via TOAST in-app (di dashboard) + Web Notification
 *
 * Dua kejadian yang diatur pengguna di Settings → "Notifikasi & peringatan":
 *   1. Perangkat offline / terputus   (toggle `notifyOffline`)
 *   2. Target konsumsi bulanan tercapai (toggle `notifyMonthlyTarget`)
 *
 * DUA KANAL NOTIFIKASI (agar pasti terlihat):
 *   - TOAST IN-APP: muncul di TENGAH-ATAS dashboard (tepat di bawah navbar — area
 *     yang paling sering dilihat) dan MENETAP sampai pengguna menekan tombol silang.
 *     SELALU tampil, tidak bergantung izin browser / Focus Assist OS.
 *   - NOTIFIKASI OS (Web Notification): tambahan, hanya bila izin granted; berguna
 *     saat tab dashboard di background.
 *
 * TIGA JALUR DETEKSI OFFLINE (di-dedup lewat offlineNotifiedRef supaya tak dobel):
 *   1. Status awal dari deviceStore — menangkap perangkat yang SUDAH mati sebelum
 *      dashboard dibuka. Tanpa ini map kesegaran cuma terisi oleh telemetri masuk,
 *      sehingga perangkat yang mati sejak awal tak pernah terdeteksi sama sekali.
 *   2. LWT broker (connectivity_status_update) — jalur cepat saat putus mendadak.
 *   3. Timer kesegaran — telemetri berhenti > 30 dtk (STALE_MS), sinkron dengan
 *      badge OFFLINE dashboard (ONLINE_FRESHNESS_MS backend).
 * ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { wsService } from "../services/ws";
import { useSettingsStore } from "../store/settingsStore";
import { useDeviceStore } from "../store/deviceStore";
import { tariffOptions } from "../data/tariffs";
import type { WsMessage } from "../types";

const STALE_MS = 30_000;               // ambang offline (samakan dgn backend)
const STALE_CHECK_INTERVAL_MS = 5_000; // interval cek kesegaran
// Jeda KONFIRMASI sebelum alarm offline benar-benar ditampilkan. Sesi MQTT perangkat
// bisa berkedip sesaat (reconnect saat relay beralih / WiFi goyah): broker menerbitkan
// LWT OFFLINE lalu perangkat menyambung lagi hanya milidetik kemudian. Tanpa jeda ini,
// kedipan tsb memunculkan toast "Perangkat Offline" palsu padahal perangkat sehat.
const OFFLINE_CONFIRM_MS = 15_000;

export type ToastKind = "offline" | "target";
export interface AppToast {
  id: number;
  key: string; // identitas kondisi (jenis+device) — cegah duplikat menumpuk
  title: string;
  body: string;
  kind: ToastKind;
}

// Kunci bulan berjalan, mis. "2026-07". Dipakai untuk membatasi konsumsi & notifikasi
// ke bulan ini (target di UI bernama "Target Bulanan").
function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

// Konsumsi BULAN INI (Wh) dari akumulator seumur hidup PZEM. `energy_wh` di telemetri
// adalah counter kumulatif yang hanya di-reset lewat tombol "Reset Energi", jadi untuk
// target BULANAN kita simpan baseline energi di awal tiap bulan (localStorage agar tahan
// reload) lalu ambil selisihnya. Membandingkan akumulator seumur hidup langsung ke target
// bulanan salah — sekali kumulatif melewati target, notifikasi menyala selamanya.
function monthlyEnergyWh(deviceId: string, lifetimeWh: number): number {
  const month = currentMonthKey();
  const key = `vg-energy-baseline-${deviceId}`;
  let base: { month: string; wh: number } | null = null;
  try {
    base = JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    base = null;
  }
  // Bulan baru, belum ada baseline, atau energi di-reset (turun di bawah baseline) →
  // tetapkan baseline = pembacaan sekarang, konsumsi bulan ini mulai dari 0.
  if (!base || base.month !== month || lifetimeWh < base.wh) {
    base = { month, wh: lifetimeWh };
    try {
      localStorage.setItem(key, JSON.stringify(base));
    } catch {
      /* localStorage penuh/diblokir — abaikan, konsumsi bulan ini dianggap 0 */
    }
  }
  return Math.max(0, lifetimeWh - base.wh);
}

// Sudah pernah kirim notifikasi target untuk bulan ini? Disimpan di localStorage agar
// tidak fire lagi tiap reload dalam bulan yang sama; otomatis kembali "belum" saat bulan
// berganti (kuncinya berisi bulan yang tercatat).
function targetAlreadyNotifiedThisMonth(deviceId: string): boolean {
  return localStorage.getItem(`vg-target-notified-${deviceId}`) === currentMonthKey();
}
function markTargetNotified(deviceId: string): void {
  try {
    localStorage.setItem(`vg-target-notified-${deviceId}`, currentMonthKey());
  } catch {
    /* abaikan */
  }
}

export function useNotifications() {
  const saved = useSettingsStore((s) => s.saved);
  const devices = useDeviceStore((s) => s.devices);
  const { notifyOffline, notifyMonthlyTarget, tariffId, ppj, targetBulanan } = saved;

  const pricePerKwh =
    tariffOptions.find((o) => o.id === tariffId)?.pricePerKwh ??
    tariffOptions.find((o) => o.recommended)?.pricePerKwh ??
    tariffOptions[0].pricePerKwh;
  const ppjFactor = 1 + (Number(ppj) || 0) / 100;
  const targetRupiah = Number(targetBulanan) || 0;

  const anyEnabled = notifyOffline || notifyMonthlyTarget;

  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );
  const [toasts, setToasts] = useState<AppToast[]>([]);

  const cooldownRef = useRef<Set<string>>(new Set());        // cegah spam OS-notif per tag
  const lastSeenRef = useRef<Map<string, number>>(new Map()); // ts telemetri terakhir per device
  const offlineNotifiedRef = useRef<Set<string>>(new Set());  // sudah notif offline? per device
  const offlineTimersRef = useRef<Map<string, number>>(new Map()); // jadwal konfirmasi offline
  const toastIdRef = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  // Hapus toast berdasarkan kunci kondisi (mis. "offline-smart_socket"). Bila tak ada
  // yang cocok, kembalikan array LAMA (bukan hasil filter) supaya React bail-out dan
  // tidak re-render — ini dipanggil tiap telemetri masuk (~1 dtk sekali).
  const dismissToastByKey = useCallback((key: string) => {
    setToasts((list) =>
      list.some((t) => t.key === key) ? list.filter((t) => t.key !== key) : list,
    );
  }, []);

  // Toast in-app — SELALU tampil (tanpa izin OS) dan MENETAP sampai pengguna menekan
  // tombol silang. Notifikasi penting (perangkat mati / biaya melewati target) tidak
  // boleh hilang sendiri sebelum sempat dibaca.
  //
  // Justru KARENA menetap, kondisi yang BERULANG bisa menumpuk tanpa batas: perangkat
  // yang flapping (offline→online→offline) me-re-arm offlineNotifiedRef pada tiap
  // telemetri, sehingga tiap siklus memanggil pushToast lagi sementara toast lama masih
  // di layar. Maka dedup per `key` (jenis+device): kalau toast untuk kondisi itu masih
  // tampil, perbarui isinya — jangan tambah baris baru.
  const pushToast = useCallback(
    (key: string, title: string, body: string, kind: ToastKind) => {
      setToasts((list) =>
        list.some((t) => t.key === key)
          ? list.map((t) => (t.key === key ? { ...t, title, body } : t))
          : [...list, { id: ++toastIdRef.current, key, title, body, kind }],
      );
    },
    [],
  );

  // Notifikasi OS — hanya bila izin granted (dengan cooldown 30 dtk per tag).
  const showOsNotif = useCallback((title: string, body: string, tag: string) => {
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted" ||
      cooldownRef.current.has(tag)
    )
      return;
    new Notification(title, { body, tag, icon: "/favicon.ico", silent: false });
    cooldownRef.current.add(tag);
    setTimeout(() => cooldownRef.current.delete(tag), 30_000);
  }, []);

  // Gabungan: toast in-app (pasti) + notifikasi OS (jika diizinkan). `tag` dipakai
  // ganda: kunci dedup toast in-app sekaligus tag notifikasi OS (keduanya butuh
  // identitas kondisi yang sama, mis. "offline-smart_socket").
  const notify = useCallback(
    (title: string, body: string, tag: string, kind: ToastKind) => {
      pushToast(tag, title, body, kind);
      showOsNotif(title, body, tag);
    },
    [pushToast, showOsNotif],
  );

  const fireOffline = useCallback(
    (deviceId: string) => {
      if (offlineNotifiedRef.current.has(deviceId)) return;
      notify(
        "⚠️ Perangkat Offline",
        `${deviceId} tidak dapat dijangkau oleh sistem (tidak ada data > ${
          STALE_MS / 1000
        } detik)`,
        `offline-${deviceId}`,
        "offline",
      );
      offlineNotifiedRef.current.add(deviceId);
    },
    [notify],
  );

  // Jadwalkan alarm offline, JANGAN tampilkan langsung. Bila dalam OFFLINE_CONFIRM_MS
  // ada tanda kehidupan (telemetri/status ONLINE), jadwal dibatalkan dan tidak ada toast
  // sama sekali — inilah yang menyaring kedipan reconnect agar tak jadi alarm palsu.
  const scheduleOffline = useCallback(
    (deviceId: string) => {
      if (offlineNotifiedRef.current.has(deviceId)) return; // sudah dinotifikasi
      if (offlineTimersRef.current.has(deviceId)) return;   // sudah dijadwalkan
      const timer = window.setTimeout(() => {
        offlineTimersRef.current.delete(deviceId);
        fireOffline(deviceId);
      }, OFFLINE_CONFIRM_MS);
      offlineTimersRef.current.set(deviceId, timer);
    },
    [fireOffline],
  );

  // Tanda kehidupan → batalkan jadwal DAN hapus toast offline yang terlanjur tampil.
  // Penghapusan toast ini wajib: toast sengaja menetap sampai diklik, jadi tanpa ini
  // alarm yang sudah terlanjur muncul akan tertinggal di layar selamanya walau perangkat
  // sudah kembali online (bug yang dilaporkan: relay OFF tapi perangkat online).
  const clearOfflineAlarm = useCallback(
    (deviceId: string) => {
      const timer = offlineTimersRef.current.get(deviceId);
      if (timer !== undefined) {
        clearTimeout(timer);
        offlineTimersRef.current.delete(deviceId);
      }
      offlineNotifiedRef.current.delete(deviceId); // re-arm utk kejadian berikutnya
      dismissToastByKey(`offline-${deviceId}`);
    },
    [dismissToastByKey],
  );

  // Bersihkan jadwal yang masih menggantung saat unmount (mis. logout).
  useEffect(() => {
    const timers = offlineTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  // Toggle notifikasi offline dimatikan → batalkan alarm yang masih dijadwalkan. Tanpa
  // ini, jadwal yang terlanjur dibuat sesaat sebelum toggle dimatikan tetap menyala dan
  // memunculkan toast walau fiturnya sudah nonaktif.
  useEffect(() => {
    if (notifyOffline) return;
    offlineTimersRef.current.forEach((t) => clearTimeout(t));
    offlineTimersRef.current.clear();
  }, [notifyOffline]);

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (typeof Notification === "undefined") return "denied";
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  // ── Listener WebSocket: kesegaran + notif target + offline (LWT) ────────────
  useEffect(() => {
    if (!anyEnabled) return;

    // Minta izin OS sekali (untuk kanal OS-notif); toast in-app tetap jalan tanpa ini.
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().then(setPermission);
    }

    const handle = (msg: WsMessage) => {
      const p = msg.payload;
      const eventType = p?.event_type ?? "";
      const deviceId = p?.device_id;
      // Abaikan pesan sistem yang tak menyebut device (sama seperti useDevices). Tanpa
      // penjaga ini, fallback string akan masuk lastSeenRef sebagai perangkat HANTU;
      // begitu pesan semacam itu berhenti, timer kesegaran memunculkan notifikasi
      // "offline" untuk perangkat yang sebenarnya tidak pernah ada.
      if (!deviceId) return;

      // Telemetri masuk = perangkat hidup → perbarui kesegaran, batalkan jadwal alarm,
      // dan hapus toast offline yang mungkin masih tampil dari kedipan sebelumnya.
      if (eventType === "telemetry_ingested") {
        lastSeenRef.current.set(deviceId, Date.now());
        clearOfflineAlarm(deviceId);

        if (notifyMonthlyTarget && targetRupiah > 0) {
          const energyWh = typeof p?.energy_wh === "number" ? p.energy_wh : 0;
          // LEWATI sampel ber-energi 0. Firmware mengirim heartbeat relay-OFF dengan
          // energy_wh = s_last_energy_wh, dan variabel itu bernilai 0 sampai PZEM
          // terbaca pertama kali (app_main.c: diinisialisasi 0, TIDAK dipulihkan dari
          // NVS). Jadi sesudah reboot dengan relay OFF perangkat sempat melaporkan 0
          // padahal akumulatornya besar. Bila 0 itu ikut diproses, monthlyEnergyWh
          // mengira energi "di-reset" lalu menurunkan baseline ke 0 — begitu PZEM
          // terbaca lagi, SELURUH akumulator seumur hidup terhitung sebagai konsumsi
          // bulan ini → alarm target palsu. Konsumsi 0 juga tak pernah perlu memicu
          // alarm, jadi melewatinya aman.
          if (energyWh > 0) {
            // Biaya KONSUMSI bulan ini (bukan akumulator seumur hidup). TANPA Math.max
            // dengan biaya minimum: rekening minimum adalah lantai TAGIHAN, bukan ukuran
            // konsumsi — memakainya di sini membuat notifikasi menyala pada 0 kWh begitu
            // minimum >= target.
            const monthlyWh = monthlyEnergyWh(deviceId, energyWh);
            const cost = (monthlyWh / 1000) * pricePerKwh * ppjFactor;
            // Dedup per BULAN via localStorage (bukan ref in-memory) supaya tidak fire
            // ulang tiap reload, dan otomatis kembali aktif saat bulan berganti.
            if (cost >= targetRupiah && !targetAlreadyNotifiedThisMonth(deviceId)) {
              notify(
                "🎯 Target Konsumsi Bulanan Terlewati",
                `Estimasi biaya ${deviceId} bulan ini Rp ${Math.round(cost).toLocaleString(
                  "id-ID",
                )} — melewati target Rp ${targetRupiah.toLocaleString("id-ID")}`,
                `target-${deviceId}`,
                "target",
              );
              markTargetNotified(deviceId);
            }
          }
        }
        return;
      }

      // Konektivitas dari LWT broker. OFFLINE → DIJADWALKAN (bukan langsung tampil),
      // ONLINE → batalkan jadwal & bersihkan toast. Keduanya harus ditangani: dulu
      // hanya OFFLINE yang ditangani, sehingga saat perangkat menyambung lagi tak ada
      // yang membatalkan/menghapus alarmnya.
      if (notifyOffline && eventType === "connectivity_status_update") {
        const conn = p?.connectivity_status ?? "";
        if (conn === "OFFLINE") {
          scheduleOffline(deviceId);
        } else if (conn === "ONLINE") {
          clearOfflineAlarm(deviceId);
        }
      }
    };

    wsService.connect(); // idempoten
    return wsService.subscribe(handle);
  }, [
    anyEnabled,
    notifyOffline,
    notifyMonthlyTarget,
    pricePerKwh,
    ppjFactor,
    targetRupiah,
    notify,
    scheduleOffline,
    clearOfflineAlarm,
  ]);

  // ── Status awal: perangkat yang SUDAH offline sebelum dashboard dibuka ──────
  // Ini celah utama kenapa notifikasi tidak pernah muncul: lastSeenRef HANYA terisi
  // oleh telemetri masuk, sehingga perangkat yang sudah mati sejak awal tak pernah
  // masuk ke timer kesegaran → tidak ada yang memicu notifikasi. Status di
  // deviceStore (dihitung backend dari kesegaran last_seen) menutup celah itu.
  useEffect(() => {
    if (!notifyOffline) return;
    for (const d of devices) {
      if (d.status === "offline") {
        // Dijadwalkan, bukan langsung: status di store ikut berkedip saat LWT sesaat
        // (offline→online dalam milidetik), dan efek ini jalan tiap store berubah.
        scheduleOffline(d.id);
      } else {
        // Store bilang ONLINE — dan itu OTORITATIF: backend menghitungnya dari
        // kesegaran last_seen, lalu useDevices menyegarkannya tiap 10 dtk. Jadi
        // PERBARUI kesegaran, bukan cuma seed sekali saat belum ada. Kalau hanya
        // di-seed, timer bergantung 100% pada telemetri WS — begitu yang putus
        // justru WS-nya (gateway restart / laptop sleep) sementara perangkatnya
        // sehat, timer memunculkan toast offline PALSU yang bertentangan dengan
        // badge ONLINE di sebelahnya; dan karena toast menetap, alarm palsu itu
        // tinggal di layar sampai ditutup manual.
        lastSeenRef.current.set(d.id, Date.now());
      }
    }
  }, [devices, notifyOffline, scheduleOffline]);

  // ── Timer kesegaran: offline bila telemetri berhenti > STALE_MS ─────────────
  useEffect(() => {
    if (!notifyOffline) return;
    const timer = setInterval(() => {
      const now = Date.now();
      lastSeenRef.current.forEach((last, deviceId) => {
        if (now - last > STALE_MS) fireOffline(deviceId);
      });
    }, STALE_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [notifyOffline, fireOffline]);

  return { permission, requestPermission, toasts, dismissToast };
}
