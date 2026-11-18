const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { AppPicker } = require("../../src/main/app-picker.cjs");

const allowed = () => {};

async function makeApp(root, folder) {
  const contents = path.join(root, folder, "Studio.app", "Contents");
  await fs.mkdir(contents, { recursive: true });
  await fs.writeFile(path.join(contents, "Info.plist"), "<plist><dict/></plist>");
  return fs.realpath(path.dirname(contents));
}

test("the app picker presents same-name bundles and opens the selected location only", async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "jarvis-picker-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await makeApp(root, "First");
  const second = await makeApp(root, "Second");
  const opened = [];
  const picker = new AppPicker({
    platform: "darwin",
    listApps: async ({ query, forceRefresh }) => {
      assert.equal(query, "Studio");
      assert.equal(forceRefresh, true);
      return { apps: [{ path: first }, { path: first }, { path: second },
        { path: path.join(root, "Missing.app") }, { path: "relative.app" }] };
    },
    launch: async (location) => { opened.push(location); return ""; }
  });
  const result = await picker.search({ query: " Studio ", refresh: true, assertAllowed: allowed });
  assert.deepEqual(result.apps, [
    { id: "1", name: "Studio", location: first },
    { id: "2", name: "Studio", location: second },
  ]);
  assert.deepEqual(opened, []);
  await assert.rejects(picker.open({ revision: result.revision, id: second, assertAllowed: allowed }), { code: "APPS_STALE" });
  assert.deepEqual(await picker.open({ revision: result.revision, id: "2", assertAllowed: allowed }), { name: "Studio" });
  assert.deepEqual(opened, [second]);
});

test("app launch requires unchanged metadata, a current search and valid desktop approval", async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "jarvis-picker-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = await makeApp(root, "Local");
  const picker = new AppPicker({
    platform: "darwin", listApps: async () => ({ apps: [{ path: app }] }),
    launch: () => assert.fail("Stale and changed selections must not launch")
  });
  let permitted = true;
  const assertAllowed = () => {
    if (!permitted) throw Object.assign(new Error("Desktop permission revoked"), { code: "APPS_PERMISSION" });
  };
  const original = await picker.search({ assertAllowed });
  await fs.writeFile(path.join(app, "Contents", "Info.plist"), "Updated bundle metadata");
  await assert.rejects(picker.open({ ...original, id: "1", assertAllowed }), { code: "APPS_CHANGED" });

  const refreshed = await picker.search({ assertAllowed });
  await assert.rejects(picker.open({ ...original, id: "1", assertAllowed }), { code: "APPS_STALE" });
  permitted = false;
  await assert.rejects(picker.open({ ...refreshed, id: "1", assertAllowed: allowed }), { code: "APPS_PERMISSION" });
});

test("a missing app catalog backend returns unsupported without trying to scan", async () => {
  const picker = new AppPicker({
    platform: "win32", listApps: () => assert.fail("No backend on Windows"),
    launch: () => assert.fail("No launch without a valid catalog")
  });
  assert.deepEqual(await picker.search({ assertAllowed: allowed }), { supported: false, apps: [] });
  await assert.rejects(picker.open({ revision: 1, id: "1", assertAllowed: allowed }), { code: "APPS_STALE" });
});

test("the assistant routes app discovery to the local picker without a model request", async () => {
  const { AssistantService } = require("../../src/main/assistant-service.cjs");
  const assistant = new AssistantService({ computerControl: { enabled: false } });
  assistant.handleModelConversation = () => assert.fail("App discovery should stay local");
  for (const input of ["installed apps", "find an app TextEdit", "설치된 앱 목록 보여줘", "앱 찾기 텍스트 편집기"]) {
    const result = await assistant.handleInput(input);
    assert.equal(result.provider, "local");
    assert.deepEqual(result.actions, []);
    assert.match(result.reply, /Local tools|로컬 도구/);
  }
});

test("a direct app request with same-name matches guides to the picker before launching", async () => {
  const { AssistantService } = require("../../src/main/assistant-service.cjs");
  const assistant = new AssistantService({
    automation: {
      listInstalledApps: async () => ({
        apps: [{ name: "Studio", path: "/First/Studio.app" }, { name: "Studio", path: "/Second/Studio.app" }]
      }),
      resolveAppTarget: () => assert.fail("Ambiguous apps should be picked first")
    }
  });
  const result = await assistant.handleAppOpen("Open Studio", { appName: "Studio" });
  assert.match(result.reply, /Open Apps/);
  assert.deepEqual(result.actions, []);
});
