function createDeviceService({ registryRepo, influxRepo }) {
  async function listDevices() {
    const devices = registryRepo.list();
    const enriched = await Promise.all(
      devices.map(async (device) => {
        const latest = await safeLatest(influxRepo, device.device_id);
        return { ...device, latest_telemetry: latest };
      }),
    );
    return enriched;
  }

  async function getDevice(deviceId) {
    const device = registryRepo.get(deviceId);
    if (!device) return null;
    const [latest, energyTotal] = await Promise.all([
      safeLatest(influxRepo, deviceId),
      influxRepo.getLatestEnergyTotal(deviceId).catch(() => null),
    ]);
    return { ...device, latest_telemetry: latest, energy_total_wh: energyTotal };
  }

  function patchDevice(deviceId, patch) {
    const updated = registryRepo.patch(deviceId, patch);
    if (!updated) {
      const err = new Error(`device ${deviceId} tidak ditemukan`);
      err.statusCode = 404;
      throw err;
    }
    return updated;
  }

  function setMode(deviceId, mode) {
    return patchDevice(deviceId, { mode });
  }

  function deleteDevice(deviceId) {
    const ok = registryRepo.remove(deviceId);
    if (!ok) {
      const err = new Error(`device ${deviceId} tidak ditemukan`);
      err.statusCode = 404;
      throw err;
    }
  }

  return {
    listDevices,
    getDevice,
    patchDevice,
    setMode,
    deleteDevice,
  };
}

async function safeLatest(influxRepo, deviceId) {
  try {
    return await influxRepo.getLatestTelemetry(deviceId);
  } catch (error) {
    return null;
  }
}

module.exports = { createDeviceService };
