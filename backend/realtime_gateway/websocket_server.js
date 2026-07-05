require("dotenv").config();

const http = require("http");
const mqtt = require("mqtt");
const { WebSocketServer } = require("ws");

const { withTag } = require("../common/helpers/logger");
const {
  DASHBOARD_STATUS_TOPIC,
} = require("../common/constants/topics");

const logger = withTag("realtime");

const config = {
  port: Number(process.env.WS_PORT || 8090),
  brokerUrl: process.env.MQTT_BROKER_URL || "mqtt://127.0.0.1:1883",
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  clientId:
    process.env.MQTT_CLIENT_ID || `realtime_gateway_${Date.now()}`,
  subscribeTopic: process.env.WS_SUBSCRIBE_TOPIC || DASHBOARD_STATUS_TOPIC,
};

// HTTP server hanya untuk healthcheck + upgrade WS. Browser dashboard connect ke
// /ws untuk menerima broadcast event yang dipublish worker ke topic dashboard/*.
const server = http.createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/readyz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "realtime_gateway",
        clients: wss.clients.size,
        ts: Date.now(),
      }),
    );
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

const wss = new WebSocketServer({ server, path: "/ws" });

const mqttClient = mqtt.connect(config.brokerUrl, {
  username: config.username,
  password: config.password,
  clientId: config.clientId,
  clean: true,
  reconnectPeriod: 2000,
});

mqttClient.on("connect", () => {
  logger.info(`mqtt connected: ${config.brokerUrl}`);
  mqttClient.subscribe(config.subscribeTopic, { qos: 1 }, (err) => {
    if (err) logger.error(`subscribe gagal: ${err.message}`);
    else logger.info(`subscribed dashboard status: ${config.subscribeTopic}`);
  });
});

mqttClient.on("error", (err) => logger.error(`mqtt error: ${err.message}`));

mqttClient.on("message", (topic, payload) => {
  const message = {
    topic,
    received_at: Date.now(),
    payload: parsePayload(payload),
  };
  const wireFormat = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(wireFormat);
    }
  }
});

function parsePayload(payload) {
  const raw = payload.toString("utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { raw };
  }
}

wss.on("connection", (socket, req) => {
  const remote = req.socket.remoteAddress;
  logger.info(`ws client connected: ${remote}`);
  socket.send(
    JSON.stringify({
      topic: "system/welcome",
      received_at: Date.now(),
      payload: { ok: true, service: "realtime_gateway" },
    }),
  );
  socket.on("close", () => logger.info(`ws client disconnected: ${remote}`));
});

server.listen(config.port, () => {
  logger.info(`realtime gateway listening on :${config.port} (ws path /ws)`);
});

const shutdown = (signal) => {
  logger.info(`received ${signal}, shutdown`);
  for (const client of wss.clients) client.terminate();
  mqttClient.end(true, () => {
    server.close(() => process.exit(0));
  });
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
