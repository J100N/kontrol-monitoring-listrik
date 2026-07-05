const { InfluxDB } = require("@influxdata/influxdb-client");

// Buang nilai yang mustahil secara fisik (data uji/korup) agar grafik & angka
// tetap wajar. Bersifat PASS-THROUGH: field selain yang dibatasi tetap lolos,
// hanya baris dengan nilai di luar rentang fisik yang dibuang.
// Batas mengikuti kemampuan maksimum sensor PZEM-004T (versi 100A) sehingga
// pengukuran banyak perangkat berdaya besar tetap tertampung:
//   power_w   : 0–25.000 W   (PZEM-004T 100A: maks ~23 kW)
//   voltage_v : 0–300 V      (rentang ukur 80–260 V + kelonggaran)
//   current_a : 0–120 A      (rentang ukur 0–100 A + kelonggaran)
//   energy_wh : 0–10.000.000 Wh (akumulator maks ~9.999,99 kWh)
const SANITY_FILTER = `|> filter(fn: (r) =>
        not (r._field == "power_w"   and (r._value < 0.0 or r._value > 25000.0)) and
        not (r._field == "voltage_v" and (r._value < 0.0 or r._value > 300.0)) and
        not (r._field == "current_a" and (r._value < 0.0 or r._value > 120.0)) and
        not (r._field == "energy_wh" and (r._value < 0.0 or r._value > 10000000.0)))`;

// Read-only client Influx untuk API. Semua query Flux di-encapsulate di sini.
function createInfluxRepo(config) {
  const influx = new InfluxDB({ url: config.url, token: config.token });
  const queryApi = influx.getQueryApi(config.org);

  function runQuery(flux) {
    return new Promise((resolve, reject) => {
      const rows = [];
      queryApi.queryRows(flux, {
        next(row, tableMeta) {
          rows.push(tableMeta.toObject(row));
        },
        error(err) {
          reject(err);
        },
        complete() {
          resolve(rows);
        },
      });
    });
  }

  async function getLatestTelemetry(deviceId) {
    const flux = `from(bucket: "${config.bucket}")
      |> range(start: -1h)
      |> filter(fn: (r) => r._measurement == "${config.telemetryMeasurement}")
      |> filter(fn: (r) => r.device_id == "${escapeTag(deviceId)}")
      ${SANITY_FILTER}
      |> last()`;
    const rows = await runQuery(flux);
    return foldFields(rows);
  }

  async function getTelemetryHistory(deviceId, rangeStart, windowEvery) {
    const flux = `from(bucket: "${config.bucket}")
      |> range(start: ${rangeStart})
      |> filter(fn: (r) => r._measurement == "${config.telemetryMeasurement}")
      |> filter(fn: (r) => r.device_id == "${escapeTag(deviceId)}")
      |> filter(fn: (r) => r._field == "power_w" or r._field == "voltage_v" or r._field == "current_a" or r._field == "energy_wh")
      ${SANITY_FILTER}
      |> aggregateWindow(every: ${windowEvery}, fn: mean, createEmpty: false)
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"])`;
    return runQuery(flux);
  }

  async function getDeviceEvents(deviceId, rangeStart, limit) {
    const flux = `from(bucket: "${config.bucket}")
      |> range(start: ${rangeStart})
      |> filter(fn: (r) => r._measurement == "${config.eventMeasurement}")
      |> filter(fn: (r) => r.device_id == "${escapeTag(deviceId)}")
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: ${Number(limit) || 100})`;
    return runQuery(flux);
  }

  async function getLatestEnergyTotal(deviceId) {
    const flux = `from(bucket: "${config.bucket}")
      |> range(start: -24h)
      |> filter(fn: (r) => r._measurement == "${config.telemetryMeasurement}")
      |> filter(fn: (r) => r.device_id == "${escapeTag(deviceId)}")
      |> filter(fn: (r) => r._field == "energy_wh")
      ${SANITY_FILTER}
      |> last()`;
    const rows = await runQuery(flux);
    return rows[0]?._value ?? null;
  }

  return {
    getLatestTelemetry,
    getTelemetryHistory,
    getDeviceEvents,
    getLatestEnergyTotal,
  };
}

function escapeTag(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "");
}

function foldFields(rows) {
  if (rows.length === 0) return null;
  const folded = { ts: null, device_id: rows[0].device_id };
  for (const row of rows) {
    folded[row._field] = row._value;
    folded.ts = row._time;
  }
  return folded;
}

module.exports = { createInfluxRepo };
