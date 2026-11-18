const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  calculate, emptyWorkspace, formatTimer, LOCAL_COMMAND_EXAMPLE, parseLocalCommand, readWorkspace,
  recordActivity, remainingSeconds, resolveComposerCommand, runLocalCommand,
} = require("../../Jarvis Ui/templates/cloud/lib/local-workspace.ts");

const NOW = Date.UTC(2026, 10, 17, 20);

function execute(input, workspace = emptyWorkspace, now = NOW) {
  const command = parseLocalCommand(input);
  assert.ok(command);
  return runLocalCommand(command, workspace, now, "test-id", "en");
}

test("starts a timer from Korean natural language and English commands", () => {
  assert.deepEqual(parseLocalCommand("자비스, 10분 타이머 맞춰줘"), { kind: "timer", seconds: 600 });
  assert.deepEqual(parseLocalCommand("타이머 1시간 2분 30초"), { kind: "timer", seconds: 3750 });
  assert.deepEqual(parseLocalCommand("set a timer for 30 seconds"), { kind: "timer", seconds: 30 });
  assert.deepEqual(parseLocalCommand("focus"), { kind: "timer", seconds: 1500 });
});

test("every start-screen example resolves to the same local timer", () => {
  for (const example of Object.values(LOCAL_COMMAND_EXAMPLE)) {
    assert.deepEqual(resolveComposerCommand(example, false), { kind: "timer", seconds: 180 });
    assert.equal(resolveComposerCommand(example, true), null);
  }
});

test("the composer keeps structured local operations on the device", () => {
  for (const [text, kind] of [
    ["자비스, 10분 타이머 맞춰줘", "timer"],
    ["focus", "timer"],
    ["타이머 일시 정지", "pause"],
    ["pause timer", "pause"],
    ["save note Review tomorrow", "note"],
    ["note: Review tomorrow", "note"],
    ["메모 월요일 회의", "note"],
    ["add task Review tomorrow", "task"],
    ["calculate 12 / 0", "calculate"],
    ["timer 25 hours", "timer"],
  ]) {
    assert.equal(resolveComposerCommand(text, false)?.kind ?? null, kind, text);
    assert.equal(resolveComposerCommand(text, true), null);
  }
});

test("conversation, multi-line drafts and external actions retain the chat path", () => {
  for (const text of [
    "timer recommendations",
    "note that the meeting was moved",
    "remember how these types work",
    "calculate the annual cost",
    "What is the weather?",
    "search for my site",
    "open gmail",
    "add task Research\nThen discuss the examples",
    "save note " + "a".repeat(601),
  ]) {
    assert.equal(resolveComposerCommand(text, false), null, text);
  }
});

test("the timer survives persistence, expires by deadline, and pauses/resumes from remaining time", () => {
  const started = execute("timer 15 seconds").workspace;
  const restored = readWorkspace(JSON.stringify(started));
  assert.equal(remainingSeconds(restored.timer, NOW + 4000), 11);
  const paused = execute("pause timer", restored, NOW + 4000).workspace;
  assert.equal(paused.timer.endsAt, null);
  assert.equal(remainingSeconds(paused.timer, NOW + 20000), 11);
  const resumed = execute("resume timer", paused, NOW + 20000).workspace;
  assert.equal(remainingSeconds(resumed.timer, NOW + 31000), 0);
  assert.equal(formatTimer(remainingSeconds(execute("reset timer", resumed).workspace.timer, NOW)), "00:15");
});

test("invalid durations and missing entries yield failures without updating state", () => {
  for (const command of ["timer", "focus 0", "timer 25 hours", "timer -5 minutes", "complete task 99"]) {
    const output = execute(command);
    assert.equal(output.result.failed, true);
    assert.strictEqual(output.workspace, emptyWorkspace);
  }
  assert.equal(parseLocalCommand("Summarize my last conversation"), null);
});

test("tasks and notes are independently stored and existing records survive invalid saved fields", () => {
  const added = execute("할 일 추가 초안 검토").workspace;
  const noted = execute("메모: 다음 회의 준비", added).workspace;
  const completed = execute("complete task 1", noted).workspace;
  assert.deepEqual(completed.tasks, [{ id: "test-id", text: "초안 검토", done: true }]);
  assert.deepEqual(completed.notes, [{ id: "test-id", text: "다음 회의 준비" }]);
  assert.equal(added.tasks[0].done, false);
  const savedWithBadTimer = readWorkspace(JSON.stringify({ ...completed, timer: { seconds: -1 } }));
  assert.deepEqual(savedWithBadTimer.tasks, completed.tasks);
  assert.equal(savedWithBadTimer.timer.seconds, 1500);
  assert.strictEqual(readWorkspace("malformed"), emptyWorkspace);
});

test("arithmetic handles precedence and rejects invalid or non-finite expressions", () => {
  assert.equal(calculate("-2^2"), -4);
  assert.equal(calculate("2^3^2"), 512);
  assert.equal(calculate("2^-3"), 0.125);
  assert.equal(calculate("(12 + 4) × 3"), 48);
  assert.equal(calculate("0.1 + 0.2"), 0.3);
  for (const invalid of ["1/0", "(2*3", "Date.now()", "1e999", "2 3)"]) {
    assert.throws(() => calculate(invalid));
  }
});

test("shortcuts preserve the allowlist and search terms are encoded", () => {
  assert.equal(execute("open github").result.href, "https://github.com/");
  assert.equal(execute("open unknown").result.failed, true);
  assert.equal(execute("search for art & science").result.href, "https://www.google.com/search?q=art%20%26%20science");
  assert.deepEqual(parseLocalCommand("날씨"), { kind: "weather" });
});

test("spoken-result preferences persist without changing the timer or entries", () => {
  const enabled = execute("speak on").workspace;
  const restored = readWorkspace(JSON.stringify(enabled));
  assert.equal(restored.speakResults, true);
  assert.equal(execute("음성 꺼", restored).workspace.speakResults, false);
  assert.equal(execute("clear result", restored).workspace.speakResults, true);
});

test("activity is bounded, preserves legacy data, and retains only action metadata", () => {
  const { activity: _activity, ...legacy } = emptyWorkspace;
  const restored = readWorkspace(JSON.stringify(legacy));
  assert.deepEqual(restored.activity, []);
  assert.deepEqual(restored.timer, legacy.timer);

  let next = execute("note Private note content", restored).workspace;
  assert.deepEqual(next.activity, [{ id: "test-id", at: NOW, kind: "note" }]);
  for (let index = 0; index < 38; index++) {
    next = recordActivity(next, "timer", NOW + index, String(index));
  }
  assert.equal(next.activity.length, 35);
  assert.equal(next.activity[0].id, "37");
  assert.equal(next.activity.at(-1).id, "3");
  assert.deepEqual(next.notes, [{ id: "test-id", text: "Private note content" }]);
  const original = next.activity;
  const invalid = { id: "test", at: NOW, kind: "unknown", text: "Never retain this" };
  next = readWorkspace(JSON.stringify({ ...next, activity: [invalid, ...original] }));
  assert.deepEqual(next.activity, original);
});
