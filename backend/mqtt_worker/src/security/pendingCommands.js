// Tracker pending command_id, dipasangkan dengan ACK device. Memicu callback timeout
// supaya dashboard dapat status `command_timeout` saat device tidak menjawab.
function createPendingCommands({ timeoutMs = 8000, onTimeout }) {
  const pending = new Map();

  function add({ deviceId, commandId, command, sourceTopic }) {
    if (pending.has(commandId)) {
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(commandId);
      if (typeof onTimeout === "function") {
        onTimeout({ deviceId, commandId, command, sourceTopic });
      }
    }, timeoutMs);
    pending.set(commandId, {
      deviceId,
      command,
      sourceTopic,
      createdAt: Date.now(),
      timer,
    });
  }

  function resolve(commandId) {
    const entry = pending.get(commandId);
    if (!entry) {
      return null;
    }
    clearTimeout(entry.timer);
    pending.delete(commandId);
    return {
      deviceId: entry.deviceId,
      command: entry.command,
      sourceTopic: entry.sourceTopic,
      latencyMs: Date.now() - entry.createdAt,
    };
  }

  function clearAll() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
    }
    pending.clear();
  }

  return { add, resolve, clearAll, size: () => pending.size };
}

module.exports = { createPendingCommands };
