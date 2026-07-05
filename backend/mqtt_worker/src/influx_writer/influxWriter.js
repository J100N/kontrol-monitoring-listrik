const { InfluxDB, Point } = require("@influxdata/influxdb-client");

// Batas epoch ms minimal yang dianggap waktu nyata (1 Jan 2020).
// Kalau firmware belum sinkron NTP, ts bisa berupa uptime (angka kecil) yang
// kalau dipakai apa adanya membuat data jatuh ke tahun 1970 dan TIDAK muncul
// di dashboard (query memakai rentang -1h/-24h). Pakai waktu server sebagai gantinya.
const MIN_VALID_EPOCH_MS = 1577836800000;

function safeTimestamp(ts) {
  return ts >= MIN_VALID_EPOCH_MS ? new Date(ts) : new Date();
}

// Influx writer pakai batched write untuk produksi, dengan flush periodik.
function createInfluxWriter(influxConfig) {
  const influx = new InfluxDB({
    url: influxConfig.url,
    token: influxConfig.token,
  });

  const writeApi = influx.getWriteApi(
    influxConfig.org,
    influxConfig.bucket,
    "ms",
    {
      batchSize: influxConfig.batchSize ?? 50,
      flushInterval: influxConfig.flushIntervalMs ?? 2000,
      maxRetries: 3,
    },
  );
  writeApi.useDefaultTags({ source: "mqtt_worker" });

  async function writeTelemetry(telemetry) {
    const point = new Point(influxConfig.measurement)
      .tag("device_id", telemetry.device_id)
      .floatField("voltage_v", telemetry.voltage_v)
      .floatField("current_a", telemetry.current_a)
      .floatField("power_w", telemetry.power_w)
      .floatField("energy_wh", telemetry.energy_wh)
      .floatField("frequency_hz", telemetry.frequency_hz)
      .floatField("power_factor", telemetry.power_factor)
      .intField("alarm", telemetry.alarm)
      .timestamp(safeTimestamp(telemetry.ts));

    writeApi.writePoint(point);
  }

  // Tulis satu sampel dari batch firmware (kunci pendek: v, i, p, e, f, pf, alarm).
  async function writeTelemetrySample(deviceId, sample) {
    const point = new Point(influxConfig.measurement)
      .tag("device_id", deviceId)
      .floatField("voltage_v", sample.v)
      .floatField("current_a", sample.i)
      .floatField("power_w", sample.p)
      .floatField("energy_wh", sample.e)
      .floatField("frequency_hz", sample.f)
      .floatField("power_factor", sample.pf)
      .intField("alarm", sample.alarm)
      .timestamp(safeTimestamp(sample.ts));

    writeApi.writePoint(point);
  }

  async function writeEncryptedEnvelope(envelope, sourceTopic) {
    const point = new Point(influxConfig.encryptedMeasurement)
      .tag("device_id", envelope.device_id)
      .tag("source_topic", sourceTopic)
      .intField("enc", envelope.enc)
      .intField("kid", envelope.kid)
      .stringField("ctr", String(envelope.ctr))
      .stringField("nonce", envelope.nonce)
      .stringField("tag", envelope.tag)
      .stringField("cipher", envelope.cipher)
      .timestamp(new Date());

    writeApi.writePoint(point);
  }

  // Histori event device (relay, ack, connectivity, command timeout) supaya halaman
  // detail device dapat menampilkan timeline tanpa harus replay MQTT.
  async function writeDeviceEvent(event) {
    const point = new Point(influxConfig.eventMeasurement)
      .tag("device_id", event.device_id)
      .tag("event_type", event.event_type)
      .tag("channel", event.channel || "device_state")
      .stringField("status", event.status || "ok")
      .stringField("message", event.message || "")
      .timestamp(new Date(event.ts || Date.now()));

    if (event.command_id) {
      point.stringField("command_id", event.command_id);
    }
    if (typeof event.latency_ms === "number") {
      point.intField("latency_ms", event.latency_ms);
    }
    writeApi.writePoint(point);
  }

  async function flush() {
    await writeApi.flush();
  }

  async function close() {
    await writeApi.close();
  }

  return {
    writeTelemetry,
    writeTelemetrySample,
    writeEncryptedEnvelope,
    writeDeviceEvent,
    flush,
    close,
  };
}

module.exports = { createInfluxWriter };
