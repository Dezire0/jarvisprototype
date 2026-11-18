const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { FileService } = require("../../src/main/file-service.cjs");
const { FolderBrowser } = require("../../src/main/folder-browser.cjs");

const allowed = () => {};

async function setup(t) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "jarvis-folder-browser-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = await fs.realpath(root);
  return { directory, browser: new FolderBrowser(new FileService({ workspaceRoot: directory })) };
}

test("folder browsing is scoped to a chosen root and uses current result IDs", async (t) => {
  const { directory, browser } = await setup(t);
  await fs.mkdir(path.join(directory, "회의"));
  await fs.writeFile(path.join(directory, "회의", "기록.txt"), "Independent local fixture");
  if (process.platform !== "win32") await fs.symlink(path.dirname(directory), path.join(directory, "Other"));
  const root = await browser.choose(directory, allowed);
  assert.equal(root.canGoUp, false);
  assert.deepEqual(root.entries, [{ id: 1, name: "회의", kind: "directory" }]);
  const act = (revision, action, id) => browser.act({ revision, action, id, assertAllowed: allowed });
  await assert.rejects(act(root.revision, "up"), { code: "FOLDER_STALE" });
  await assert.rejects(act(root.revision, "enter", "../"), { code: "FOLDER_STALE" });
  const nested = await act(root.revision, "enter", root.entries[0].id);
  assert.equal(nested.canGoUp, true);
  assert.equal(nested.directory, path.join(directory, "회의"));
  await assert.rejects(act(root.revision, "enter", 1), { code: "FOLDER_STALE" });
  assert.deepEqual(await act(nested.revision, "preview", 1), {
    name: "기록.txt", text: "Independent local fixture", truncated: false
  });
  const parent = await act(nested.revision, "up");
  assert.equal(parent.directory, directory);
  assert.equal(parent.canGoUp, false);
});

test("file identities and desktop scope are checked again when opening a preview", async (t) => {
  const { directory, browser } = await setup(t);
  const target = path.join(directory, "file.txt");
  await fs.writeFile(target, "Original");
  let permitted = true;
  const assertSelected = () => {
    if (!permitted) throw Object.assign(new Error("Permission"), { code: "FOLDER_PERMISSION" });
  };
  const first = await browser.choose(directory, assertSelected);
  await fs.writeFile(target, "Replacement text");
  await assert.rejects(browser.act({
    revision: first.revision, action: "preview", id: 1, assertAllowed: allowed
  }), { code: "FOLDER_CHANGED" });
  const refreshed = await browser.act({ revision: first.revision, action: "refresh", assertAllowed: allowed });
  assert.equal(refreshed.entries[0].name, "file.txt");
  permitted = false;
  await assert.rejects(browser.act({
    revision: refreshed.revision, action: "preview", id: 1, assertAllowed: allowed
  }), { code: "FOLDER_PERMISSION" });
});

test("folder listing and UTF-8 previews are bounded and binary files are refused", async (t) => {
  const { directory, browser } = await setup(t);
  await fs.writeFile(path.join(directory, "binary.bin"), Buffer.from([0, 255, 10]));
  await fs.writeFile(path.join(directory, "long.txt"), "a".repeat(17000));
  const list = await browser.choose(directory, allowed);
  const act = (filename) => browser.act({
    revision: list.revision, action: "preview",
    id: list.entries.find((entry) => entry.name === filename).id, assertAllowed: allowed
  });
  await assert.rejects(act("binary.bin"), { code: "UNSUPPORTED_FILE_PREVIEW" });
  const preview = await act("long.txt");
  assert.equal(preview.text.length, 16384);
  assert.equal(preview.truncated, true);
  await Promise.all(Array.from({ length: 201 }, (_, index) => fs.writeFile(path.join(directory, "item-" + index), "")));
  const capped = await browser.choose(directory, allowed);
  assert.equal(capped.entries.length, 200);
  assert.equal(capped.more, true);
});

test("assistant-classified file paths are not passed to the model or opened implicitly", async () => {
  const { AssistantService } = require("../../src/main/assistant-service.cjs");
  const assistant = new AssistantService({
    files: {
      readFile: () => assert.fail("Do not open model-classified paths"),
      listDirectory: () => assert.fail("Do not list a model-classified directory"),
    },
    computerControl: { enabled: false },
  });
  assistant.handleModelConversation = () => assert.fail("Exact folder command stays local");
  const command = await assistant.handleInput("browse files");
  assert.equal(command.provider, "local");
  for (const route of ["file_read", "file_list"]) {
    const result = await assistant.handleFileRoute("Look at this file", { route, path: "/fixture.txt" });
    assert.match(result.reply, /Browse files/);
    assert.deepEqual(result.actions, []);
  }
});
