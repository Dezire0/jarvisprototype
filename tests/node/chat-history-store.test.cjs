const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdir, mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ChatHistoryStore, registerChatHistoryHandlers } = require("../../src/main/chat-history-store.cjs");

const snapshot = (title) => JSON.stringify({
  version: 1,
  threads: [{ remoteId: "thread", title, status: "regular", messages: [] }],
  sidebar: { projects: [], threadMetaById: {}, selectedProjectId: null },
});

test("history persists by account, writes in order, and survives a failed replacement", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jarvis-history-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ChatHistoryStore(directory);
  assert.equal(await store.read("account-1"), null);
  await Promise.all([
    store.write("account-1", snapshot("First")),
    store.write("account-1", snapshot("Second")),
    store.write("account-2", snapshot("Other account")),
  ]);
  await assert.rejects(store.write("account-1", "{}"), /Invalid conversation/);
  await mkdir(store.filePath("account-1") + ".tmp");
  await assert.rejects(store.write("account-1", snapshot("Failed update")));
  const reopened = new ChatHistoryStore(directory);
  assert.equal(await reopened.read("account-1"), snapshot("Second"));
  assert.equal(await reopened.read("account-2"), snapshot("Other account"));
  assert.equal(await reopened.read("account-3"), null);
});

test("profile settings are validated, isolated by account, and written atomically with the sync preference", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jarvis-profile-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ChatHistoryStore(directory);
  const preferences = (name, language, cloudSync, savedMemory) => JSON.stringify({
    ...JSON.parse(snapshot("Existing thread")),
    profile: { name, language },
    cloudSync,
    savedMemory,
  });
  const original = preferences("One", "ko", true, false);
  const other = preferences("Two", "en", false);
  await store.write("account-1", original);
  await store.write("account-2", other);
  await assert.rejects(store.write("account-1", preferences("One", "invalid", false)), /Invalid conversation/);
  await assert.rejects(store.write("account-1", preferences("a".repeat(81), "en", false)), /Invalid conversation/);
  await assert.rejects(store.write("account-1", preferences("One", "en", false, "false")), /Invalid conversation/);
  await mkdir(store.filePath("account-1") + ".tmp");
  await assert.rejects(store.write("account-1", preferences("Renamed", "en", false)));
  assert.equal(await store.read("account-1"), original);
  assert.equal(await store.read("account-2"), other);
});

test("conversation storage only trusts the current chat main frame", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jarvis-history-ipc-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const handlers = new Map();
  let url = "http://127.0.0.1:8123";
  let activeAccount = "account";
  const webContents = { mainFrame: { url: url + "/" } };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  registerChatHistoryHandlers({
    ipcMain: { handle(name, callback) { handlers.set(name, callback); } },
    getWindow: () => ({ webContents }),
    getDesktopUiUrl: () => url,
    getUserDataDirectory: () => directory,
    getActiveAccountId: () => activeAccount,
  });

  const read = handlers.get("assistant:load-chat-history");
  const write = handlers.get("assistant:save-chat-history");
  await write(event, "account", snapshot("Saved"));
  assert.throws(() => read({ ...event, sender: {} }, "account"), /chat window/);
  assert.throws(() => write({ ...event, senderFrame: { url: url + "/" } }, "account", snapshot("Wrong frame")), /chat window/);
  webContents.mainFrame.url = url + "/tools";
  assert.throws(() => read(event, "account"), /chat window/);
  webContents.mainFrame.url = url + "/";
  url = "http://127.0.0.1:8124";
  assert.throws(() => read(event, "account"), /chat window/);
  webContents.mainFrame.url = url + "/";
  assert.equal(await read(event, "account"), snapshot("Saved"));
  assert.throws(() => read(event, "another-account"), /active account/);
  assert.throws(() => write(event, "another-account", snapshot("Wrong account")), /active account/);
  activeAccount = undefined;
  assert.throws(() => read(event, "account"), /active account/);
  activeAccount = "another-account";
  assert.equal(await read(event, "another-account"), null);
  assert.throws(() => read(event, "account"), /active account/);
});
