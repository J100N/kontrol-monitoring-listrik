// =============================================================================
//  SIMULASI ENDPOINT TANPA ENKRIPSI  (baseline pembanding uji keamanan TA)
// -----------------------------------------------------------------------------
//  Tujuan: merepresentasikan "kondisi tanpa fitur" — sebuah perangkat yang
//  menerima perintah kontrol MQTT TANPA verifikasi kripto (tanpa ASCON, tanpa
//  cek tag autentikasi, tanpa anti-replay). Dipakai untuk menunjukkan bahwa
//  bila enkripsi TIDAK diterapkan, serangan injeksi/replay/tampering BERHASIL.
//
//  Bandingkan dengan perangkat asli (ASCON-AEAD128) yang MENOLAK semua serangan.
//
//  >>> AMAN: subscribe ke topik TERPISAH `devices/sim_plain/command`.
//      Perangkat ESP32 asli hanya subscribe `devices/smart_socket/command`,
//      jadi simulator ini TIDAK PERNAH menyentuh relay fisik. <<<
//
//  Jalankan:  node device_sim.js      (dari folder tests/baseline_tanpa_enkripsi)
// =============================================================================

const mqtt = require("mqtt");

const BROKER = "mqtt://167.71.195.81:1883";
const USERNAME = "pujiono";
const PASSWORD = "GANTI_PASSWORD_MQTT";
const CMD_TOPIC = "devices/sim_plain/command"; // TOPIK TERPISAH — bukan device asli
const STATUS_TOPIC = "devices/sim_plain/relay/status"; // status relay hasil eksekusi
const ACK_TOPIC = "devices/sim_plain/ack"; // balasan konfirmasi ke penyerang

let relay = "OFF";
let lastPayload = null;

const client = mqtt.connect(BROKER, {
  username: USERNAME,
  password: PASSWORD,
  clientId: "sim_plain_" + Math.random().toString(16).slice(2, 8),
  connectTimeout: 10000,
});

client.on("error", (e) => {
  console.log("[ERROR] koneksi broker:", e.message);
  process.exit(1);
});

client.on("connect", () => {
  client.subscribe(CMD_TOPIC, { qos: 1 }, (err) => {
    if (err) {
      console.log("[ERROR] gagal subscribe:", err.message);
      process.exit(1);
    }
    console.log("========================================================");
    console.log("  DEVICE TANPA ENKRIPSI (baseline) — SIAP");
    console.log("  Topik perintah :", CMD_TOPIC);
    console.log("  Status relay   :", relay);
    console.log("  (menerima perintah plaintext TANPA verifikasi apa pun)");
    console.log("========================================================");
    console.log("Menunggu perintah... (Ctrl+C untuk berhenti)\n");
  });
});

client.on("message", (topic, message) => {
  const raw = message.toString();
  const stamp = new Date().toLocaleTimeString();
  console.log(`[${stamp}] PESAN MASUK: ${raw}`);

  let cmd;
  try {
    cmd = JSON.parse(raw);
  } catch (e) {
    console.log("   -> bukan JSON valid, diabaikan\n");
    return;
  }

  const isReplay = raw === lastPayload;

  // ---- TANPA verifikasi kripto/counter/tag: eksekusi apa pun yang masuk ----
  if (cmd.command === "ON" || cmd.command === "OFF") {
    const prev = relay;
    relay = cmd.command;
    console.log(`   -> RELAY: ${prev} => ${relay}   [PERINTAH DITERIMA & DIEKSEKUSI]`);
    if (isReplay) {
      console.log("   -> !! Ini pesan yang SAMA diulang, tetap dieksekusi (tidak ada anti-replay)");
    }
    console.log("");

    // Publish status relay + ACK supaya bisa dipantau di MQTTX (subscribe topik di bawah)
    const ts = Date.now();
    client.publish(
      STATUS_TOPIC,
      JSON.stringify({ device_id: "sim_plain", relay, ts }),
      { qos: 1 }
    );
    client.publish(
      ACK_TOPIC,
      JSON.stringify({
        device_id: "sim_plain",
        command_id: cmd.command_id || null,
        status: "ok",
        message: isReplay
          ? "perintah (replay) diterima & dieksekusi tanpa verifikasi"
          : "perintah diterima & dieksekusi tanpa verifikasi",
        relay,
        ts,
      }),
      { qos: 1 }
    );
  } else {
    console.log("   -> field 'command' tidak dikenali (harusnya ON/OFF)\n");
  }

  lastPayload = raw;
});
