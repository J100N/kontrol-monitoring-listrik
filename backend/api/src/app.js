// Muat variabel lingkungan dari file .env sebelum modul lain diinisialisasi
require("dotenv").config();

const express = require("express");
const cors    = require("cors");

// ── Import modul internal ────────────────────────────────────────────────────
const { loadEnv }                   = require("./config/env");
const { withTag }                   = require("../../common/helpers/logger");

// Repository: lapisan akses data (file JSON, InfluxDB, MQTT)
const { createDeviceRegistryRepo }  = require("./repositories/deviceRegistryRepo");
const { createInfluxRepo }          = require("./repositories/influxRepo");
const { createMqttPublisher }       = require("./repositories/mqttPublisher");

// Service: logika bisnis (validasi, transformasi, orkestrasi)
const { createDeviceService }       = require("./services/deviceService");
const { createTelemetryService }    = require("./services/telemetryService");
const { createCommandService }      = require("./services/commandService");

// Controller: tangani HTTP request → panggil service → kirim response
const { createDeviceController }    = require("./controllers/deviceController");
const { createTelemetryController } = require("./controllers/telemetryController");
const { createCommandController }   = require("./controllers/commandController");
const { createAuthController }      = require("./controllers/authController");

// Middleware: pemeriksaan JWT sebelum request masuk ke route handler
const { createAuthMiddleware }      = require("./middleware/authMiddleware");

// Route: peta URL ke handler yang sesuai
const { createDeviceRoutes }        = require("./routes/devices");
const { createAuthRoutes }          = require("./routes/auth");
const { createHealthRoutes }        = require("./routes/health");

/**
 * buildApp — membangun instance Express dengan semua dependency ter-inject.
 * Pola ini memudahkan testing karena tidak ada state global.
 */
function buildApp() {
  // Muat dan validasi semua konfigurasi dari environment variable
  const config = loadEnv();
  const logger = withTag("api");

  // ── Inisialisasi repository (lapisan paling bawah) ───────────────────────
  // Registry perangkat: baca/tulis file devices.json
  const registryRepo  = createDeviceRegistryRepo({ filePath: config.storage.deviceRegistryFile });
  // InfluxDB: baca data telemetri dan event dari time-series database
  const influxRepo    = createInfluxRepo(config.influx);
  // MQTT Publisher: kirim perintah ke broker (relay ON/OFF, set mode)
  const mqttPublisher = createMqttPublisher(config.mqtt, logger);

  // ── Inisialisasi service (logika bisnis) ─────────────────────────────────
  const deviceService    = createDeviceService({ registryRepo, influxRepo });
  const telemetryService = createTelemetryService({ influxRepo });
  const commandService   = createCommandService({ registryRepo, mqttPublisher });

  // ── Inisialisasi controller (menghubungkan HTTP ↔ service) ───────────────
  const deviceController    = createDeviceController({ deviceService });
  const telemetryController = createTelemetryController({ telemetryService });
  const commandController   = createCommandController({ commandService });

  // Auth controller: hash password sekali saat startup, tangani login
  const authController = createAuthController({ authConfig: config.auth });
  // Auth middleware: verifikasi JWT Bearer token di setiap request terproteksi
  const requireAuth    = createAuthMiddleware({ jwtSecret: config.auth.jwtSecret });

  // ── Setup Express ────────────────────────────────────────────────────────
  const app = express();

  // CORS: izinkan request dari origin yang dikonfigurasi (default: semua)
  app.use(cors({ origin: config.server.corsOrigin }));
  // Parsing body JSON, maksimal 256KB per request
  app.use(express.json({ limit: "256kb" }));

  // ── Daftarkan route ──────────────────────────────────────────────────────

  // Health check — tidak perlu login, dipakai Docker healthcheck
  app.use("/", createHealthRoutes());

  // Autentikasi — POST /api/auth/login terbuka, GET /api/auth/me butuh token
  app.use("/api/auth", createAuthRoutes({ authController, requireAuth }));

  // Device endpoints — semua dilindungi JWT (requireAuth dipasang sebelum router)
  app.use(
    "/api/devices",
    requireAuth,
    createDeviceRoutes({ deviceController, telemetryController, commandController }),
  );

  // ── Error handler global ─────────────────────────────────────────────────

  // 404: URL tidak ditemukan
  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
  });

  // 500: error tak terduga dari route handler
  app.use((err, _req, res, _next) => {
    const status = err.statusCode || 500;
    logger.error(`request error: ${err.message}`);
    res.status(status).json({ ok: false, error: err.message });
  });

  return { app, config, logger, mqttPublisher };
}

// Jalankan server hanya jika file ini dieksekusi langsung (bukan di-require)
if (require.main === module) {
  const { app, config, logger } = buildApp();
  app.listen(config.server.port, () => {
    logger.info(`API listening on :${config.server.port}`);
  });
}

module.exports = { buildApp };
