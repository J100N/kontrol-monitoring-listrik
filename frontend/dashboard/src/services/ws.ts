/* =============================================================================
 * ws.ts — Klien WebSocket singleton ke realtime_gateway
 *
 * Alur data realtime:
 *   ESP32 → MQTT broker → mqtt_worker → MQTT dashboard/* →
 *   realtime_gateway → WebSocket /ws → browser (komponen React)
 *
 * Desain:
 *   - Singleton: satu koneksi WS untuk seluruh aplikasi, bukan per komponen
 *   - Subscriber pattern: komponen mendaftar callback, dipanggil saat pesan masuk
 *   - Auto-reconnect: mencoba sambung ulang setiap 3 detik jika putus
 *   - Path /ws ditangani Nginx (production) atau Vite proxy (development)
 *
 * Format pesan yang diterima (WsMessage):
 *   { topic, received_at, payload: { device_id, event_type, power_w, ... } }
 * ========================================================================== */

import type { WsMessage } from "../types";

// Tipe fungsi callback yang didaftarkan oleh komponen
type Subscriber = (msg: WsMessage) => void;

class WsService {
  private ws: WebSocket | null = null;
  private subscribers = new Set<Subscriber>(); // Kumpulan callback aktif
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldConnect = false; // Flag: apakah koneksi seharusnya aktif

  /**
   * Bangun URL WebSocket dari window.location supaya bekerja di semua lingkungan.
   * http → ws, https → wss (untuk koneksi aman)
   */
  private get url(): string {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/ws`;
  }

  /**
   * connect — mulai koneksi WebSocket.
   * Abaikan jika sudah terhubung atau sedang dalam proses koneksi.
   */
  connect() {
    this.shouldConnect = true;
    // readyState 0 = CONNECTING, 1 = OPEN — jangan buka koneksi baru
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this._open();
  }

  /**
   * disconnect — tutup koneksi dan batalkan auto-reconnect.
   * Dipanggil saat pengguna logout atau komponen di-unmount.
   */
  disconnect() {
    this.shouldConnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  /**
   * subscribe — daftarkan callback untuk menerima pesan realtime.
   * Mengembalikan fungsi unsubscribe untuk membersihkan saat komponen di-unmount.
   *
   * Penggunaan di hook:
   *   const unsub = wsService.subscribe((msg) => { ... });
   *   return unsub; // di cleanup useEffect
   */
  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** Buka koneksi WebSocket baru dan pasang semua event handler */
  private _open() {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      // URL tidak valid atau WebSocket tidak didukung browser
      this._scheduleReconnect();
      return;
    }

    // Koneksi berhasil terbuka
    this.ws.onopen = () => {
      console.info("[WS] terhubung ke realtime gateway");
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    // Pesan masuk dari server — parse JSON dan teruskan ke semua subscriber
    this.ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as WsMessage;
        // Abaikan pesan sistem/welcome yang tidak memiliki device_id
        if (!msg.payload?.device_id) return;
        // Panggil semua callback yang terdaftar
        this.subscribers.forEach((fn) => fn(msg));
      } catch {
        // Payload bukan JSON valid — diabaikan
      }
    };

    // Error koneksi — dicatat tapi tidak perlu aksi tambahan (onclose akan handle)
    this.ws.onerror = () => {
      console.warn("[WS] error koneksi");
    };

    // Koneksi putus — jadwalkan reconnect jika memang seharusnya terhubung
    this.ws.onclose = () => {
      console.info("[WS] koneksi putus");
      if (this.shouldConnect) this._scheduleReconnect();
    };
  }

  /** Jadwalkan percobaan sambung ulang setelah 3 detik */
  private _scheduleReconnect() {
    if (this.reconnectTimer) return; // Sudah ada timer aktif, jangan duplikat
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldConnect) this._open();
    }, 3_000);
  }
}

// Ekspor sebagai singleton — satu instance untuk seluruh aplikasi
export const wsService = new WsService();
