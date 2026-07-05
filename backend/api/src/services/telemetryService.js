const ALLOWED_RANGES = {
  "15m": "-15m",
  "1h": "-1h",
  "6h": "-6h",
  "24h": "-24h",
  "7d": "-7d",
  "30d": "-30d",
};

const RANGE_TO_WINDOW = {
  "15m": "10s",
  "1h": "1m",
  "6h": "5m",
  "24h": "15m",
  "7d": "1h",
  "30d": "6h",
};

function createTelemetryService({ influxRepo }) {
  function resolveRange(rangeKey) {
    const key = ALLOWED_RANGES[rangeKey] ? rangeKey : "1h";
    return {
      rangeStart: ALLOWED_RANGES[key],
      windowEvery: RANGE_TO_WINDOW[key],
      key,
    };
  }

  async function getLatest(deviceId) {
    return influxRepo.getLatestTelemetry(deviceId);
  }

  async function getHistory(deviceId, rangeKey) {
    const { rangeStart, windowEvery, key } = resolveRange(rangeKey);
    const rows = await influxRepo.getTelemetryHistory(
      deviceId,
      rangeStart,
      windowEvery,
    );
    return { range: key, points: rows };
  }

  async function getEvents(deviceId, rangeKey, limit) {
    const { rangeStart, key } = resolveRange(rangeKey);
    const rows = await influxRepo.getDeviceEvents(deviceId, rangeStart, limit);
    return { range: key, events: rows };
  }

  return { getLatest, getHistory, getEvents };
}

module.exports = { createTelemetryService };
