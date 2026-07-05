// Auto-discovery: deteksi device baru dari topic publish, registrasi sementara
// dengan flag pending_provisioning agar dashboard menampilkan wizard penyelesaian.
function createDeviceDiscovery({ registry, allowAutoRegister = true, logger }) {
  function isPendingProvisioning(deviceId) {
    const dev = registry.get(deviceId);
    return Boolean(dev && dev.pending_provisioning);
  }

  function ingest(deviceId, source) {
    if (!deviceId || typeof deviceId !== "string") {
      return { ok: false, reason: "device_id tidak valid" };
    }
    if (registry.exists(deviceId)) {
      registry.touchSeen(deviceId, true);
      return { ok: true, status: "known" };
    }
    if (!allowAutoRegister) {
      logger?.warn?.(
        `[discovery] tolak device tidak terdaftar: ${deviceId} via ${source}`,
      );
      return { ok: false, reason: "device tidak terdaftar dan auto-register off" };
    }
    registry.upsert({
      device_id: deviceId,
      label: deviceId,
      room: "Belum diset",
      mode: "manual",
      pending_provisioning: true,
      online: true,
      last_seen_at: Date.now(),
    });
    logger?.info?.(`[discovery] registrasi otomatis device baru: ${deviceId}`);
    return { ok: true, status: "auto_registered" };
  }

  return { ingest, isPendingProvisioning };
}

module.exports = { createDeviceDiscovery };
