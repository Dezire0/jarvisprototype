const assert = require("node:assert/strict");
const { test } = require("node:test");
const { compareCpuReadings, usedPercent } = require("../../src/main/host-diagnostics.cjs");

function cpu(user, idle) {
  return { times: { user, idle, nice: 0, sys: 0, irq: 0 } };
}

test("host usage adds CPU counter deltas across cores and rounds to a percentage", () => {
  const first = [cpu(10, 90), cpu(20, 80)];
  const last = [cpu(30, 170), cpu(60, 140)];
  assert.equal(compareCpuReadings(first, last), 30);
  assert.equal(usedPercent(100, 27), 73);
  assert.equal(usedPercent(100, 100), 0);
  assert.equal(usedPercent(100, 0), 100);
});

test("missing or inconsistent counters return unavailable", () => {
  assert.equal(compareCpuReadings([], []), null);
  assert.equal(compareCpuReadings([cpu(10, 15)], [cpu(10, 15)]), null);
  assert.equal(compareCpuReadings([cpu(10, 15)], [cpu(10, 20), cpu(10, 20)]), null);
  assert.equal(compareCpuReadings([cpu(100, 150)], [cpu(110, 140)]), null);
  assert.equal(usedPercent(Number.NaN, 27), null);
  assert.equal(usedPercent(100, 101), null);
});
