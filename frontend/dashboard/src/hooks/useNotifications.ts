/* =============================================================================
 * useNotifications — Notifikasi browser via Web Notification API + WebSocket
 *
 * Cara kerja:
 *   1. Minta izin Notification saat pertama dipasang (jika belum granted)
 *   2. Subscribe ke wsService (singleton WebSocket)
 *   3. Ketika event kritis masuk, tampilkan browser notification
 *
 * Event yang memicu notifikasi:
 *   - Perangkat offline (connectivity_offline / status offline)
 *   - Insiden keamanan enkripsi (replay_blocked, decrypt_failed)
 *   - Command timeout (tidak ada ACK dari firmware)
 *   - Daya melebihi threshold (telemetry_ingested dengan power_w tinggi)
 *
 * Gunakan prop `thresholdMap` untuk notifikasi overcurrent per device.
 * ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { wsService } from "../services/ws";
import type { WsMessage } from "../types";

// Event yang langsung memicu notifikasi (tanpa perlu cek nilai sensor)
const SECURITY_EVENTS = new Set([
  "telemetry_replay_blocked",
  "telemetry_decrypt_failed",
  "telemetry_envelope_invalid",
  "telemetry_unknown_device",
]);

export interface NotificationOptions {
  /** Aktifkan/matikan semua notifikasi */
  enabled: boolean;
  /** Map device_id → threshold watt untuk deteksi overcurrent */
  thresholdMap?: Record<string, number>;
}

export function useNotifications({
  enabled,
  thresholdMap = {},
}: NotificationOptions) {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined"
      ? Notification.permission
      : "denied",
  );

  // Cegah notifikasi ganda dengan set cooldown per tag
  const cooldownRef = useRef<Set<string>>(new Set());

  /** Tampilkan satu notifikasi dengan cooldown 30 detik per tag */
  const showNotif = useCallback(
    (title: string, body: string, tag: string) => {
      if (
        typeof Notification === "undefined" ||
        Notification.permission !== "granted" ||
        cooldownRef.current.has(tag)
      )
        return;

      new Notification(title, {
        body,
        tag,
        icon: "/favicon.ico",
        silent: false,
      });

      cooldownRef.current.add(tag);
      setTimeout(() => cooldownRef.current.delete(tag), 30_000);
    },
    [],
  );

  /** Minta izin notifikasi secara manual (dipanggil oleh tombol di Settings) */
  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (typeof Notification === "undefined") return "denied";
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  // Subscribe ke WebSocket dan proses setiap event masuk
  useEffect(() => {
    if (!enabled) return;
    if (typeof Notification === "undefined") return;

    // Minta izin otomatis jika belum ditentukan
    if (Notification.permission === "default") {
      Notification.requestPermission().then(setPermission);
    }

    const handle = (msg: WsMessage) => {
      if (Notification.permission !== "granted") return;

      const { payload } = msg;
      const eventType = payload?.event_type ?? "";
      const deviceId  = payload?.device_id  ?? "perangkat tidak dikenal";
      const status    = payload?.status      ?? "";

      // ── Perangkat offline ─────────────────────────────────────────────
      if (
        eventType.includes("connectivity") &&
        (status === "offline" || eventType.includes("offline"))
      ) {
        showNotif(
          "⚠️ Perangkat Offline",
          `${deviceId} tidak dapat dijangkau oleh sistem`,
          `offline-${deviceId}`,
        );
        return;
      }

      // ── Insiden keamanan enkripsi ─────────────────────────────────────
      if (SECURITY_EVENTS.has(eventType) || eventType.includes("replay")) {
        showNotif(
          "🔒 Insiden Keamanan Terdeteksi",
          `${deviceId}: ${eventType.replace(/_/g, " ")}`,
          `security-${deviceId}-${eventType}`,
        );
        return;
      }

      // ── Perintah timeout (tidak ada ACK) ─────────────────────────────
      if (eventType === "command_timeout") {
        showNotif(
          "⏱️ Perintah Tidak Direspons",
          `Perintah ke ${deviceId} tidak mendapat konfirmasi dari firmware`,
          `timeout-${deviceId}`,
        );
        return;
      }

      // ── Daya melebihi threshold ───────────────────────────────────────
      if (eventType === "telemetry_ingested") {
        const powerW    = payload?.power_w ?? 0;
        const threshold = thresholdMap[deviceId];
        if (threshold != null && powerW > threshold) {
          showNotif(
            "⚡ Daya Melebihi Batas",
            `${deviceId}: ${powerW} W (batas: ${threshold} W)`,
            `overcurrent-${deviceId}`,
          );
        }
      }
    };

    // Kembalikan fungsi cleanup — otomatis unsubscribe saat unmount
    return wsService.subscribe(handle);
  }, [enabled, thresholdMap, showNotif]);

  return { permission, requestPermission };
}
