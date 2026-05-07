const test = require("node:test");
const assert = require("node:assert/strict");

const {
  message,
  normalizeLanguage
} = require("../../src/main/i18n/messages.cjs");

test("normalizeLanguage maps Korean variants to ko and defaults others to en", () => {
  assert.equal(normalizeLanguage("ko"), "ko");
  assert.equal(normalizeLanguage("ko-KR"), "ko");
  assert.equal(normalizeLanguage("en"), "en");
  assert.equal(normalizeLanguage("fr"), "en");
});

test("message returns localized arrays for progress steps", () => {
  const koSteps = message("ko", "progress.browser");
  const enSteps = message("en", "progress.browser");

  assert.ok(Array.isArray(koSteps));
  assert.ok(Array.isArray(enSteps));
  assert.match(koSteps[0], /OpenClaw 세션/);
  assert.match(enSteps[0], /OpenClaw is checking/);
});

test("message interpolates runtime error placeholders", () => {
  const koText = message("ko", "runtime.invalidJsonStop", { error: "bad json" });
  const enText = message("en", "runtime.invalidJsonStop", { error: "bad json" });

  assert.match(koText, /bad json/);
  assert.match(enText, /bad json/);
  assert.match(enText, /valid JSON plan/);
});
