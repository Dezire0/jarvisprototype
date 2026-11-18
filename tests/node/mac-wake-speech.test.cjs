const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { test } = require("node:test");
const { MacWakeSpeech } = require("../../src/main/mac-wake-speech.cjs");

const id = "58313d5e-7fa8-4a7b-b3d8-3a80bba5a0cc";
const otherId = "58313d5e-7fa8-4a7b-b3d8-3a80bba5a0cd";
const request = { id, locale: "ko-KR" };

test("native wake allows one trusted session and waits for capture to stop", { timeout: 5000 }, async (t) => {
  const events = [];
  const ready = Promise.withResolvers();
  let closed = false;
  const service = new MacWakeSpeech("/fixture", (binary, args, options) => {
    assert.equal(binary, "/fixture");
    assert.deepEqual(args, ["--listen", "ko-KR"]);
    const child = spawn(process.execPath, ["-e", `
      const send = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
      process.stdin.on("end", () => {
        send({ type: "transcript", text: "late result" });
        setTimeout(() => process.exit(0), 25);
      }).resume();
      send({ type: "ready" });
      send({ type: "transcript", text: "자비스" });
    `], options);
    child.once("close", () => { closed = true; });
    return child;
  });
  t.after(() => service.stop());
  const send = (event) => {
    events.push(event);
    if (event.type === "transcript") ready.resolve();
  };
  assert.deepEqual(service.start(request, () => false, send), { ok: false, reason: "unavailable" });
  assert.deepEqual(service.start({ ...request, locale: "zz-ZZ" }, () => true, send), { ok: false, reason: "unavailable" });
  assert.deepEqual(service.start(request, () => true, send), { ok: true });
  await ready.promise;
  assert.deepEqual(service.start({ ...request, id: otherId }, () => true, send), { ok: false, reason: "busy" });
  await service.stop(otherId);
  assert.equal(closed, false);
  await service.stop(id);
  assert.equal(closed, true);
  assert.deepEqual(events, [{ id, type: "ready" }, { id, type: "transcript", text: "자비스" }, { id, type: "end" }]);
});

test("native wake drops transcripts after losing the trusted window", { timeout: 5000 }, async (t) => {
  let child;
  let visible = true;
  const events = [];
  const service = new MacWakeSpeech("/fixture", (_binary, _args, options) => {
    child = spawn(process.execPath, ["-e", `
      process.stdin.on("end", () => process.exit(0)).resume();
      process.stdout.write('{"type":"ready"}\\n{"type":"transcript","text":"private speech"}\\n');
    `], options);
    return child;
  });
  t.after(() => service.stop());
  assert.deepEqual(service.start(request, () => visible, (event) => {
    events.push(event);
    visible = false;
  }), { ok: true });
  await once(child, "close");
  assert.deepEqual(events, [{ id, type: "ready" }, { id, type: "end" }]);
});

test("native wake closes even when a hidden window receives no more speech", { timeout: 5000 }, async (t) => {
  let child;
  let visible = true;
  const service = new MacWakeSpeech("/fixture", (_binary, _args, options) => {
    child = spawn(process.execPath, ["-e", `
      process.stdin.on("end", () => process.exit(0)).resume();
      process.stdout.write('{"type":"ready"}\\n');
    `], options);
    return child;
  });
  t.after(() => service.stop());
  assert.deepEqual(service.start(request, () => visible, (event) => {
    if (event.type === "ready") visible = false;
  }), { ok: true });
  assert.deepEqual(await once(child, "close"), [0, null]);
});

test("native wake reports an unexpected exit without sending raw process details", { timeout: 5000 }, async (t) => {
  let child;
  const events = [];
  const service = new MacWakeSpeech("/fixture", (_binary, _args, options) => {
    child = spawn(process.execPath, ["-e", "process.exit(0)"], options);
    return child;
  });
  t.after(() => service.stop());
  assert.deepEqual(service.start(request, () => true, (event) => events.push(event)), { ok: true });
  await once(child, "close");
  assert.deepEqual(events, [{ id, type: "error", reason: "unavailable" }, { id, type: "end" }]);
});
