/* =============================================================================
 * telemetryHandler.js — Proses pesan telemetri dari ESP32
 *
 * Alur lengkap setiap pesan masuk ke topic devices/+/telemetry:
 *   1. Parse JSON payload
 *   2. Validasi schema envelope terenkripsi
 *   3. Cek registry — tolak device tidak dikenal
 *   4. Anti-replay check (counter ctr)
 *   5. Simpan ciphertext mentah ke InfluxDB (arsip audit)
 *   6. Dekripsi payload menggunakan Ascon-AEAD128 (NIST SP 800-232)
 *   7. Validasi schema plaintext
 *   8. Simpan data sensor ke InfluxDB (measurement utama)
 *   9. Commit counter anti-replay
 *  10. Publish status ke dashboard via topic dashboard/devices/{id}/status
 * ========================================================================== */

const { decryptTelemetryEnvelope } = require("./asconAead128");

function parseJsonSafe(raw) {
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Alur telemetry: parse -> validasi envelope -> registry gate -> simpan ciphertext ->
// anti-replay -> dekripsi -> validasi plaintext -> simpan -> publish status dashboard.
async function handleTelemetryMessage({
  topic,
  payloadBuffer,
  influxWriter,
  mqttClient,
  config,
  validators,
  replayGuard,
  registry,
  discovery,
}) {
  const raw = payloadBuffer.toString("utf8");
  const parsed = parseJsonSafe(raw);

  if (!parsed.ok) {
    await publishDashboardStatus(mqttClient, config, {
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_parse_failed",
      reason: `JSON telemetry invalid: ${parsed.error}`,
      topic,
    });
    return;
  }

  const envelope = parsed.data;
  const envelopeCheck = validators.validateEncryptedEnvelope(envelope);
  if (!envelopeCheck.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope?.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_envelope_invalid",
      reason: envelopeCheck.reason,
      topic,
    });
    return;
  }

  const discoveryResult = discovery.ingest(envelope.device_id, "telemetry");
  if (!discoveryResult.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_unknown_device",
      reason: discoveryResult.reason,
      topic,
    });
    return;
  }

  const replayCheck = replayGuard.check(envelope.device_id, envelope.ctr);
  if (!replayCheck.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_replay_blocked",
      reason: replayCheck.reason,
      topic,
    });
    return;
  }

  try {
    await influxWriter.writeEncryptedEnvelope(envelope, topic);
  } catch (error) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "ciphertext_store_failed",
      reason: `simpan ciphertext InfluxDB gagal: ${error.message}`,
      topic,
    });
    return;
  }

  let plaintextRaw;
  try {
    plaintextRaw = decryptTelemetryEnvelope(envelope, config.crypto.keyring);
  } catch (error) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_decrypt_failed",
      reason: `decrypt gagal: ${error.message}`,
      topic,
    });
    return;
  }

  const plainParsed = parseJsonSafe(plaintextRaw);
  if (!plainParsed.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_plaintext_invalid_json",
      reason: `plaintext bukan JSON valid: ${plainParsed.error}`,
      topic,
    });
    return;
  }

  const telemetry = plainParsed.data;
  const telemetryCheck = validators.validatePlainTelemetry(telemetry);
  if (!telemetryCheck.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_plaintext_invalid_schema",
      reason: telemetryCheck.reason,
      topic,
    });
    return;
  }

  // Simpan semua sampel dalam batch ke InfluxDB satu per satu.
  try {
    for (const sample of telemetry.samples) {
      await influxWriter.writeTelemetrySample(telemetry.device_id, sample);
    }
  } catch (error) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: telemetry.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_store_failed",
      reason: `simpan InfluxDB gagal: ${error.message}`,
      topic,
    });
    return;
  }

  replayGuard.commit(envelope.device_id, envelope.ctr);
  registry.touchSeen(envelope.device_id, true);

  // Kirim status dashboard pakai sampel terakhir dari batch.
  const lastSample = telemetry.samples[telemetry.samples.length - 1];
  await publishDashboardStatus(mqttClient, config, {
    device_id: telemetry.device_id,
    status: "ok",
    channel: "monitoring",
    event_type: "telemetry_ingested",
    reason: `batch ${telemetry.samples.length} sampel diterima, didekripsi, tervalidasi, dan tersimpan`,
    topic,
    ts: lastSample.ts,
    power_w: lastSample.p,
    voltage_v: lastSample.v,
    current_a: lastSample.i,
    energy_wh: lastSample.e,
  });
}

async function publishDashboardStatus(mqttClient, config, status) {
  const deviceId = status.device_id || "unknown_device";
  const topic = config.mqtt.dashboardStatusTemplate.replace(
    "{device_id}",
    deviceId,
  );

  const payload = JSON.stringify({
    worker: "mqtt_worker",
    device_id: deviceId,
    status: status.status,
    channel: status.channel || "monitoring",
    event_type: status.event_type || "worker_event",
    reason: status.reason,
    source_topic: status.topic,
    ts: status.ts || Date.now(),
    power_w: status.power_w,
    voltage_v: status.voltage_v,
    current_a: status.current_a,
    energy_wh: status.energy_wh,
    command_id: status.command_id,
    relay_status: status.relay_status,
    connectivity_status: status.connectivity_status,
    latency_ms: status.latency_ms,
  });

  await mqttPublish(mqttClient, topic, payload, { qos: 1, retain: false });
}

function mqttPublish(client, topic, payload, options) {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, options, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

module.exports = {
  handleTelemetryMessage,
  publishDashboardStatus,
  mqttPublish,
};
