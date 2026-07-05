/* =============================================================================
 * useCommand — Kirim perintah relay ke device melalui REST API
 *
 * Endpoint: POST /api/devices/:id/control
 * Body    : { command: "RELAY_ON" | "RELAY_OFF", issued_by: string }
 *
 * Alur setelah request diterima backend:
 *   1. API validasi command dan cek device ada di registry
 *   2. API terbitkan perintah terenkripsi ASCON ke MQTT broker
 *   3. MQTT worker catat perintah dengan timer 8 detik
 *   4. ESP32 decrypt → eksekusi relay → kirim ACK
 *   5. MQTT worker tandai perintah selesai, catat latency
 *
 * Hook ini hanya menangani sisi pengiriman HTTP.
 * Status ACK diterima secara realtime via WebSocket (event_type: "command_ack").
 * ========================================================================== */

import { useCallback, useState } from "react";
import { api } from "../services/api";

// Dua perintah relay yang didukung sistem
type RelayCommand = "RELAY_ON" | "RELAY_OFF";

interface CommandResult {
  ok:          boolean;
  command_id?: string; // ID unik perintah untuk tracking ACK
  message?:    string;
}

export function useCommand() {
  const [sending, setSending] = useState(false);       // True saat request sedang berjalan
  const [error,   setError]   = useState<string | null>(null);

  /**
   * send — kirim perintah relay ke satu device.
   *
   * @param deviceId  - ID device tujuan (contoh: "smart_socket")
   * @param command   - "RELAY_ON" atau "RELAY_OFF"
   * @param issuedBy  - Identitas pengirim perintah (untuk log audit)
   * @returns CommandResult jika berhasil, null jika gagal
   */
  const send = useCallback(
    async (
      deviceId:  string,
      command:   RelayCommand,
      issuedBy = "dashboard_user",
    ): Promise<CommandResult | null> => {
      setSending(true);
      setError(null);
      try {
        const res = await api.post<CommandResult>(
          `/api/devices/${deviceId}/control`,
          { command, issued_by: issuedBy },
        );
        return res.data;
      } catch (err) {
        setError((err as Error).message ?? "Gagal mengirim perintah");
        return null;
      } finally {
        setSending(false);
      }
    },
    [],
  );

  return { send, sending, error };
}
