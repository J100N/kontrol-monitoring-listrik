// Ambang kesegaran status online. Perangkat dianggap OFFLINE bila tidak ada kabar
// (telemetri/status/ack) melebihi ambang ini, MESKIPUN flag `online` di registry
// masih true. Ini menutup bug: saat WiFi labil, LWT "offline" kadang tidak terpicu
// sehingga flag online tersangkut true → dashboard salah menampilkan perangkat
// masih nyala. Telemetri normal tiap 1 detik (heartbeat tetap terkirim walau relay
// OFF), jadi 30 detik = ~30 pesan terlewat — responsif tapi masih toleran terhadap
// WiFi kedip singkat (reconnect ~10-15 dtk). Notifikasi offline di frontend memakai
// ambang yang sama agar badge & notifikasi sinkron.
const ONLINE_FRESHNESS_MS = 30 * 1000;

// Koreksi flag online berdasarkan kesegaran last_seen_at (single source of truth).
function withFreshOnline(device) {
  if (!device) return device;
  const lastSeen = Number(device.last_seen_at) || 0;
  const isFresh = lastSeen > 0 && Date.now() - lastSeen < ONLINE_FRESHNESS_MS;
  return { ...device, online: Boolean(device.online) && isFresh };
}

function createDeviceService({ registryRepo, influxRepo }) {
  async function listDevices() {
    const devices = registryRepo.list();
    const enriched = await Promise.all(
      devices.map(async (device) => {
        const latest = await safeLatest(influxRepo, device.device_id);
        return withFreshOnline({ ...device, latest_telemetry: latest });
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
    return withFreshOnline({
      ...device,
      latest_telemetry: latest,
      energy_total_wh: energyTotal,
    });
  }

  function patchDevice(deviceId, patch) {
    const updated = registryRepo.patch(deviceId, patch);
    if (!updated) {
      const err = new Error(`device ${deviceId} tidak ditemukan`);
      err.statusCode = 404;
      throw err;
    }
    // Koreksi flag online lewat kesegaran last_seen — sama seperti listDevices/getDevice.
    // Tanpa ini, PATCH (ganti label/threshold/mode) mengembalikan record registry mentah
    // yang flag online-nya bisa tersangkut true untuk perangkat mati, lalu frontend
    // memakainya untuk membalik badge kembali ke ONLINE sampai refetch berikutnya.
    return withFreshOnline(updated);
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
