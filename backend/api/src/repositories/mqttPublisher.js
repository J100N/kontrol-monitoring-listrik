const mqtt = require("mqtt");
const {
  DASHBOARD_COMMAND_TEMPLATE,
} = require("../../../common/constants/topics");

// API tidak menyentuh device langsung. API publish ke topic dashboard command,
// lalu MQTT worker mengenkripsi & meneruskan ke device. Pemisahan ini menjaga
// agar kunci ASCON hanya dipegang worker.
function createMqttPublisher(config, logger) {
  const client = mqtt.connect(config.brokerUrl, {
    username: config.username,
    password: config.password,
    clientId: config.clientId,
    clean: true,
    reconnectPeriod: 2000,
    connectTimeout: 10_000,
  });

  client.on("connect", () => logger.info(`mqtt publisher connected: ${config.brokerUrl}`));
  client.on("reconnect", () => logger.warn("mqtt publisher reconnecting"));
  client.on("error", (err) => logger.error(`mqtt publisher error: ${err.message}`));

  function publishDashboardCommand({ deviceId, command, commandId, issuedBy }) {
    return new Promise((resolve, reject) => {
      const topic = DASHBOARD_COMMAND_TEMPLATE.replace("{device_id}", deviceId);
      const payload = JSON.stringify({
        device_id: deviceId,
        command,
        command_id: commandId,
        issued_by: issuedBy || "api",
      });
      client.publish(topic, payload, { qos: 1, retain: false }, (err) => {
        if (err) reject(err);
        else resolve({ topic, commandId });
      });
    });
  }

  function close() {
    return new Promise((resolve) => client.end(true, resolve));
  }

  return { publishDashboardCommand, close, client };
}

module.exports = { createMqttPublisher };
