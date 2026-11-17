const assert = require("node:assert/strict");
const { mkdtemp, readdir, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { LocalWorkspaceStore, isLocalWorkspacePage, registerLocalWorkspaceHandlers } = require("../../src/main/local-workspace-store.cjs");

function workspace(text) {
  return JSON.stringify({ timer: { seconds: 60 }, tasks: [], notes: [{ id: "test", text }] });
}

test("workspace persistence is independent of the local UI port and serializes writes", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jarvis-local-tools-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const store = new LocalWorkspaceStore(directory);
  assert.equal(await store.read(), null);
  const first = store.write(workspace("First update"));
  const second = store.write(workspace("Second update"));
  assert.equal(await store.read(), workspace("Second update"));
  await Promise.all([first, second]);
  assert.equal(await new LocalWorkspaceStore(directory).read(), workspace("Second update"));
  assert.deepEqual(await readdir(directory), ["local-workspace.json"]);
});

test("workspace storage rejects oversized or malformed data and preserves the last valid write", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jarvis-local-tools-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new LocalWorkspaceStore(directory);

  await store.write(workspace("Keep this"));
  await assert.rejects(store.write("{"));
  await assert.rejects(store.write("{}"), /Invalid workspace data/);
  await assert.rejects(store.write("x".repeat(1024 * 1024 + 1)), /Invalid workspace data size/);
  assert.equal(await store.read(), workspace("Keep this"));
});

test("workspace IPC accepts only the current loopback desktop chat and tools routes", () => {
  const desktopUrl = "http://127.0.0.1:18765";
  assert.equal(isLocalWorkspacePage(desktopUrl + "/tools", desktopUrl), true);
  assert.equal(isLocalWorkspacePage(desktopUrl + "/", desktopUrl), true);
  assert.equal(isLocalWorkspacePage(desktopUrl + "/download", desktopUrl), false);
  assert.equal(isLocalWorkspacePage("http://127.0.0.1:18766/tools", desktopUrl), false);
  assert.equal(isLocalWorkspacePage("https://example.invalid/tools", "https://example.invalid"), false);
  assert.equal(isLocalWorkspacePage("file:///tools", "file:///"), false);
  assert.equal(isLocalWorkspacePage(desktopUrl + "/tools", null), false);
});

test("workspace handlers reject another window and child frames for both desktop routes", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jarvis-local-tools-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const desktopUrl = "http://127.0.0.1:18765";
  const mainFrame = { url: desktopUrl + "/" };
  const contents = { mainFrame };
  const handlers = new Map();
  registerLocalWorkspaceHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    getWindow: () => ({ webContents: contents }),
    getDesktopUiUrl: () => desktopUrl,
    getUserDataDirectory: () => directory,
  });

  const save = handlers.get("assistant:save-local-workspace");
  const load = handlers.get("assistant:load-local-workspace");
  const data = workspace("Desktop note");
  await save({ sender: contents, senderFrame: mainFrame }, data);
  mainFrame.url = desktopUrl + "/tools";
  assert.equal(await load({ sender: contents, senderFrame: mainFrame }), data);
  assert.throws(() => load({ sender: {}, senderFrame: mainFrame }), /desktop window/);
  assert.throws(() => save({ sender: contents, senderFrame: { url: mainFrame.url } }, data), /desktop window/);
  const diagnostics = handlers.get("assistant:read-host-diagnostics");
  assert.throws(() => diagnostics({ sender: {}, senderFrame: mainFrame }), /desktop window/);
  assert.throws(() => diagnostics({ sender: contents, senderFrame: { url: mainFrame.url } }), /desktop window/);
  const readings = await diagnostics({ sender: contents, senderFrame: mainFrame });
  for (const value of Object.values(readings)) {
    assert.ok(value === null || Number.isInteger(value) && value >= 0 && value <= 100);
  }
});
