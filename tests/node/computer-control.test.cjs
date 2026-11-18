const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  ComputerControl,
  isTrustedDesktopFrame,
  requiresComputerControl,
} = require("../../src/main/computer-control.cjs");

test("computer control is opt-in, durable, and isolated by desktop profile", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jarvis-computer-control-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = new ComputerControl(path.join(directory, "first"));
  const second = new ComputerControl(path.join(directory, "second"));
  await Promise.all([first.load(), second.load()]);
  assert.equal(first.enabled, false);
  await assert.rejects(first.setEnabled("true"), /Choose whether/);
  assert.equal(await first.setEnabled(true), true);
  assert.equal(second.enabled, false);
  assert.equal(first.revision, 1);

  const reopened = new ComputerControl(path.join(directory, "first"));
  await reopened.load();
  assert.equal(reopened.enabled, true);
  const temporary = reopened.filePath + ".tmp";
  await mkdir(temporary);
  await assert.rejects(reopened.setEnabled(false));
  assert.equal(reopened.enabled, true);
  assert.equal(reopened.revision, 0);
  await rm(temporary, { recursive: true });

  const changes = await Promise.all([reopened.setEnabled(false), reopened.setEnabled(true), reopened.setEnabled(false)]);
  assert.deepEqual(changes, [false, true, false]);
  assert.equal(reopened.revision, 3);
  await first.load();
  assert.equal(first.enabled, false);
  await writeFile(first.filePath, JSON.stringify({ version: 2, enabled: true }));
  await first.load();
  assert.equal(first.enabled, false);
});

test("only the owned desktop or exact legacy main frame can use the local permission API", () => {
  const address = "http://127.0.0.1:33407";
  const mainFrame = { url: address + "/" };
  const window = { webContents: { mainFrame } };
  const request = { sender: window.webContents, senderFrame: mainFrame };
  const legacy = "file:///jarvis/renderer/index.html";
  assert.equal(isTrustedDesktopFrame(request, window, address, legacy), true);
  assert.equal(isTrustedDesktopFrame({ ...request, sender: {} }, window, address, legacy), false);
  assert.equal(isTrustedDesktopFrame({ ...request, senderFrame: { ...mainFrame } }, window, address, legacy), false);
  mainFrame.url = "http://127.0.0.1:33408/";
  assert.equal(isTrustedDesktopFrame(request, window, address, legacy), false);
  mainFrame.url = legacy;
  assert.equal(isTrustedDesktopFrame(request, window, address, legacy), true);
  mainFrame.url = "file:///jarvis/renderer/popup.html";
  assert.equal(isTrustedDesktopFrame(request, window, address, legacy), false);
});

test("only the enumerated non-automation tools are available without consent", () => {
  for (const tool of ["app:open", "browser:read", "screen:ocr", "file:read", "obs:start", "project:create", "new:tool"]) {
    assert.equal(requiresComputerControl(tool), true, tool);
  }
  for (const tool of ["auth:session-restore", "ai:ollama-models", "extensions:list", "system:open-external"]) {
    assert.equal(requiresComputerControl(tool), false, tool);
  }
});
