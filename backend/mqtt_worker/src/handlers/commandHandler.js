const { publishDashboardStatus, mqttPublish } = require("./telemetryHandler");
const { encryptCommandEnvelope } = require("./asconAead128");

function parseJsonSafe(raw) {
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Forward command terenkripsi dari dashboard ke device + simpan pending agar
// ack dapat dipasangkan, atau muncul timeout bila device tidak menjawab.
async function handleDashboardCommandMessage({
  topic,
  payloadBuffer,
  mqttClient,
  config,
  validators,
  registry,
  commandCounter,
  pendingCommands,
}) {
  const raw = payloadBuffer.toString("utf8");
  const parsed = parseJsonSafe(raw);

  if (!parsed.ok) {
    await publishDashboardStatus(mqttClient, config, {
      status: "error",
      channel: "manual_control",
      event_type: "command_parse_failed",
      reason: `JSON command invalid: ${parsed.error}`,
      topic,
    });
    return;
  }

  const commandPayload = parsed.data;
  const commandCheck = validators.validateDashboardCommand(commandPayload);
  if (!commandCheck.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: commandPayload?.device_id,
      status: "error",
      channel: "manual_control",
      event_type: "command_invalid",
      reason: commandCheck.reason,
      topic,
    });
    return;
  }

  if (!registry.exists(commandPayload.device_id)) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: commandPayload.device_id,
      status: "error",
      channel: "manual_control",
      event_type: "command_unknown_device",
      reason: "device_id belum terdaftar di registry",
      topic,
    });
    return;
  }

  const deviceTopic = config.mqtt.deviceCommandTemplate.replace(
    "{device_id}",
    commandPayload.device_id,
  );

  const commandId = commandPayload.command_id || `cmd_${Date.now()}`;

  let encryptedEnvelope;
  try {
    encryptedEnvelope = encryptCommandEnvelope({
      keyring: config.crypto.keyring,
      kid: config.crypto.activeKid,
      deviceId: commandPayload.device_id,
      commandId,
      // Firmware mengenali perintah huruf kecil (relay_on/relay_off/relay_toggle/ping).
      // Dashboard mengirim huruf besar (RELAY_ON/RELAY_OFF) → samakan ke lowercase.
      command: commandPayload.command.toLowerCase(),
      counter: commandCounter.next(commandPayload.device_id),
      noncePrefixHex: config.crypto.commandNoncePrefixHex,
    });
  } catch (error) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: commandPayload.device_id,
      status: "error",
      channel: "manual_control",
      event_type: "command_encrypt_failed",
      reason: `encrypt command gagal: ${error.message}`,
      topic,
    });
    return;
  }

  const forwardPayload = JSON.stringify(encryptedEnvelope);

  try {
    await mqttPublish(mqttClient, deviceTopic, forwardPayload, {
      qos: 1,
      retain: false,
    });
  } catch (error) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: commandPayload.device_id,
      status: "error",
      channel: "manual_control",
      event_type: "command_publish_failed",
      reason: `publish command ke device gagal: ${error.message}`,
      topic,
    });
    return;
  }

  pendingCommands.add({
    deviceId: commandPayload.device_id,
    commandId,
    command: commandPayload.command,
    sourceTopic: topic,
  });

  await publishDashboardStatus(mqttClient, config, {
    device_id: commandPayload.device_id,
    status: "ok",
    channel: "manual_control",
    event_type: "command_forwarded",
    reason: "command terenkripsi diteruskan ke device",
    topic,
    ts: Date.now(),
    command_id: commandId,
  });
}

module.exports = { handleDashboardCommandMessage };
