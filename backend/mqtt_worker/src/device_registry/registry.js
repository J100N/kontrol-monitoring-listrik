const { loadJson, saveJsonAtomic } = require("../security/stateFile");

// Sumber kebenaran daftar device fisik. Berkas registry dibagi antara worker dan API
// agar penambahan/penghapusan device langsung terlihat oleh keduanya.
function createDeviceRegistry({ filePath }) {
  let cache = loadInitial(filePath);

  function reload() {
    cache = loadInitial(filePath);
    return cache;
  }

  function list() {
    return Object.values(cache.devices);
  }

  function get(deviceId) {
    return cache.devices[deviceId] || null;
  }

  function exists(deviceId) {
    return Boolean(cache.devices[deviceId]);
  }

  function upsert(device) {
    if (!device || typeof device.device_id !== "string") {
      throw new Error("device.device_id wajib string");
    }
    reload(); // baca file terbaru dulu agar tidak menimpa perubahan dari API
    const now = Date.now();
    const existing = cache.devices[device.device_id];
    cache.devices[device.device_id] = {
      device_id: device.device_id,
      label: device.label || existing?.label || device.device_id,
      room: device.room || existing?.room || "Belum diset",
      mode: device.mode || existing?.mode || "automatic",
      power_threshold_w:
        device.power_threshold_w ?? existing?.power_threshold_w ?? 10,
      pir_timeout_sec:
        device.pir_timeout_sec ?? existing?.pir_timeout_sec ?? 600,
      created_at: existing?.created_at || now,
      updated_at: now,
      last_seen_at: device.last_seen_at ?? existing?.last_seen_at ?? null,
      online: device.online ?? existing?.online ?? false,
      relay_on: device.relay_on ?? existing?.relay_on ?? false,
    };
    persist();
    return cache.devices[device.device_id];
  }

  function touchSeen(deviceId, online) {
    reload(); // baca file terbaru dulu agar tidak menimpa perubahan dari API (mis. mode)
    const entry = cache.devices[deviceId];
    if (!entry) return null;
    entry.last_seen_at = Date.now();
    if (typeof online === "boolean") {
      entry.online = online;
    }
    entry.updated_at = Date.now();
    persist();
    return entry;
  }

  // Simpan status relay aktual (ON/OFF) agar tampil benar di dashboard saat load.
  function setRelay(deviceId, on) {
    reload(); // baca file terbaru dulu (hindari menimpa mode/field yang diubah API)
    const entry = cache.devices[deviceId];
    if (!entry) return null;
    entry.relay_on = Boolean(on);
    entry.updated_at = Date.now();
    persist();
    return entry;
  }

  function remove(deviceId) {
    reload(); // baca file terbaru dulu
    if (!cache.devices[deviceId]) return false;
    delete cache.devices[deviceId];
    persist();
    return true;
  }

  function persist() {
    saveJsonAtomic(filePath, cache);
  }

  return {
    list,
    get,
    exists,
    upsert,
    touchSeen,
    setRelay,
    remove,
    reload,
    snapshot: () => JSON.parse(JSON.stringify(cache)),
  };
}

function loadInitial(filePath) {
  const fallback = { schema_version: 1, devices: {} };
  const data = loadJson(filePath, fallback);
  if (!data || typeof data !== "object" || !data.devices) {
    return fallback;
  }
  return data;
}

module.exports = { createDeviceRegistry };
