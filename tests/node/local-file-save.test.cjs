const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, readFile, readdir, rm, symlink, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { FileService } = require("../../src/main/file-service.cjs");
const { AssistantService } = require("../../src/main/assistant-service.cjs");
const { parseLocalFileWrite } = require("../../src/main/assistant/local-file-command.cjs");
const { createLocalFileSaver } = require("../../src/main/assistant/local-file-save.cjs");

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "jarvis-save-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, files: new FileService({ workspaceRoot: root }), target: path.join(root, "notes.txt") };
}

test("exact save commands preserve literal paths and multiline content and are handled locally", async () => {
  const content = "  첫 줄\r\n\r\n  둘째 줄\n";
  const input = '파일 저장 "/tmp/회의  노트.txt" :::\n' + content;
  assert.deepEqual(parseLocalFileWrite(input), { path: "/tmp/회의  노트.txt", content, language: "ko" });
  assert.deepEqual(parseLocalFileWrite('edit file "/tmp/notes.txt" ::: New text'), {
    path: "/tmp/notes.txt", content: "New text", language: "en",
  });
  assert.equal(parseLocalFileWrite("How do I write file contents?"), null);
  const service = new AssistantService({ computerControl: { enabled: true } });
  service.routeInput = () => assert.fail("Local editor contents must not reach routing");
  service.finalizeResponse = () => assert.fail("Local editor contents must not become memory");
  assert.match((await service.handleInput(input)).reply, /로컬 도구의 파일 저장/);
});

test("unapproved writes preserve current files and concurrent creates publish one complete result", async (t) => {
  const { files, target, root } = await fixture(t);
  const attempts = Array.from({ length: 4 }, (_, index) => String(index).repeat(4096));
  const results = await Promise.allSettled(attempts.map((text) => files.writeFile(target, text)));
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.ok(results.filter(({ status }) => status === "rejected").every(({ reason }) => reason.code === "EEXIST"));
  const winningText = await readFile(target, "utf8");
  assert.ok(attempts.includes(winningText));
  await assert.rejects(files.writeFile(target, "Changed"), { code: "EEXIST" });
  assert.equal(await readFile(target, "utf8"), winningText);
  assert.deepEqual(await readdir(root), ["notes.txt"]);
});

test("only the approved snapshot is replaced and a changed target is preserved", async (t) => {
  const { files, target } = await fixture(t);
  await writeFile(target, "Older version");
  const draft = { path: target, content: "  New\n\nVersion ", language: "ko" };
  let approved = false;
  let changeDuringApproval = false;
  const save = createLocalFileSaver({
    async confirmReplacement(resolvedPath, korean) {
      assert.match(resolvedPath, /notes\.txt$/);
      assert.equal(korean, true);
      if (changeDuringApproval) await writeFile(target, "External replacement");
      return approved;
    }
  });
  assert.deepEqual(await save(files, draft, () => {}), { ok: false, reason: "cancelled" });
  assert.equal(await readFile(target, "utf8"), "Older version");
  approved = true;
  assert.equal((await save(files, draft, () => {})).ok, true);
  assert.equal(await readFile(target, "utf8"), draft.content);
  changeDuringApproval = true;
  assert.deepEqual(await save(files, draft, () => {}), { ok: false, reason: "conflict" });
  assert.equal(await readFile(target, "utf8"), "External replacement");
});

test("native writes retain the file on permission changes and reject concurrent approval", async (t) => {
  const { files, target } = await fixture(t);
  await writeFile(target, "Original");
  const { resolve, promise } = Promise.withResolvers();
  const { resolve: entered, promise: opened } = Promise.withResolvers();
  const save = createLocalFileSaver({ confirmReplacement: () => { entered(); return promise; } });
  const draft = { path: target, content: "Replacement" };
  let permitted = true;
  const pending = save(files, draft, () => {
    if (!permitted) throw Object.assign(new Error("Approval expired"), { code: "FILE_PERMISSION_CHANGED" });
  });
  await opened;
  assert.deepEqual(await save(files, draft, () => {}), { ok: false, reason: "busy" });
  permitted = false;
  resolve(true);
  assert.deepEqual(await pending, { ok: false, reason: "permission" });
  assert.equal(await readFile(target, "utf8"), "Original");
});

test("symbolic-link destinations cannot be replaced through the save command", {
  skip: process.platform === "win32" && "Creating fixture symlinks requires Windows developer mode",
}, async (t) => {
  const { files, target, root } = await fixture(t);
  await writeFile(target, "Original");
  const link = path.join(root, "symlink.txt");
  await symlink(target, link);
  const save = createLocalFileSaver({ confirmReplacement: () => assert.fail("Do not approve links") });
  assert.deepEqual(await save(files, { path: link, content: "Replacement" }, () => {}), { ok: false, reason: "unsupported" });
  await assert.rejects(files.writeFile(link, "Overwrite"), { code: "EEXIST" });
  assert.equal(await readFile(target, "utf8"), "Original");
});
