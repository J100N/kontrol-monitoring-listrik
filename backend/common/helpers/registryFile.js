const fs = require("fs");
const path = require("path");

// API & worker pakai file registry yang sama. Helper ini ringan: read-only untuk API
// (write tetap dilakukan via worker registry module agar atomic).
function readRegistry(filePath) {
  if (!fs.existsSync(filePath)) {
    return { schema_version: 1, devices: {} };
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return { schema_version: 1, devices: {} };
  return JSON.parse(raw);
}

function writeRegistry(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

module.exports = { readRegistry, writeRegistry };
