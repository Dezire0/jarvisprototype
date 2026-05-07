const test = require("node:test");
const assert = require("node:assert/strict");

const { createAutomationAdapter } = require("../../src/main/platform-adapters.cjs");

test("createAutomationAdapter keeps the compatibility export surface", () => {
  const adapter = createAutomationAdapter();

  assert.equal(typeof createAutomationAdapter, "function");
  assert.equal(typeof adapter.getCapabilities, "function");
  assert.equal(typeof adapter.execute, "function");
  assert.equal(typeof adapter.describeCurrentContext, "function");
});
