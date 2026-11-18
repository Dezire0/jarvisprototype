const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  CodeProjectService,
  parseProjectScaffold,
  slugifyProjectName
} = require("../../src/main/code-project-service.cjs");

test("slugifyProjectName normalizes mixed input", () => {
  assert.equal(slugifyProjectName(" My Snake Game  "), "my-snake-game");
  assert.equal(slugifyProjectName(""), "jarvis-project");
});

test("parseProjectScaffold accepts a valid JSON scaffold", () => {
  const scaffold = parseProjectScaffold(JSON.stringify({
    projectName: "Demo App",
    summary: "Tiny demo",
    files: [
      {
        path: "index.html",
        content: "<h1>demo</h1>"
      }
    ]
  }));

  assert.equal(scaffold.projectName, "demo-app");
  assert.equal(scaffold.summary, "Tiny demo");
  assert.deepEqual(scaffold.files, [
    {
      path: "index.html",
      content: "<h1>demo</h1>"
    }
  ]);
});

test("built-in starters produce previews without using the model or launching an editor", async () => {
  const service = new CodeProjectService({
    modelConfig: () => assert.fail("Templates must not read model settings"),
    requestModel: () => assert.fail("Templates must not call the model"),
    automation: { execute: () => assert.fail("Previewing must not launch an editor") }
  });
  for (const template of ["web", "grid", "tasks"]) {
    const draft = await service.prepareProject({ template, name: "작업 기록" });
    assert.equal(draft.projectName, "작업-기록");
    assert.deepEqual(draft.source, { type: "template" });
    assert.ok(draft.files.some((file) => file.path === "index.html"));
    if (template !== "web") assert.ok(draft.files.some((file) => file.path === "app.js"));
  }
});

test("model drafts report their actual model and preserve the user name and empty files", async () => {
  const requests = [];
  const service = new CodeProjectService({
    modelConfig: () => ({ provider: "openai-compatible", model: "fixture", url: "http://127.0.0.1:3302/v1" }),
    requestModel: async (request) => {
      requests.push(request);
      return JSON.stringify({
        projectName: "model-name",
        files: [{ path: "assets/notes.txt", content: "" }, { path: "index.html", content: "<main>Notes</main>" }]
      });
    }
  });
  const draft = await service.prepareProject({ template: "model", name: "Safe Notes", prompt: "Create a notes page" });
  assert.equal(draft.projectName, "safe-notes");
  assert.deepEqual(draft.source, { type: "model", provider: "openai-compatible", model: "fixture" });
  assert.equal(draft.files[0].content, "");
  assert.deepEqual(requests[0].history, []);
  assert.deepEqual(JSON.parse(requests[0].userPrompt), { description: "Create a notes page", preferredName: "Safe Notes" });
  const unsupported = new CodeProjectService({
    modelConfig: () => ({ provider: "openai-cli", model: "fixture" }),
    requestModel: () => assert.fail("A model CLI must not receive this draft")
  });
  await assert.rejects(unsupported.prepareProject({ template: "model", prompt: "A web page" }), { code: "PROJECT_MODEL_REQUIRED" });
});

test("invalid scaffold paths, file kinds and conflicting names are rejected before saving", () => {
  const scaffold = (...paths) => JSON.stringify({
    projectName: "Example",
    files: paths.map((filePath) => ({ path: filePath, content: "" })),
  });
  for (const paths of [
    ["/file.txt"], ["../outside.txt"], ["notes/../outside.txt"], ["notes\\file.txt"],
    ["C:/file.txt"], ["NUL.txt"], [".git/config"], ["file.txt."], ["notes//file.txt"],
    ["File.txt", "file.txt"], ["notes", "notes/log.txt"], ["notes/a.txt", "Notes/b.txt"],
  ]) {
    assert.throws(() => parseProjectScaffold(scaffold(...paths)), { code: "PROJECT_INVALID_FILES" });
  }
  assert.throws(() => parseProjectScaffold("I couldn't prepare a project."), { code: "PROJECT_INVALID_FILES" });
  assert.throws(() => parseProjectScaffold(scaffold("entry.txt"), "nul"), { code: "PROJECT_INVALID_NAME" });
  assert.throws(() => parseProjectScaffold(JSON.stringify({
    projectName: "Example", files: [{ path: "file.txt", content: "a".repeat(65537) }]
  })), { code: "PROJECT_TOO_LARGE" });
});

test("save uses a new directory and exclusive files when two requests select the same destination", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-project-test-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const service = new CodeProjectService();
  const draft = { projectName: "hello", files: [
    { path: "notes/intro.txt", content: "hello" },
    { path: "notes/appendix.txt", content: "" }
  ] };
  const outcomes = await Promise.allSettled([
    service.saveProject(draft, folder, () => {}),
    service.saveProject({ ...draft, files: [{ path: "different.txt", content: "other" }] }, folder, () => {})
  ]);
  const saved = outcomes.findIndex((result) => result.status === "fulfilled");
  assert.ok(saved >= 0);
  assert.equal(outcomes[1 - saved].reason.code, "PROJECT_EXISTS");
  const { path: projectPath } = outcomes[saved].value;
  if (saved === 0) {
    assert.deepEqual(await fs.readdir(projectPath), ["notes"]);
    assert.equal(await fs.readFile(path.join(projectPath, "notes", "intro.txt"), "utf8"), "hello");
    assert.equal(await fs.readFile(path.join(projectPath, "notes", "appendix.txt"), "utf8"), "");
  } else {
    assert.deepEqual(await fs.readdir(projectPath), ["different.txt"]);
    assert.equal(await fs.readFile(path.join(projectPath, "different.txt"), "utf8"), "other");
  }
});

test("save rolls back its own files if computer control is revoked while writing", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-project-test-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const sibling = path.join(folder, "unrelated.txt");
  await fs.writeFile(sibling, "keep this");
  const service = new CodeProjectService();
  const draft = await service.prepareProject({ template: "tasks" });
  const revoked = Object.assign(new Error("Permission revoked"), { code: "PROJECT_PERMISSION" });
  let calls = 0;
  await assert.rejects(service.saveProject(draft, folder, () => {
    if (++calls === 3) throw revoked;
  }), revoked);
  assert.deepEqual(await fs.readdir(folder), ["unrelated.txt"]);
  assert.equal(await fs.readFile(sibling, "utf8"), "keep this");
});

test("conversation project requests show guidance without generating files", async () => {
  const { AssistantService } = require("../../src/main/assistant-service.cjs");
  const assistant = new AssistantService({ computerControl: { enabled: false } });
  assistant.handleModelConversation = () => assert.fail("Exact project command must stay local");
  for (const input of ["create a coding project", "코딩 프로젝트 만들기"]) {
    const result = await assistant.handleInput(input);
    assert.deepEqual(result.actions, []);
    assert.equal(result.provider, "local");
    assert.match(result.reply, /Local tools|로컬 도구/);
  }
  const route = await assistant.handleCodeProject("Create a custom task app");
  assert.deepEqual(route.actions, []);
  assert.match(route.reply, /Create coding project/);
});
