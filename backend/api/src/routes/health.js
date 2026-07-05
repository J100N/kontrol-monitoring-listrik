const express = require("express");

function createHealthRoutes() {
  const router = express.Router();
  router.get("/healthz", (_req, res) =>
    res.json({ ok: true, service: "api", ts: Date.now() }),
  );
  router.get("/readyz", (_req, res) =>
    res.json({ ok: true, service: "api", ts: Date.now() }),
  );
  return router;
}

module.exports = { createHealthRoutes };
