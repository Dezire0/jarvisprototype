const test = require("node:test");
const assert = require("node:assert/strict");
const { homedir } = require("node:os");

const {
  loadAssistantConfig,
  resetAssistantConfigCache
} = require("../../src/main/config-loader.cjs");

test("loadAssistantConfig expands home placeholders and freezes shared config", () => {
  resetAssistantConfigCache();
  const config = loadAssistantConfig();

  assert.equal(config.apps.searchDirs.includes(`${homedir()}/Applications`), true);
  assert.equal(config.finderLocations.aliases.home, homedir());
  assert.throws(() => {
    config.apps.searchDirs.push("/tmp/test");
  });
});

test("loadAssistantConfig caches the same object instance", () => {
  resetAssistantConfigCache();
  const first = loadAssistantConfig();
  const second = loadAssistantConfig();
  assert.equal(first, second);
});
