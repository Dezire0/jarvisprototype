const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findOfficialAppFallback,
  getTargetConfig,
  normalizeEntityToken,
  textMentionsToken
} = require("../../src/main/assistant/targets.cjs");

test("assistant targets load config-driven app and web registries", () => {
  const config = getTargetConfig();

  assert.equal(config.directWebTargets.some((entry) => entry.label === "Gmail"), true);
  assert.equal(config.directAppTargets.some((entry) => entry.label === "Discord"), true);
  assert.equal(config.webAliases.has("github"), true);
});

test("findOfficialAppFallback resolves OpenClaw from externalized config", () => {
  const fallback = findOfficialAppFallback("오픈클로");
  assert.equal(fallback.label, "OpenClaw");
  assert.match(fallback.installUrl, /openclaw/i);
});

test("textMentionsToken supports English word boundaries and Korean contains matching", () => {
  assert.equal(textMentionsToken("please open github desktop", "github"), true);
  assert.equal(textMentionsToken("지메일 열어줘", "지메일"), true);
  assert.equal(normalizeEntityToken(" GitHub Desktop "), "githubdesktop");
});
