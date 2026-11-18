const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolveWakeUtterance, wakeFollowUpMs } = require("../../Jarvis Ui/templates/cloud/lib/wake-word.ts");

test("wake phrase accepts leading Korean and English calls and preserves the command", () => {
  assert.deepEqual(resolveWakeUtterance("Hey, JARVIS! Set a ten-minute timer.", false),
    { kind: "command", text: "Set a ten-minute timer." });
  assert.deepEqual(resolveWakeUtterance(" 헤이 자비스，10분 타이머 ", false),
    { kind: "command", text: "10분 타이머" });
  assert.deepEqual(resolveWakeUtterance("자비스?", false), { kind: "follow-up" });
  assert.deepEqual(resolveWakeUtterance("Jarvis.", false), { kind: "follow-up" });
  for (const text of ["discussion about Jarvis", "My jarvis timer", "JarvisPlus start", "자비스아님", " "]) {
    assert.deepEqual(resolveWakeUtterance(text, false), { kind: "ignore" }, text);
  }
});

test("follow-up accepts a command within the listening window", () => {
  assert.equal(wakeFollowUpMs, 8000);
  assert.deepEqual(resolveWakeUtterance("set a timer", true), { kind: "command", text: "set a timer" });
  assert.deepEqual(resolveWakeUtterance("Jarvis, set a timer", true), { kind: "command", text: "set a timer" });
  assert.deepEqual(resolveWakeUtterance("set a timer", false), { kind: "ignore" });
});
