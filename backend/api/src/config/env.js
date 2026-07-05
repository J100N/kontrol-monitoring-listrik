const path = require("path");

// Daftar variabel environment yang wajib ada — server tidak akan start jika kurang
const REQUIRED = ["INFLUX_URL", "INFLUX_TOKEN", "INFLUX_ORG", "INFLUX_BUCKET"];

/** Kembalikan path root repositori (4 level ke atas dari file ini) */
function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..", "..");
}

/**
 * loadEnv — baca semua env variable dan kembalikan sebagai objek konfigurasi terstruktur.
 * Melempar Error jika ada variabel wajib yang tidak terset.
 */
function loadEnv() {
  const config = {
    // ── Konfigurasi server HTTP ──────────────────────────────────────────
    server: {
      port:       Number(process.env.API_PORT || 8080),
      corsOrigin: process.env.API_CORS_ORIGIN || "*",
    },

    // ── Konfigurasi autentikasi JWT ──────────────────────────────────────
    // JWT_SECRET: kunci rahasia untuk tanda tangan token — wajib diganti di production
    // ADMIN_USERNAME/PASSWORD: kredensial satu-satunya pengguna dashboard
    auth: {
      jwtSecret:     process.env.JWT_SECRET || "voltguard-dev-secret-ganti-di-production",
      jwtExpiresIn:  process.env.JWT_EXPIRES_IN || "8h",
      adminUsername: process.env.ADMIN_USERNAME || "admin",
      adminPassword: process.env.ADMIN_PASSWORD || "voltguard2024",
    },

    // ── Konfigurasi InfluxDB (time-series database) ──────────────────────
    influx: {
      url:    process.env.INFLUX_URL,
      token:  process.env.INFLUX_TOKEN,
      org:    process.env.INFLUX_ORG,
      bucket: process.env.INFLUX_BUCKET,
      // Nama measurement untuk data telemetri (V/A/W/Wh/Hz/PF)
      telemetryMeasurement: process.env.INFLUX_MEASUREMENT || "power_telemetry",
      // Nama measurement untuk log event perangkat (relay, ack, konektivitas)
      eventMeasurement:     process.env.INFLUX_MEASUREMENT_EVENT || "device_event",
    },

    // ── Konfigurasi MQTT Broker (EMQX) ───────────────────────────────────
    // API menerbitkan perintah relay ke broker, bukan berlangganan telemetri
    mqtt: {
      brokerUrl: process.env.MQTT_BROKER_URL || "mqtt://127.0.0.1:1883",
      username:  process.env.MQTT_USERNAME || undefined,
      password:  process.env.MQTT_PASSWORD || undefined,
      clientId:  process.env.MQTT_CLIENT_ID || `backend_api_${Date.now()}`,
    },

    // ── Konfigurasi penyimpanan registry device ──────────────────────────
    // Registry disimpan sebagai file JSON (sumber kebenaran daftar perangkat fisik)
    storage: {
      deviceRegistryFile:
        process.env.DEVICE_REGISTRY_FILE ||
        path.join(repoRoot(), "database", "device_registry", "devices.json"),
    },
  };

  // Validasi: hentikan proses jika ada variabel InfluxDB yang belum diset
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`API env Influx belum lengkap: ${missing.join(", ")}`);
  }

  return config;
}

module.exports = { loadEnv };
