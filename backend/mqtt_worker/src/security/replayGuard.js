const { loadJson, saveJsonAtomic } = require("./stateFile");

// Replay guard: simpan ctr terakhir per device, reject ctr lebih kecil/sama.
function createReplayGuard({ stateFilePath, persistEveryN = 5 }) {
  const state = loadJson(stateFilePath, {});
  let writesSinceFlush = 0;

  function flush() {
    saveJsonAtomic(stateFilePath, state);
    writesSinceFlush = 0;
  }

  function check(deviceId, ctr) {
    if (!Number.isInteger(ctr) || ctr < 0) {
      return { ok: false, reason: "ctr bukan integer >= 0" };
    }
    const last = state[deviceId];
    if (last !== undefined && ctr <= last) {
      return {
        ok: false,
        reason: `ctr replay terdeteksi (last=${last}, incoming=${ctr})`,
      };
    }
    return { ok: true };
  }

  function commit(deviceId, ctr) {
    state[deviceId] = ctr;
    writesSinceFlush += 1;
    if (writesSinceFlush >= persistEveryN) {
      flush();
    }
  }

  return {
    check,
    commit,
    flush,
    snapshot: () => ({ ...state }),
  };
}

module.exports = { createReplayGuard };
