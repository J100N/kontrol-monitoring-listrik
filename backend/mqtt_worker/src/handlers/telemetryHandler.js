/* =============================================================================
 * telemetryHandler.js — Proses pesan telemetri dari ESP32
 *
 * Alur lengkap setiap pesan masuk ke topic devices/+/telemetry:
 *   1. Parse JSON payload
 *   2. Validasi schema envelope terenkripsi
 *   3. Cek registry — tolak device tidak dikenal
 *   4. Anti-replay check (counter ctr)
 *   5. Simpan ciphertext mentah ke InfluxDB (arsip audit)
 *   6. Dekripsi payload menggunakan Ascon-AEAD128 (NIST SP 800-232)
 *   7. Validasi schema plaintext
 *   8. Simpan data sensor ke InfluxDB (measurement utama)
 *   9. Commit counter anti-replay
 *  10. Publish status ke dashboard via topic dashboard/devices/{id}/status
 * ========================================================================== */

const { decryptTelemetryEnvelope } = require("./asconAead128");

function parseJsonSafe(raw) {
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// Alur telemetry: parse -> validasi envelope -> registry gate -> simpan ciphertext ->
// anti-replay -> dekripsi -> validasi plaintext -> simpan -> publish status dashboard.
// Catat event PENOLAKAN KEAMANAN ke measurement device_event (persisten) sebagai
// bukti audit bahwa sistem menolak serangan. Otomatis tampil di Audit Log halaman
// Security karena mapEventCategory memetakan kata "reject"/"replay" ke kategori SEC.
// PENTING: event_type sengaja TIDAK memakai kata "telemetry" (yang akan dipetakan
// ke kategori operasional MQTT). Best-effort: kegagalan menulis audit tidak
// menghentikan penanganan pesan.
async function logSecurityAudit(influxWriter, { deviceId, eventType, message }) {
  try {
    await influxWriter.writeDeviceEvent({
      device_id: deviceId || "unknown_device",
      event_type: eventType,
      channel: "security",
      status: "error",
      message,
      ts: Date.now(),
    });
  } catch (_err) {
    // Sengaja diabaikan: audit gagal ditulis tidak boleh mengganggu alur utama.
  }
}

async function handleTelemetryMessage({
  topic,
  payloadBuffer,
  influxWriter,
  mqttClient,
  config,
  validators,
  replayGuard,
  registry,
  discovery,
}) {
  const raw = payloadBuffer.toString("utf8");
  const parsed = parseJsonSafe(raw);

  // GATE REGISTRY DULU. device_id (dari topik ATAU dari JSON penyerang) dipakai
  // sebagai TAG Influx saat menulis audit — dan tag adalah dimensi seri. Bila audit
  // ditulis sebelum gate ini, penyerang cukud membanjiri devices/<uuid-acak>/telemetry
  // dengan sampah: tiap uuid unik menciptakan seri baru → kardinalitas meledak dan
  // justru merusak DB tempat audit disimpan. Hanya device terdaftar yang boleh
  // menghasilkan baris audit. (Serangan dari device SAH tetap tercatat — memang itu
  // yang ingin dibuktikan; yang ditolak di sini adalah id yang tak dikenal.)
  const topicDeviceId = topic.split("/")[1];

  if (!parsed.ok) {
    await publishDashboardStatus(mqttClient, config, {
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_parse_failed",
      reason: `JSON telemetry invalid: ${parsed.error}`,
      topic,
    });
    if (registry.exists(topicDeviceId)) {
      await logSecurityAudit(influxWriter, {
        deviceId: topicDeviceId,
        eventType: "security_injection_rejected",
        message: "Payload bukan JSON/envelope valid — dugaan injeksi pesan palsu ke topik telemetri, ditolak",
      });
    }
    return;
  }

  const envelope = parsed.data;
  const envelopeCheck = validators.validateEncryptedEnvelope(envelope);
  if (!envelopeCheck.ok) {
    // Untuk id audit, utamakan id topik yang terdaftar; JSON penyerang tak tepercaya.
    const auditId = registry.exists(topicDeviceId)
      ? topicDeviceId
      : (registry.exists(envelope?.device_id) ? envelope.device_id : null);
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope?.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_envelope_invalid",
      reason: envelopeCheck.reason,
      topic,
    });
    if (auditId) {
      await logSecurityAudit(influxWriter, {
        deviceId: auditId,
        eventType: "security_injection_rejected",
        message: "Envelope tidak valid — dugaan injeksi/pesan palsu ke topik telemetri, ditolak",
      });
    }
    return;
  }

  const discoveryResult = discovery.ingest(envelope.device_id, "telemetry");
  if (!discoveryResult.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_unknown_device",
      reason: discoveryResult.reason,
      topic,
    });
    return;
  }

  const replayCheck = replayGuard.check(envelope.device_id, envelope.ctr);
  if (!replayCheck.ok) {
    // ctr <= terakhir → DEDUP OPERASIONAL, bukan peristiwa keamanan, jadi TIDAK dicatat
    // ke Log Keamanan. Sumber dominannya adalah redelivery QoS 1 (perilaku MQTT normal
    // saat koneksi labil): broker mengirim ulang pesan yang PUBACK-nya telat, dan
    // kiriman-ulang itu ber-ctr sama → ditolak agar data tak tersimpan ganda. Dup QoS
    // dan serangan replay TAK TERBEDAKAN dari counter saja, sehingga mencatatnya sebagai
    // "serangan" hanya membanjiri log dengan alarm palsu. Pertahanan replay yang BERMAKNA
    // ada di jalur PERINTAH (mengendalikan relay) dan dicatat DI SANA; di sini cukup senyap.
    const deviceId = envelope.device_id;
    const lastCtr = replayGuard.snapshot()[deviceId];

    // Diagnostik reflash (konsol saja, BUKAN Log Keamanan): ctr JAUH di bawah terakhir →
    // kemungkinan NVS di-erase saat flash. Semua telemetri akan terblokir sampai counter
    // menyusul; peringatkan operator agar reset state anti-replay device ini di server.
    if (typeof lastCtr === "number" && lastCtr - envelope.ctr > 1000) {
      console.warn(
        `[mqtt-worker] counter ${deviceId} jauh di bawah terakhir ` +
          `(last=${lastCtr}, masuk=${envelope.ctr}) — kemungkinan perangkat di-reflash/` +
          `NVS reset; telemetri diblokir anti-replay sampai counter menyusul. ` +
          `Bila memang reflash, reset state anti-replay perangkat ini di server.`,
      );
    }
    return;
  }

  try {
    await influxWriter.writeEncryptedEnvelope(envelope, topic);
  } catch (error) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "ciphertext_store_failed",
      reason: `simpan ciphertext InfluxDB gagal: ${error.message}`,
      topic,
    });
    return;
  }

  let plaintextRaw;
  try {
    plaintextRaw = decryptTelemetryEnvelope(envelope, config.crypto.keyring);
  } catch (error) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_decrypt_failed",
      reason: `decrypt gagal: ${error.message}`,
      topic,
    });
    await logSecurityAudit(influxWriter, {
      deviceId: envelope.device_id,
      eventType: "security_tamper_rejected",
      message: "Verifikasi tag gagal — data diubah/dipalsukan, ditolak (ASCON-AEAD128)",
    });
    return;
  }

  const plainParsed = parseJsonSafe(plaintextRaw);
  if (!plainParsed.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_plaintext_invalid_json",
      reason: `plaintext bukan JSON valid: ${plainParsed.error}`,
      topic,
    });
    return;
  }

  const telemetry = plainParsed.data;
  const telemetryCheck = validators.validatePlainTelemetry(telemetry);
  if (!telemetryCheck.ok) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: envelope.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_plaintext_invalid_schema",
      reason: telemetryCheck.reason,
      topic,
    });
    return;
  }

  // Simpan semua sampel dalam batch ke InfluxDB satu per satu.
  try {
    for (const sample of telemetry.samples) {
      await influxWriter.writeTelemetrySample(telemetry.device_id, sample);
    }
  } catch (error) {
    await publishDashboardStatus(mqttClient, config, {
      device_id: telemetry.device_id,
      status: "error",
      channel: "monitoring",
      event_type: "telemetry_store_failed",
      reason: `simpan InfluxDB gagal: ${error.message}`,
      topic,
    });
    return;
  }

  replayGuard.commit(envelope.device_id, envelope.ctr);
  registry.touchSeen(envelope.device_id, true);

  // Kirim status dashboard pakai sampel terakhir dari batch.
  const lastSample = telemetry.samples[telemetry.samples.length - 1];
  await publishDashboardStatus(mqttClient, config, {
    device_id: telemetry.device_id,
    status: "ok",
    channel: "monitoring",
    event_type: "telemetry_ingested",
    reason: `batch ${telemetry.samples.length} sampel diterima, didekripsi, tervalidasi, dan tersimpan`,
    topic,
    ts: lastSample.ts,
    power_w: lastSample.p,
    voltage_v: lastSample.v,
    current_a: lastSample.i,
    energy_wh: lastSample.e,
  });
}

async function publishDashboardStatus(mqttClient, config, status) {
  const deviceId = status.device_id || "unknown_device";
  const topic = config.mqtt.dashboardStatusTemplate.replace(
    "{device_id}",
    deviceId,
  );

  const payload = JSON.stringify({
    worker: "mqtt_worker",
    device_id: deviceId,
    status: status.status,
    channel: status.channel || "monitoring",
    event_type: status.event_type || "worker_event",
    reason: status.reason,
    source_topic: status.topic,
    ts: status.ts || Date.now(),
    power_w: status.power_w,
    voltage_v: status.voltage_v,
    current_a: status.current_a,
    energy_wh: status.energy_wh,
    command_id: status.command_id,
    relay_status: status.relay_status,
    connectivity_status: status.connectivity_status,
    latency_ms: status.latency_ms,
  });

  await mqttPublish(mqttClient, topic, payload, { qos: 1, retain: false });
}

function mqttPublish(client, topic, payload, options) {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, options, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

module.exports = {
  handleTelemetryMessage,
  publishDashboardStatus,
  mqttPublish,
};
