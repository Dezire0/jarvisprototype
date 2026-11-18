const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { AssistantService } = require("../../src/main/assistant-service.cjs");
const { parseLocalFileRead } = require("../../src/main/assistant/local-file-command.cjs");
const { FILE_PREVIEW_BYTES, FileService } = require("../../src/main/file-service.cjs");

test("explicit file reads preserve literal quoted paths and Korean spacing", () => {
  assert.deepEqual(parseLocalFileRead('read file "/tmp/screen  회의.txt"'), { path: "/tmp/screen  회의.txt", language: "en" });
  assert.deepEqual(parseLocalFileRead("파일 “/tmp/열어 본 화면 예시.txt” 읽어줘"), { path: "/tmp/열어 본 화면 예시.txt", language: "ko" });
  assert.deepEqual(parseLocalFileRead("open file /tmp/notes.txt"), { path: "/tmp/notes.txt", language: "en" });
  assert.deepEqual(parseLocalFileRead('read file "/tmp/no closing quote'), { path: "", language: "en" });
  assert.deepEqual(parseLocalFileRead('read file ""'), { path: "", language: "en" });
  for (const command of ["How do I read file permissions?", "summarize this file", "read\nfile /tmp/multi", "파일 형식은 뭐예요?"]) {
    assert.equal(parseLocalFileRead(command), null, command);
  }
});

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "jarvis-file-preview-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  return {
    files: new FileService({ workspaceRoot }),
    write: (name, content) => writeFile(path.join(workspaceRoot, name), content),
    workspaceRoot,
  };
}

test("local previews preserve text and empty files, with a bounded valid UTF-8 prefix", async (t) => {
  const { files, write } = await fixture(t);
  await write("meeting  notes.txt", "회의 메모\n  <script>literal text</script>\n");
  assert.deepEqual(await files.readPreview("meeting  notes.txt"), {
    name: "meeting  notes.txt",
    text: "회의 메모\n  <script>literal text</script>\n",
    truncated: false,
  });
  await write("empty.txt", "");
  assert.deepEqual(await files.readPreview("empty.txt"), { name: "empty.txt", text: "", truncated: false });
  const ascii = "x".repeat(FILE_PREVIEW_BYTES - 1);
  await write("boundary.txt", ascii + "끝");
  const preview = await files.readPreview("boundary.txt");
  assert.equal(preview.text, ascii);
  assert.equal(preview.truncated, true);
});

test("local previews reject directories, missing files, NUL bytes, and invalid UTF-8", async (t) => {
  const { files, write, workspaceRoot } = await fixture(t);
  await mkdir(path.join(workspaceRoot, "folder"));
  await write("binary.txt", Buffer.from("prefix\0suffix"));
  await write("invalid.txt", Buffer.from([0xff]));
  for (const name of ["folder", "binary.txt", "invalid.txt"]) {
    await assert.rejects(files.readPreview(name), { code: "UNSUPPORTED_FILE_PREVIEW" });
  }
  await assert.rejects(files.readPreview("missing.txt"), { code: "ENOENT" });
});

test("explicit file reads handle permission, path and failures without a model or memory", async () => {
  const reads = [];
  const computerControl = { enabled: false };
  const service = new AssistantService({
    computerControl,
    files: { async readPreview(path) {
      reads.push(path);
      if (path === "missing") throw Object.assign(new Error("private path detail"), { code: "ENOENT" });
      return { name: "screen  notes.txt", text: "private fixture", truncated: false };
    } },
  });
  service.handleModelConversation = () => assert.fail("Do not call a model for an exact file read");
  service.routeInput = () => assert.fail("Do not route file paths through the model");
  service.finalizeResponse = () => assert.fail("Do not add an exact file read to memory");

  const command = 'read file "/tmp/screen  notes.txt"';
  assert.match((await service.handleInput(command)).reply, /Turn on computer control/);
  assert.match((await service.handleInput('파일 "/var/folders/local/test/longer-directory-name/screen  notes.txt" 읽어줘')).reply,
    /파일을 읽으려면 컴퓨터 제어를 켜세요/);
  assert.deepEqual(reads, []);
  computerControl.enabled = true;
  assert.match((await service.handleInput('read file ""')).reply, /Check the file path/);
  const answer = await service.handleInput(command);
  assert.equal(answer.provider, "local");
  assert.equal(answer.details.filePreview.text, "private fixture");
  assert.equal(answer.actions[0].type, "file_read");
  assert.deepEqual(reads, ["/tmp/screen  notes.txt"]);
  const missing = await service.handleInput("read file missing");
  assert.match(missing.reply, /No file was found/);
  assert.doesNotMatch(missing.reply, /private path detail/);
});
