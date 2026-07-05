const { loadJson, saveJsonAtomic } = require("./stateFile");

// Counter terenkripsi per device, persisted agar restart worker tidak mundur.
function createCommandCounter({ stateFilePath }) {
  const state = loadJson(stateFilePath, {});

  function flush() {
    saveJsonAtomic(stateFilePath, state);
  }

  function next(deviceId) {
    const seed = Date.now() * 1000;
    const current = state[deviceId];
    const candidate = current === undefined ? seed : current + 1;
    const value = candidate < seed ? seed : candidate;
    state[deviceId] = value;
    flush();
    return value;
  }

  return { next, flush, snapshot: () => ({ ...state }) };
}

module.exports = { createCommandCounter };
