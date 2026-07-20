function createCommandService({ registryRepo, mqttPublisher }) {
  async function sendControl({ deviceId, command, issuedBy, commandId }) {
    const device = registryRepo.get(deviceId);
    if (!device) {
      const err = new Error(`device ${deviceId} tidak ditemukan`);
      err.statusCode = 404;
      throw err;
    }
    const finalCommandId = commandId || `api-${Date.now()}`;
    await mqttPublisher.publishDashboardCommand({
      deviceId,
      command,
      commandId: finalCommandId,
      issuedBy,
    });
    // Kontrol relay manual → paksa mode MANUAL agar auto-control tidak menimpa.
    registryRepo.patch(deviceId, { mode: "manual" });
    return { device_id: deviceId, command_id: finalCommandId, command };
  }

  // Ganti mode operasi: kirim command mode ke device + simpan ke registry.
  async function sendMode({ deviceId, mode }) {
    const device = registryRepo.get(deviceId);
    if (!device) {
      const err = new Error(`device ${deviceId} tidak ditemukan`);
      err.statusCode = 404;
      throw err;
    }
    const normalized = mode === "auto" ? "auto" : "manual";
    const command = normalized === "auto" ? "mode_auto" : "mode_manual";
    const commandId = `mode-${Date.now()}`;
    await mqttPublisher.publishDashboardCommand({
      deviceId,
      command,
      commandId,
      issuedBy: "dashboard",
    });
    registryRepo.patch(deviceId, { mode: normalized });
    return { device_id: deviceId, mode: normalized };
  }

  // Kirim parameter kontrol otomatis (PIR timeout & threshold daya) ke device.
  // Plaintext command: "config_update:pir=<detik>,thr=<watt>" — firmware mem-parse
  // dan menyimpannya ke NVS. Nilai juga disimpan di registry agar konsisten.
  async function sendConfig({ deviceId, pirTimeoutSec, powerThresholdW }) {
    const device = registryRepo.get(deviceId);
    if (!device) {
      const err = new Error(`device ${deviceId} tidak ditemukan`);
      err.statusCode = 404;
      throw err;
    }
    const pir = Math.round(Number(pirTimeoutSec));
    const thr = Number(powerThresholdW);
    const command = `config_update:pir=${pir},thr=${thr}`;
    const commandId = `cfg-${Date.now()}`;
    await mqttPublisher.publishDashboardCommand({
      deviceId,
      command,
      commandId,
      issuedBy: "dashboard",
    });
    registryRepo.patch(deviceId, {
      pir_timeout_sec: pir,
      power_threshold_w: thr,
    });
    return {
      device_id: deviceId,
      command_id: commandId,
      pir_timeout_sec: pir,
      power_threshold_w: thr,
    };
  }

  // Reset akumulator energi (kWh) pada PZEM perangkat kembali ke 0.
  // Firmware menangani command "reset_energy" (worker me-lowercase-kan otomatis).
  async function sendResetEnergy({ deviceId, issuedBy }) {
    const device = registryRepo.get(deviceId);
    if (!device) {
      const err = new Error(`device ${deviceId} tidak ditemukan`);
      err.statusCode = 404;
      throw err;
    }
    const commandId = `rst-${Date.now()}`;
    await mqttPublisher.publishDashboardCommand({
      deviceId,
      command: "RESET_ENERGY",
      commandId,
      issuedBy: issuedBy || "dashboard",
    });
    return { device_id: deviceId, command_id: commandId, command: "RESET_ENERGY" };
  }

  return { sendControl, sendMode, sendConfig, sendResetEnergy };
}

module.exports = { createCommandService };
