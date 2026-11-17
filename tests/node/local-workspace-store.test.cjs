const assert = require("node:assert/strict");
const { mkdtemp, readdir, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { LocalWorkspaceStore, isLocalWorkspacePage } = require("../../src/main/local-workspace-store.cjs");

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

test("workspace IPC accepts only the current loopback desktop tools route", () => {
  const desktopUrl = "http://127.0.0.1:18765";
  assert.equal(isLocalWorkspacePage(desktopUrl + "/tools", desktopUrl), true);
  assert.equal(isLocalWorkspacePage(desktopUrl + "/", desktopUrl), false);
  assert.equal(isLocalWorkspacePage("http://127.0.0.1:18766/tools", desktopUrl), false);
  assert.equal(isLocalWorkspacePage("https://example.invalid/tools", "https://example.invalid"), false);
  assert.equal(isLocalWorkspacePage("file:///tools", "file:///"), false);
  assert.equal(isLocalWorkspacePage(desktopUrl + "/tools", null), false);
});
