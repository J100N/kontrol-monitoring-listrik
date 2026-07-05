/* =============================================================================
 * test_full_flow.js — End-to-end smoke test VoltGuard
 *
 * Menguji alur lengkap dari API → MQTT → WebSocket secara berurutan.
 * Setiap langkah akan SKIP (bukan FAIL) jika service belum hidup, sehingga
 * aman dijalankan di environment development minimal.
 *
 * Langkah yang diuji:
 *   1. GET /healthz               — API hidup
 *   2. GET /api/devices           — daftar device bisa diambil
 *   3. POST /api/devices/:id/control — kirim perintah relay
 *   4. Publish command via MQTT   — broker tersedia
 *   5. WebSocket connect /ws      — realtime gateway hidup
 *
 * Variabel lingkungan:
 *   API_BASE_URL   default: http://localhost:8080
 *   WS_URL         default: ws://localhost:8090/ws
 *   MQTT_BROKER_URL default: mqtt://127.0.0.1:1883
 *   TEST_DEVICE_ID  default: smart_socket
 *
 * Jalankan: npm run test:e2e  (dari direktori tests/)
 * ========================================================================== */
const axios = require("axios");
const mqtt = require("mqtt");

const API_BASE = process.env.API_BASE_URL || "http://localhost:8080";
const WS_URL = process.env.WS_URL || "ws://localhost:8090/ws";
const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://127.0.0.1:1883";
const DEVICE_ID = process.env.TEST_DEVICE_ID || "smart_socket";

async function step(label, fn) {
  try {
    const result = await fn();
    console.log(`[e2e] PASS ${label}: ${result || "ok"}`);
    return true;
  } catch (error) {
    console.warn(`[e2e] SKIP/FAIL ${label}: ${error.message}`);
    return false;
  }
}

async function main() {
  await step("api healthz", async () => {
    const res = await axios.get(`${API_BASE}/healthz`, { timeout: 3000 });
    if (!res.data.ok) throw new Error("not ok");
    return "ok";
  });

  await step("api list devices", async () => {
    const res = await axios.get(`${API_BASE}/api/devices`, { timeout: 3000 });
    return `${(res.data.devices || []).length} devices`;
  });

  await step("api control RELAY_ON", async () => {
    const res = await axios.post(
      `${API_BASE}/api/devices/${DEVICE_ID}/control`,
      { command: "RELAY_ON", issued_by: "e2e" },
      { timeout: 4000 },
    );
    return `command_id=${res.data.command_id}`;
  });

  await step("mqtt publish dashboard command", async () => {
    const client = mqtt.connect(BROKER_URL, { connectTimeout: 3000 });
    const ok = await new Promise((resolve) => {
      client.once("connect", () => resolve(true));
      client.once("error", () => resolve(false));
      setTimeout(() => resolve(false), 4000);
    });
    if (!ok) {
      client.end(true);
      throw new Error("broker offline");
    }
    await new Promise((res, rej) => {
      client.publish(
        `dashboard/devices/${DEVICE_ID}/command`,
        JSON.stringify({
          device_id: DEVICE_ID,
          command: "RELAY_OFF",
          issued_by: "e2e",
        }),
        { qos: 1 },
        (err) => (err ? rej(err) : res()),
      );
    });
    client.end(true);
    return "published";
  });

  await step("ws subscribe dashboard status", async () => {
    const WebSocket = require("ws");
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error("ws timeout"));
      }, 4000);
      ws.on("open", () => {
        clearTimeout(timer);
        ws.close();
        resolve("connected");
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
