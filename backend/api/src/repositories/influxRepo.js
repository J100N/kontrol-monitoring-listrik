const { InfluxDB } = require("@influxdata/influxdb-client");

// Buang nilai yang mustahil secara fisik (glitch UART PZEM → nilai raksasa spt
// 92 juta W) agar tidak melarkan sumbu-Y grafik. Bersifat PASS-THROUGH: field
// selain yang dibatasi tetap lolos, hanya nilai di luar rentang fisik yang dibuang.
// Batas realistis untuk SOKET rumah (bukan panel), beban nyata jauh di bawahnya:
//   power_w   : 0–5.000 W
//   voltage_v : 0–300 V         (rentang ukur PZEM 80–260 V + kelonggaran)
//   current_a : 0–50 A
//   energy_wh : 0–10.000.000 Wh (akumulator PZEM maks ~9.999,99 kWh)
const SANITY_FILTER = `|> filter(fn: (r) =>
        not (r._field == "power_w"   and (r._value < 0.0 or r._value > 5000.0)) and
        not (r._field == "voltage_v" and (r._value < 0.0 or r._value > 300.0)) and
        not (r._field == "current_a" and (r._value < 0.0 or r._value > 50.0)) and
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

  // Grafik pakai fn: max (bukan mean): puncak tiap jendela dipertahankan sehingga
  // lonjakan singkat-tinggi konsisten di 24J/7H/30H. Dengan mean, lonjakan pendek
  // teratakan saat jendela membesar (rentang panjang) → peak tampil beda antar-rentang.
  //
  // Agregasi 2-TAHAP (penting — performa & kebenaran):
  //   1) aggregateWindow(1m, max) : pra-agregasi halus. Bisa DI-PUSHDOWN ke storage
  //      Influx → cepat. Sekaligus mengisolasi tiap glitch UART (nilai 92 jt W) ke
  //      jendela 1-menit-nya sendiri, terpisah dari puncak asli.
  //   2) SANITY_FILTER : buang HANYA jendela-1m yang berisi sampah. Karena kini
  //      menyentuh ribuan titik hasil tahap-1 (bukan data mentah), tidak mematikan
  //      pushdown → tetap ~0,5 dtk. (Filter di data mentah dulu bikin query 30d 17 dtk
  //      → API timeout → grafik kosong; filter setelah jendela-tampilan malah membuang
  //      seluruh jendela 6 jam yang memuat puncak asli → puncak beda antar-rentang.)
  //   3) aggregateWindow(windowEvery, max) : agregasi ke jendela tampilan (24J=15m,
  //      7H=1h, 30H=6h). Puncak asli selamat → nilai puncak KONSISTEN lintas rentang.
  async function getTelemetryHistory(deviceId, rangeStart, windowEvery) {
    const flux = `from(bucket: "${config.bucket}")
      |> range(start: ${rangeStart})
      |> filter(fn: (r) => r._measurement == "${config.telemetryMeasurement}")
      |> filter(fn: (r) => r.device_id == "${escapeTag(deviceId)}")
      |> filter(fn: (r) => r._field == "power_w" or r._field == "voltage_v" or r._field == "current_a" or r._field == "energy_wh")
      |> aggregateWindow(every: 1m, fn: max, createEmpty: false)
      ${SANITY_FILTER}
      |> aggregateWindow(every: ${windowEvery}, fn: max, createEmpty: false)
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
