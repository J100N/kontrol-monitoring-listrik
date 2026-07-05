const http = require("http");

// Endpoint kesehatan worker untuk Docker liveness/readiness dan dashboard ops.
function startHealthcheckServer({ port, getStatus }) {
  const server = http.createServer((req, res) => {
    if (req.url !== "/healthz" && req.url !== "/readyz") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, reason: "not_found" }));
      return;
    }
    const status = getStatus();
    const ready = req.url === "/readyz" ? status.mqttConnected : true;
    const payload = {
      ok: ready,
      service: "mqtt_worker",
      ...status,
      ts: Date.now(),
    };
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  // Bind dual-stack (tanpa host eksplisit) agar healthcheck via "localhost"
  // tetap berhasil baik lewat IPv4 (127.0.0.1) maupun IPv6 (::1) — konsisten
  // dengan service api & realtime_gateway. Bind "0.0.0.0" (IPv4-only) membuat
  // healthcheck "localhost" yang resolve ke ::1 ditolak → status unhealthy palsu.
  server.listen(port, () => {
    console.log(`[mqtt-worker] healthcheck http listening on :${port}`);
  });
  return server;
}

module.exports = { startHealthcheckServer };
