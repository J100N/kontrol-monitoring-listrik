const {
  readRegistry,
  writeRegistry,
} = require("../../../common/helpers/registryFile");

// Repository registry: pintu masuk tunggal API ke devices.json supaya operasi
// list/get/upsert/remove tidak tersebar di banyak service.
function createDeviceRegistryRepo({ filePath }) {
  function load() {
    return readRegistry(filePath);
  }

  function list() {
    const data = load();
    return Object.values(data.devices || {});
  }

  function get(deviceId) {
    const data = load();
    return data.devices[deviceId] || null;
  }

  function upsert(device) {
    const data = load();
    const now = Date.now();
    const existing = data.devices[device.device_id];
    data.devices[device.device_id] = {
      device_id: device.device_id,
      label: device.label || existing?.label || device.device_id,
      room: device.room || existing?.room || "Belum diset",
      mode: device.mode || existing?.mode || "manual",
      power_threshold_w:
        device.power_threshold_w ?? existing?.power_threshold_w ?? 10,
      pir_timeout_sec:
        device.pir_timeout_sec ?? existing?.pir_timeout_sec ?? 600,
      created_at: existing?.created_at || now,
      updated_at: now,
      last_seen_at: existing?.last_seen_at || null,
      online: existing?.online ?? false,
      pending_provisioning: device.pending_provisioning ?? false,
    };
    writeRegistry(filePath, data);
    return data.devices[device.device_id];
  }

  function patch(deviceId, patchObj) {
    const data = load();
    const existing = data.devices[deviceId];
    if (!existing) return null;
    const updated = { ...existing, ...patchObj, updated_at: Date.now() };
    if (patchObj.label || patchObj.room || patchObj.power_threshold_w) {
      updated.pending_provisioning = false;
    }
    data.devices[deviceId] = updated;
    writeRegistry(filePath, data);
    return updated;
  }

  function remove(deviceId) {
    const data = load();
    if (!data.devices[deviceId]) return false;
    delete data.devices[deviceId];
    writeRegistry(filePath, data);
    return true;
  }

  return { list, get, upsert, patch, remove };
}

module.exports = { createDeviceRegistryRepo };
