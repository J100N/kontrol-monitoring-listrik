require("dotenv").config();

const mqtt = require("mqtt");
const { InfluxDB } = require("@influxdata/influxdb-client");

const DEVICE_ID = process.env.E2E_DEVICE_ID || "smart_socket";
const DURATION_MS = Number(process.env.E2E_WAIT_MS || 15000);
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://127.0.0.1:1883";
const STRICT_CHECK =
  String(process.env.E2E_STRICT || "false").toLowerCase() === "true";

function parseJsonSafe(raw) {
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function makeTopics(deviceId) {
  return {
    dashboardCommand: `dashboard/devices/${deviceId}/command`,
    dashboardStatus: `dashboard/devices/${deviceId}/status`,
    deviceCommand: `devices/${deviceId}/command`,
    deviceAck: `devices/${deviceId}/ack`,
    relayStatus: `devices/${deviceId}/relay/status`,
    connectivityStatus: `devices/${deviceId}/status`,
    telemetry: `devices/${deviceId}/telemetry`,
  };
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mqttPublish(client, topic, payload) {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 1, retain: false }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function runMqttProbe() {
  const topics = makeTopics(DEVICE_ID);
  const sentCommandIds = new Set();
  const seen = {
    commandEncrypted: false,
    dashboardManualForwarded: false,
    ack: false,
    ackOk: false,
    ackError: false,
    ackErrorMessages: [],
    relayStatus: false,
    connectivityStatus: false,
    telemetryEnvelope: false,
  };

  const client = mqtt.connect(MQTT_BROKER_URL, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clientId: `e2e_live_checker_${Date.now()}`,
    clean: true,
    reconnectPeriod: 0,
    connectTimeout: 10000,
  });

  await new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });

  const watchTopics = Object.values(topics).filter(
    (t) => t !== topics.dashboardCommand,
  );
  await new Promise((resolve, reject) => {
    client.subscribe(watchTopics, { qos: 1 }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  client.on("message", (topic, payloadBuffer) => {
    const raw = payloadBuffer.toString("utf8");
    const parsed = parseJsonSafe(raw);

    if (topic === topics.deviceCommand && parsed.ok) {
      const p = parsed.data;
      if (p && p.enc === 1 && p.nonce && p.tag && p.cipher) {
        seen.commandEncrypted = true;
      }
    }

    if (topic === topics.dashboardStatus && parsed.ok) {
      const p = parsed.data;
      if (
        p &&
        p.channel === "manual_control" &&
        p.event_type === "command_forwarded"
      ) {
        seen.dashboardManualForwarded = true;
      }
    }

    if (topic === topics.deviceAck && parsed.ok) {
      const p = parsed.data;
      if (!p || typeof p.command_id !== "string") {
        return;
      }

      if (!sentCommandIds.has(p.command_id)) {
        return;
      }

      seen.ack = true;
      if (p.status === "ok") {
        seen.ackOk = true;
      } else if (p.status === "error") {
        seen.ackError = true;
        if (typeof p.message === "string" && p.message.length > 0) {
          seen.ackErrorMessages.push(p.message);
        }
      }
    }

    if (topic === topics.relayStatus) {
      seen.relayStatus = true;
    }

    if (topic === topics.connectivityStatus) {
      seen.connectivityStatus = true;
    }

    if (topic === topics.telemetry && parsed.ok) {
      const p = parsed.data;
      if (p && p.enc === 1 && p.nonce && p.tag && p.cipher) {
        seen.telemetryEnvelope = true;
      }
    }
  });

  const cmdOn = {
    device_id: DEVICE_ID,
    command_id: `cmd-e2e-on-${Date.now()}`,
    command: "relay_on",
  };

  const cmdOff = {
    device_id: DEVICE_ID,
    command_id: `cmd-e2e-off-${Date.now()}`,
    command: "relay_off",
  };

  sentCommandIds.add(cmdOn.command_id);
  sentCommandIds.add(cmdOff.command_id);

  await mqttPublish(client, topics.dashboardCommand, JSON.stringify(cmdOn));
  await delay(2000);
  await mqttPublish(client, topics.dashboardCommand, JSON.stringify(cmdOff));

  await delay(DURATION_MS);
  client.end(true);

  return { seen };
}

async function queryInfluxMeasurementExists(measurement) {
  const influxUrl = process.env.INFLUX_URL;
  const influxToken = process.env.INFLUX_TOKEN;
  const influxOrg = process.env.INFLUX_ORG;
  const influxBucket = process.env.INFLUX_BUCKET;

  if (!influxUrl || !influxToken || !influxOrg || !influxBucket) {
    return { ok: false, reason: "config Influx belum lengkap" };
  }

  const influx = new InfluxDB({ url: influxUrl, token: influxToken });
  const queryApi = influx.getQueryApi(influxOrg);

  const flux = `from(bucket: "${influxBucket}")
  |> range(start: -30m)
  |> filter(fn: (r) => r._measurement == "${measurement}")
  |> filter(fn: (r) => r.device_id == "${DEVICE_ID}")
  |> limit(n: 1)`;

  try {
    const rows = await queryApi.collectRows(flux);
    return { ok: rows.length > 0, rows: rows.length };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function main() {
  console.log(`[e2e] start live check for device=${DEVICE_ID}`);
  console.log(`[e2e] mqtt broker=${MQTT_BROKER_URL}`);
  console.log(`[e2e] strict mode=${STRICT_CHECK}`);

  const mqttResult = await runMqttProbe();

  const plainMeasurement = process.env.INFLUX_MEASUREMENT || "power_telemetry";
  const encryptedMeasurement =
    process.env.INFLUX_MEASUREMENT_ENCRYPTED || "power_telemetry_encrypted";

  const influxPlain = await queryInfluxMeasurementExists(plainMeasurement);
  const influxEncrypted =
    await queryInfluxMeasurementExists(encryptedMeasurement);

  const summary = {
    commandEncrypted: mqttResult.seen.commandEncrypted,
    dashboardManualForwarded: mqttResult.seen.dashboardManualForwarded,
    ack: mqttResult.seen.ack,
    ackOk: mqttResult.seen.ackOk,
    ackError: mqttResult.seen.ackError,
    relayStatus: mqttResult.seen.relayStatus,
    connectivityStatus: mqttResult.seen.connectivityStatus,
    telemetryEnvelope: mqttResult.seen.telemetryEnvelope,
    influxPlainMeasurement: influxPlain.ok,
    influxEncryptedMeasurement: influxEncrypted.ok,
  };

  console.log("[e2e] summary:", JSON.stringify(summary, null, 2));

  if (!influxPlain.ok) {
    console.log(
      "[e2e] influx plain detail:",
      influxPlain.reason || influxPlain,
    );
  }
  if (!influxEncrypted.ok) {
    console.log(
      "[e2e] influx encrypted detail:",
      influxEncrypted.reason || influxEncrypted,
    );
  }

  if (mqttResult.seen.ackErrorMessages.length > 0) {
    const uniqueAckErrors = [...new Set(mqttResult.seen.ackErrorMessages)];
    console.log("[e2e] ack error detail:", uniqueAckErrors.join(" | "));
  }

  const requiredKeys = [
    "commandEncrypted",
    "dashboardManualForwarded",
    "ack",
    "ackOk",
  ];

  const optionalKeys = [
    "relayStatus",
    "connectivityStatus",
    "telemetryEnvelope",
    "influxPlainMeasurement",
    "influxEncryptedMeasurement",
  ];

  if (STRICT_CHECK) {
    requiredKeys.push(...optionalKeys);
  }

  const missing = requiredKeys.filter((k) => !summary[k]);
  const missingOptional = optionalKeys.filter((k) => !summary[k]);

  if (missingOptional.length > 0) {
    console.log(
      "[e2e] optional checks not yet satisfied:",
      missingOptional.join(", "),
    );
  }

  if (missing.length > 0) {
    console.log("[e2e] missing checks:", missing.join(", "));
    process.exit(1);
    return;
  }

  console.log("[e2e] PASS: all checks satisfied");
}

main().catch((error) => {
  console.error("[e2e] fatal:", error.message);
  process.exit(1);
});
