/* =============================================================================
 * worker.js — Entry point mqtt_worker
 *
 * Proses Node.js yang berjalan terus-menerus (daemon). Tugas utama:
 *   1. Sambungkan ke broker EMQX via MQTT
 *   2. Subscribe topic telemetri, command, ack, relay status, dan konektivitas
 *   3. Arahkan setiap pesan masuk ke handler yang sesuai
 *   4. Jalankan healthcheck HTTP server untuk Docker liveness probe
 *   5. Flush state dan tutup koneksi saat menerima SIGINT / SIGTERM
 *
 * Jalankan: node src/worker.js  (atau via Docker Compose)
 * ========================================================================== */

require("dotenv").config();

const mqtt = require("mqtt");

const { loadEnv } = require("./config/env");
const { createInfluxWriter } = require("./influx_writer/influxWriter");
const { buildValidators } = require("./handlers/schemaValidator");
const { createReplayGuard } = require("./security/replayGuard");
const { createCommandCounter } = require("./security/commandCounter");
const { createPendingCommands } = require("./security/pendingCommands");
const { createDeviceRegistry } = require("./device_registry/registry");
const { createDeviceDiscovery } = require("./device_discovery/discovery");
const { startHealthcheckServer } = require("./healthcheck");

const {
  handleTelemetryMessage,
  publishDashboardStatus,
} = require("./handlers/telemetryHandler");
const {
  handleDashboardCommandMessage,
} = require("./handlers/commandHandler");
const {
  handleDeviceAckMessage,
  handleDeviceRelayStatusMessage,
  handleDeviceConnectivityStatusMessage,
} = require("./handlers/deviceEventHandler");

async function main() {
  const config = loadEnv();
  const validators = buildValidators();
  const influxWriter = createInfluxWriter(config.influx);
  const registry = createDeviceRegistry({
    filePath: config.storage.deviceRegistryFile,
  });
  const discovery = createDeviceDiscovery({
    registry,
    allowAutoRegister: config.runtime.allowAutoRegister,
    logger: console,
  });
  const replayGuard = createReplayGuard({
    stateFilePath: config.storage.replayStateFile,
  });
  const commandCounter = createCommandCounter({
    stateFilePath: config.storage.counterStateFile,
  });

  const mqttClient = mqtt.connect(config.mqtt.brokerUrl, {
    username: config.mqtt.username,
    password: config.mqtt.password,
    clientId: config.mqtt.clientId,
    clean: true,
    reconnectPeriod: 2000,
    connectTimeout: 10_000,
  });

  const pendingCommands = createPendingCommands({
    timeoutMs: config.runtime.pendingCommandTimeoutMs,
    onTimeout: async ({ deviceId, commandId }) => {
      try {
        await influxWriter.writeDeviceEvent({
          device_id: deviceId,
          event_type: "command_timeout",
          channel: "manual_control",
          status: "error",
          message: `command_id=${commandId} tidak menerima ack`,
          command_id: commandId,
          ts: Date.now(),
        });
        await publishDashboardStatus(mqttClient, config, {
          device_id: deviceId,
          status: "error",
          channel: "manual_control",
          event_type: "command_timeout",
          reason: `command_id=${commandId} tidak menerima ack dari device`,
          command_id: commandId,
        });
      } catch (error) {
        console.error(
          `[mqtt-worker] publish command_timeout gagal: ${error.message}`,
        );
      }
    },
  });

  const workerStatus = { mqttConnected: false, lastError: null };
  startHealthcheckServer({
    port: config.runtime.healthcheckPort,
    getStatus: () => ({
      mqttConnected: workerStatus.mqttConnected,
      pendingCommands: pendingCommands.size(),
      registrySize: registry.list().length,
      lastError: workerStatus.lastError,
    }),
  });

  mqttClient.on("connect", async () => {
    workerStatus.mqttConnected = true;
    console.log(`[mqtt-worker] connected to broker ${config.mqtt.brokerUrl}`);
    subscribe(mqttClient, config.mqtt.telemetryTopic, "telemetry");
    subscribe(mqttClient, config.mqtt.dashboardCommandTopic, "dashboard cmd");
    subscribe(mqttClient, config.mqtt.deviceAckTopic, "device ack");
    subscribe(mqttClient, config.mqtt.deviceRelayStatusTopic, "relay status");
    subscribe(
      mqttClient,
      config.mqtt.deviceConnectivityStatusTopic,
      "connectivity",
    );
  });

  mqttClient.on("reconnect", () => {
    workerStatus.mqttConnected = false;
    console.warn("[mqtt-worker] reconnecting...");
  });

  mqttClient.on("close", () => {
    workerStatus.mqttConnected = false;
  });

  mqttClient.on("error", (error) => {
    workerStatus.lastError = error.message;
    console.error(`[mqtt-worker] mqtt error: ${error.message}`);
  });

  mqttClient.on("message", async (topic, payloadBuffer) => {
    try {
      if (topicMatches(topic, config.mqtt.telemetryTopic)) {
        await handleTelemetryMessage({
          topic,
          payloadBuffer,
          influxWriter,
          mqttClient,
          config,
          validators,
          replayGuard,
          registry,
          discovery,
        });
        return;
      }
      if (topicMatches(topic, config.mqtt.dashboardCommandTopic)) {
        await handleDashboardCommandMessage({
          topic,
          payloadBuffer,
          mqttClient,
          config,
          validators,
          registry,
          commandCounter,
          pendingCommands,
        });
        return;
      }
      if (topicMatches(topic, config.mqtt.deviceAckTopic)) {
        await handleDeviceAckMessage({
          topic,
          payloadBuffer,
          mqttClient,
          config,
          influxWriter,
          validators,
          registry,
          pendingCommands,
        });
        return;
      }
      if (topicMatches(topic, config.mqtt.deviceRelayStatusTopic)) {
        await handleDeviceRelayStatusMessage({
          topic,
          payloadBuffer,
          mqttClient,
          config,
          influxWriter,
          validators,
          registry,
        });
        return;
      }
      if (topicMatches(topic, config.mqtt.deviceConnectivityStatusTopic)) {
        await handleDeviceConnectivityStatusMessage({
          topic,
          payloadBuffer,
          mqttClient,
          config,
          influxWriter,
          validators,
          registry,
        });
      }
    } catch (error) {
      workerStatus.lastError = error.message;
      console.error(
        `[mqtt-worker] process message gagal (${topic}): ${error.message}`,
      );
      await publishDashboardStatus(mqttClient, config, {
        status: "error",
        channel: "monitoring",
        event_type: "worker_internal_error",
        reason: `internal worker error: ${error.message}`,
        topic,
      });
    }
  });

  const shutdown = async (signal) => {
    console.log(`[mqtt-worker] received ${signal}, shutdown...`);
    pendingCommands.clearAll();
    try {
      replayGuard.flush();
    } catch (error) {
      console.error(`[mqtt-worker] flush replay state gagal: ${error.message}`);
    }
    try {
      commandCounter.flush();
    } catch (error) {
      console.error(`[mqtt-worker] flush counter gagal: ${error.message}`);
    }
    try {
      await influxWriter.close();
    } catch (error) {
      console.error(`[mqtt-worker] close influx gagal: ${error.message}`);
    }
    mqttClient.end(true, () => {
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function subscribe(client, topic, label) {
  client.subscribe(topic, { qos: 1 }, (err) => {
    if (err) {
      console.error(`[mqtt-worker] subscribe ${label} gagal: ${err.message}`);
      return;
    }
    console.log(`[mqtt-worker] subscribed ${label}: ${topic}`);
  });
}

function topicMatches(actualTopic, wildcardTopic) {
  const actualParts = actualTopic.split("/");
  const wildParts = wildcardTopic.split("/");
  if (actualParts.length !== wildParts.length) return false;
  for (let i = 0; i < wildParts.length; i += 1) {
    if (wildParts[i] === "+") continue;
    if (wildParts[i] !== actualParts[i]) return false;
  }
  return true;
}

main().catch((error) => {
  console.error(`[mqtt-worker] fatal: ${error.message}`);
  process.exit(1);
});
