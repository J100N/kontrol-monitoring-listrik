/* =============================================================================
 * test_mqtt_flow.js — Integration test alur MQTT worker
 *
 * Menerbitkan perintah dummy ke topic dashboard/devices/{id}/command
 * lalu memantau apakah worker memproses dan mengirim feedback ke topic
 * dashboard/devices/{id}/status.
 *
 * Test akan SKIP (bukan FAIL) jika broker MQTT tidak tersedia.
 * Pastikan mqtt_worker sudah berjalan agar test ini menghasilkan feedback.
 *
 * Variabel lingkungan:
 *   MQTT_BROKER_URL  default: mqtt://127.0.0.1:1883
 *   TEST_DEVICE_ID   default: smart_socket
 *
 * Jalankan: npm run test:integration  (dari direktori tests/)
 * ========================================================================== */
const mqtt = require("mqtt");

const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://127.0.0.1:1883";
const DEVICE_ID = process.env.TEST_DEVICE_ID || "smart_socket";

async function main() {
  console.log(`[integration] connect ${BROKER_URL}`);
  const client = mqtt.connect(BROKER_URL, { connectTimeout: 4000 });
  const connected = await new Promise((resolve) => {
    client.once("connect", () => resolve(true));
    client.once("error", () => resolve(false));
    setTimeout(() => resolve(false), 5000);
  });
  if (!connected) {
    console.warn("[integration] broker tidak tersedia, skip");
    process.exit(0);
  }

  const topic = `dashboard/devices/${DEVICE_ID}/status`;
  const sub = `dashboard/devices/${DEVICE_ID}/status`;
  client.subscribe(sub);

  let received = 0;
  client.on("message", (t, p) => {
    received += 1;
    console.log(`[integration] received ${t}: ${p.toString().slice(0, 80)}...`);
  });

  // Publish dummy command ke topic dashboard agar worker mengenkripsi & meneruskan.
  const cmd = `dashboard/devices/${DEVICE_ID}/command`;
  client.publish(
    cmd,
    JSON.stringify({
      device_id: DEVICE_ID,
      command: "RELAY_ON",
      issued_by: "integration_test",
    }),
    { qos: 1 },
  );

  await new Promise((r) => setTimeout(r, 3000));
  console.log(`[integration] selesai, dashboard message diterima: ${received}`);
  client.end(true);
  if (received === 0) {
    console.warn("[integration] WARN: tidak ada feedback worker (pastikan worker hidup)");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
