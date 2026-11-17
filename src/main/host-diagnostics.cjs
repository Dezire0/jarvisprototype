const os = require("node:os");
const { setTimeout: delay } = require("node:timers/promises");

function cpuTotals(cpus) {
  return cpus.reduce(({ total, idle }, { times }) => ({
    total: total + times.user + times.nice + times.sys + times.idle + times.irq,
    idle: idle + times.idle
  }), { total: 0, idle: 0 });
}

function usedPercent(total, idle) {
  if (!Number.isFinite(total) || !Number.isFinite(idle) || total <= 0 || idle < 0 || idle > total) return null;
  return Math.round((total - idle) * 100 / total);
}

function compareCpuReadings(before, after) {
  if (!before.length || before.length !== after.length) return null;
  const first = cpuTotals(before);
  const last = cpuTotals(after);
  return usedPercent(last.total - first.total, last.idle - first.idle);
}

let pending;
function readHostDiagnostics() {
  pending ||= (async () => {
    const before = os.cpus();
    await delay(250);
    return {
      cpuPercent: compareCpuReadings(before, os.cpus()),
      memoryPercent: usedPercent(os.totalmem(), os.freemem())
    };
  })().finally(() => { pending = undefined; });
  return pending;
}

module.exports = { compareCpuReadings, usedPercent, readHostDiagnostics };
