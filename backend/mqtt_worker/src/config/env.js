const path = require("path");

const REQUIRED_INFLUX_KEYS = [
  "INFLUX_URL",
  "INFLUX_TOKEN",
  "INFLUX_ORG",
  "INFLUX_BUCKET",
];

function pickDefaultActiveKid(keyring) {
  const kids = Object.keys(keyring)
    .map((kid) => Number(kid))
    .filter((kid) => Number.isInteger(kid) && kid > 0)
    .sort((a, b) => a - b);
  return kids.length > 0 ? kids[0] : null;
}

function parseKeyring(raw) {
  if (!raw || raw.trim().length === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("ASCON_KEYRING_JSON tidak valid (harus JSON object)");
  }
  const keyring = {};
  for (const [kid, keyHex] of Object.entries(parsed)) {
    if (!/^\d+$/.test(String(kid))) {
      throw new Error(`KID '${kid}' tidak valid (harus angka)`);
    }
    if (!/^[0-9a-fA-F]{32}$/.test(String(keyHex))) {
      throw new Error(`Key untuk KID '${kid}' harus hex 32 karakter (128-bit)`);
    }
    keyring[Number(kid)] = String(keyHex).toLowerCase();
  }
  return keyring;
}

function defaultRepoRoot() {
  // worker root: backend/mqtt_worker -> repo root: ../../..
  return path.resolve(__dirname, "..", "..", "..", "..");
}

function loadEnv() {
  const keyring = parseKeyring(process.env.ASCON_KEYRING_JSON || "{}");
  const envActiveKid =
    process.env.ASCON_ACTIVE_KID !== undefined
      ? Number(process.env.ASCON_ACTIVE_KID)
      : null;
  const activeKid =
    envActiveKid && Number.isInteger(envActiveKid) && envActiveKid > 0
      ? envActiveKid
      : pickDefaultActiveKid(keyring);

  const repoRoot = process.env.REPO_ROOT || defaultRepoRoot();
  const dataDir = path.resolve(__dirname, "..", "..", "data");

  const config = {
    mqtt: {
      brokerUrl: process.env.MQTT_BROKER_URL || "mqtt://127.0.0.1:1883",
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
      clientId:
        process.env.MQTT_CLIENT_ID || `backend_mqtt_worker_${Date.now()}`,
      telemetryTopic:
        process.env.MQTT_SUBSCRIBE_TELEMETRY || "devices/+/telemetry",
      deviceAckTopic: process.env.MQTT_SUBSCRIBE_DEVICE_ACK || "devices/+/ack",
      deviceRelayStatusTopic:
        process.env.MQTT_SUBSCRIBE_DEVICE_RELAY_STATUS ||
        "devices/+/relay/status",
      deviceConnectivityStatusTopic:
        process.env.MQTT_SUBSCRIBE_DEVICE_CONNECTIVITY_STATUS ||
        "devices/+/status",
      dashboardCommandTopic:
        process.env.MQTT_SUBSCRIBE_DASHBOARD_COMMAND ||
        "dashboard/devices/+/command",
      deviceCommandTemplate:
        process.env.MQTT_TOPIC_DEVICE_COMMAND_TEMPLATE ||
        "devices/{device_id}/command",
      dashboardStatusTemplate:
        process.env.MQTT_TOPIC_DASHBOARD_STATUS_TEMPLATE ||
        "dashboard/devices/{device_id}/status",
    },
    influx: {
      url: process.env.INFLUX_URL,
      token: process.env.INFLUX_TOKEN,
      org: process.env.INFLUX_ORG,
      bucket: process.env.INFLUX_BUCKET,
      measurement: process.env.INFLUX_MEASUREMENT || "power_telemetry",
      encryptedMeasurement:
        process.env.INFLUX_MEASUREMENT_ENCRYPTED ||
        "power_telemetry_encrypted",
      eventMeasurement:
        process.env.INFLUX_MEASUREMENT_EVENT || "device_event",
      batchSize: Number(process.env.INFLUX_BATCH_SIZE || 50),
      flushIntervalMs: Number(process.env.INFLUX_FLUSH_INTERVAL_MS || 2000),
    },
    crypto: {
      keyring,
      activeKid,
      commandNoncePrefixHex:
        process.env.ASCON_COMMAND_NONCE_PREFIX_HEX || "0000000000000001",
    },
    storage: {
      dataDir,
      replayStateFile: path.join(dataDir, "replay_state.json"),
      counterStateFile: path.join(dataDir, "command_counter.json"),
      deviceRegistryFile:
        process.env.DEVICE_REGISTRY_FILE ||
        path.join(repoRoot, "database", "device_registry", "devices.json"),
    },
    runtime: {
      pendingCommandTimeoutMs: Number(
        process.env.PENDING_COMMAND_TIMEOUT_MS || 8000,
      ),
      // Default OFF: sistem dikunci ke device yang sudah terdaftar (1 socket).
      // Device baru TIDAK otomatis ditambahkan kecuali ALLOW_AUTO_REGISTER=true.
      allowAutoRegister:
        (process.env.ALLOW_AUTO_REGISTER || "false").toLowerCase() === "true",
      healthcheckPort: Number(process.env.WORKER_HEALTHCHECK_PORT || 9101),
    },
  };

  const missing = REQUIRED_INFLUX_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Environment InfluxDB belum lengkap: ${missing.join(", ")}`,
    );
  }
  if (Object.keys(keyring).length === 0) {
    throw new Error("ASCON_KEYRING_JSON wajib diisi minimal 1 key");
  }
  if (!activeKid || !keyring[activeKid]) {
    throw new Error(
      "ASCON_ACTIVE_KID tidak valid atau tidak ditemukan di ASCON_KEYRING_JSON",
    );
  }
  if (!/^[0-9a-fA-F]{16}$/.test(config.crypto.commandNoncePrefixHex)) {
    throw new Error(
      "ASCON_COMMAND_NONCE_PREFIX_HEX harus hex 16 karakter (8 byte)",
    );
  }

  return config;
}

module.exports = { loadEnv };
