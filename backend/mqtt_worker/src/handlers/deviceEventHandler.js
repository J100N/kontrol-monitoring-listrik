const { publishDashboardStatus } = require("./telemetryHandler");

function parseJsonSafe(raw) {
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function extractDeviceIdFromTopic(topic) {
  const parts = topic.split("/");
  return parts.length >= 2 ? parts[1] : "unknown_device";
}

function isAutoControlAck(commandId) {
  return typeof commandId === "string" && commandId.startsWith("auto-");
}

async function handleDeviceAckMessage({
  topic,
  payloadBuffer,
  mqttClient,
  config,
  influxWriter,
  validators,
  registry,
  pendingCommands,
}) {
  const raw = payloadBuffer.toString("utf8");
  const parsed = parseJsonSafe(raw);

  if (!parsed.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: extractDeviceIdFromTopic(topic),
      status: "error",
      channel: "manual_control",
      event_type: "ack_parse_failed",
      reason: `JSON ack invalid: ${parsed.error}`,
      topic,
    });
    return;
  }

  const ack = parsed.data || {};
  const ackCheck = validators.validateAck(ack);
  if (!ackCheck.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: ack.device_id || extractDeviceIdFromTopic(topic),
      status: "error",
      channel: "manual_control",
      event_type: "ack_invalid",
      reason: ackCheck.reason,
      topic,
    });
    return;
  }

  const deviceId = ack.device_id || extractDeviceIdFromTopic(topic);
  const channel = isAutoControlAck(ack.command_id)
    ? "auto_control"
    : "manual_control";

  const matched = pendingCommands.resolve(ack.command_id);
  registry.touchSeen(deviceId, true);

  await influxWriter.writeDeviceEvent({
    device_id: deviceId,
    event_type: "command_ack",
    channel,
    status: ack.status,
    message: ack.message,
    command_id: ack.command_id,
    latency_ms: matched?.latencyMs,
    ts: Date.now(),
  });

  await publishDashboardStatus(mqttClient, config, {
    device_id: deviceId,
    status: ack.status || "ok",
    channel,
    event_type: "command_ack",
    reason: ack.message || "ack diterima dari device",
    topic,
    ts: Date.now(),
    command_id: ack.command_id,
    latency_ms: matched?.latencyMs,
  });

  // Jika ACK menandakan PENOLAKAN KRIPTO oleh perangkat (perintah palsu/diubah/
  // replay dari penyerang gagal verifikasi ASCON), catat juga ke Log Keamanan —
  // konsisten dengan pencatatan tampering pada jalur telemetri (monitoring). Ini
  // adalah replay/tampering PERINTAH yang bermakna (mengendalikan aktuator).
  // event_type mengandung "reject" agar dipetakan ke kategori SEC di dashboard.
  // Tiga jenis penolakan yang dilaporkan firmware lewat ACK error:
  //   - "format command"  → payload tidak valid  (injeksi)
  //   - "decrypt command" → tag ASCON tidak cocok (palsu/diubah)
  //   - "replay command"  → tag SAH tapi counter basi (replay)
  // Yang terakhir penting dan mudah terlewat: envelope hasil rekaman punya tag ASCON
  // yang SAH, jadi ia lolos dekripsi dan HANYA tertangkap oleh perbandingan counter di
  // firmware. Tanpa cabang ini, ACK-nya jatuh ke command_ack biasa dan serangan replay
  // tidak muncul sama sekali di Log Keamanan.
  // event_type mengandung "reject" agar dipetakan ke kategori SEC di dashboard.
  const ackMsg = (ack.message || "").toLowerCase();
  const isInjection = ackMsg.includes("format command");
  const isReplay    = ackMsg.includes("replay command");
  const isTamper    = ackMsg.includes("decrypt command");
  if (ack.status === "error" && (isInjection || isReplay || isTamper)) {
    let eventType = "security_command_tamper_rejected";
    let message   = "Perintah diubah ditolak";
    if (isInjection) {
      eventType = "security_command_injection_rejected";
      message   = "Perintah tidak valid ditolak";
    } else if (isReplay) {
      eventType = "security_command_replay_rejected";
      message   = "Perintah lama diputar ulang ditolak";
    }
    try {
      await influxWriter.writeDeviceEvent({
        device_id: deviceId,
        event_type: eventType,
        channel: "security",
        status: "error",
        message,
        command_id: ack.command_id,
        ts: Date.now(),
      });
    } catch (_err) {
      // Best-effort: gagal menulis audit tidak boleh mengganggu alur ACK.
    }
  }
}

async function handleDeviceRelayStatusMessage({
  topic,
  payloadBuffer,
  mqttClient,
  config,
  influxWriter,
  validators,
  registry,
}) {
  const raw = payloadBuffer.toString("utf8");
  const parsed = parseJsonSafe(raw);

  if (!parsed.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: extractDeviceIdFromTopic(topic),
      status: "error",
      channel: "device_state",
      event_type: "relay_status_parse_failed",
      reason: `JSON relay status invalid: ${parsed.error}`,
      topic,
    });
    return;
  }

  const relayStatus = parsed.data || {};
  const statusCheck = validators.validateStatus(relayStatus);
  if (!statusCheck.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: relayStatus.device_id || extractDeviceIdFromTopic(topic),
      status: "error",
      channel: "device_state",
      event_type: "relay_status_invalid",
      reason: statusCheck.reason,
      topic,
    });
    return;
  }

  const deviceId = relayStatus.device_id || extractDeviceIdFromTopic(topic);
  registry.touchSeen(deviceId, true);
  // Simpan status relay aktual ke registry agar dashboard tampil benar saat reload.
  registry.setRelay(deviceId, relayStatus.status === "ON");

  await influxWriter.writeDeviceEvent({
    device_id: deviceId,
    event_type: "relay_status",
    channel: "device_state",
    status: relayStatus.status,
    message: `relay -> ${relayStatus.status}`,
    ts: Date.now(),
  });

  await publishDashboardStatus(mqttClient, config, {
    device_id: deviceId,
    status: "ok",
    channel: "device_state",
    event_type: "relay_status_update",
    reason: `relay status: ${relayStatus.status || "UNKNOWN"}`,
    topic,
    ts: Date.now(),
    relay_status: relayStatus.status,
  });
}

async function handleDeviceConnectivityStatusMessage({
  topic,
  payloadBuffer,
  mqttClient,
  config,
  influxWriter,
  validators,
  registry,
}) {
  const raw = payloadBuffer.toString("utf8");
  const parsed = parseJsonSafe(raw);

  if (!parsed.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: extractDeviceIdFromTopic(topic),
      status: "error",
      channel: "device_state",
      event_type: "connectivity_status_parse_failed",
      reason: `JSON connectivity status invalid: ${parsed.error}`,
      topic,
    });
    return;
  }

  const connStatus = parsed.data || {};
  const statusCheck = validators.validateStatus(connStatus);
  if (!statusCheck.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: connStatus.device_id || extractDeviceIdFromTopic(topic),
      status: "error",
      channel: "device_state",
      event_type: "connectivity_status_invalid",
      reason: statusCheck.reason,
      topic,
    });
    return;
  }

  const deviceId = connStatus.device_id || extractDeviceIdFromTopic(topic);
  const onlineFlag = connStatus.status === "ONLINE";
  registry.touchSeen(deviceId, onlineFlag);

  await influxWriter.writeDeviceEvent({
    device_id: deviceId,
    event_type: "connectivity",
    channel: "device_state",
    status: connStatus.status,
    message: `connectivity -> ${connStatus.status}`,
    ts: Date.now(),
  });

  await publishDashboardStatus(mqttClient, config, {
    device_id: deviceId,
    status: "ok",
    channel: "device_state",
    event_type: "connectivity_status_update",
    reason: `connectivity status: ${connStatus.status || "UNKNOWN"}`,
    topic,
    ts: Date.now(),
    connectivity_status: connStatus.status,
  });
}

module.exports = {
  handleDeviceAckMessage,
  handleDeviceRelayStatusMessage,
  handleDeviceConnectivityStatusMessage,
};
