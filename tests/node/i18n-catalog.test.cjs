const test = require("node:test");
const assert = require("node:assert/strict");

const catalog = require("../../src/shared/jarvis-messages.json");
const { message } = require("../../src/main/i18n/messages.cjs");

test("shared i18n catalog contains matching runtime sensitive action keys for en and ko", () => {
  assert.equal(typeof catalog.en.runtime.sensitiveFinalActionLabel, "string");
  assert.equal(typeof catalog.ko.runtime.sensitiveFinalActionLabel, "string");
});

test("shared i18n catalog interpolation resolves sensitive action labels", () => {
  assert.equal(
    message("en", "runtime.sensitiveFinalActionLabel", { label: "Place order" }),
    "This looks like a sensitive final action: Place order"
  );
  assert.equal(
    message("ko", "runtime.sensitiveFinalActionLabel", { label: "결제 버튼" }),
    "이 동작은 민감한 최종 행동으로 보여요: 결제 버튼"
  );
});
