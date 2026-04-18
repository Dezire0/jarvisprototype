const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFallbackProject,
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
  }), "demo");

  assert.equal(scaffold.projectName, "demo-app");
  assert.equal(scaffold.summary, "Tiny demo");
  assert.deepEqual(scaffold.files, [
    {
      path: "index.html",
      content: "<h1>demo</h1>"
    }
  ]);
});

test("buildFallbackProject creates a snake starter when requested", () => {
  const scaffold = buildFallbackProject("스네이크 게임 만들어줘");

  assert.equal(scaffold.projectName, "jarvis-project");
  assert.ok(scaffold.files.some((file) => file.path === "app.js"));
  assert.ok(scaffold.files.some((file) => file.path === "index.html"));
});
