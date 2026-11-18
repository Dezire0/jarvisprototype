const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;
const accountId = "memory-fixture";
const historyKey = "jarvis-chat-history:v1:" + accountId;

test("model and memory labels stay with their answer in the local transcript", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const url = new URL(testUrl);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", reducedMotion: "reduce" });
    page.setDefaultTimeout(6500);
    const cloud = [];
    const chats = [];
    await page.route("**/*", (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if (target.origin !== url.origin) return route.abort();
      if (target.pathname === "/fixture-account/login") {
        return route.fulfill({ json: {
          token: "memory-fixture-token", user: { id: accountId, name: "Memory Fixture", email: "memory@example.invalid", plan: "free" },
        } });
      }
      if (target.pathname === "/fixture-account/plan") return route.fulfill({ json: { success: true, plan: "free" } });
      if (target.pathname === "/fixture-sync") {
        cloud.push(request.postDataJSON());
        return route.fulfill({ json: { success: true } });
      }
      if (target.pathname !== "/api/chat") return route.continue();
      const { memoryContext, state } = request.postDataJSON();
      const temporary = memoryContext.memoryMode === "temporary";
      const disabled = memoryContext.savedMemory === false;
      chats.push({ mode: memoryContext.memoryMode, saved: memoryContext.savedMemory, prior: state.messages.length });
      const createdAt = new Date().toISOString();
      const messages = [
        ...state.messages,
        { id: "fixture-user-" + chats.length, role: "user", status: "complete", createdAt,
          text: temporary ? "Temporary prompt" : disabled ? "Follow-up prompt" : "Ordinary prompt" },
        {
          id: "fixture-answer-" + chats.length, role: "assistant", status: "complete", createdAt,
          text: temporary ? "Temporary answer" : disabled ? "Follow-up answer" : "Ordinary answer",
          memorySources: temporary || disabled ? [] : ["conversation", "personal", "personal", "/fixture/hidden-path"],
          provider: disabled ? "jarvis-cloud-gemini-legacy" : "ollama:fixture-configured",
          responseSource: disabled ? undefined : temporary
            ? { provider: "openai-compatible", model: "https://fixture.invalid/private-model" }
            : { provider: "ollama", model: "fixture-used:latest", apiKey: "must-not-store" },
        },
      ];
      return route.fulfill({
        contentType: "text/plain",
        body: "aui-state:" + JSON.stringify([{ type: "set", path: [], value: { messages } }]) +
          '\nd:{"finishReason":"stop","usage":{"inputTokens":0,"outputTokens":0}}\n',
      });
    });
    await page.addInitScript((key) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify({
          version: 1, threads: [], cloudSync: true,
          sidebar: { projects: [], threadMetaById: {}, selectedProjectId: null },
        }));
      }
      const nativeFetch = window.fetch;
      window.fetch = (input, options) => {
        const target = new URL(typeof input === "string" ? input : input.url, location.href);
        if (target.hostname === "jarvis-auth-service.dexproject.workers.dev") {
          if (target.pathname.startsWith("/api/auth/")) {
            return nativeFetch(target.pathname.replace("/api/auth/", "/fixture-account/"), options);
          }
          if (target.pathname === "/api/chat/sync") return nativeFetch("/fixture-sync", options);
        }
        return nativeFetch(input, options);
      };
    }, historyKey);
    await page.goto(url.href);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("memory@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();

    const composer = page.getByRole("textbox", { name: "Message input" });
    const label = page.getByText("Saved memory sent · Personal context · Past conversations", { exact: true });
    const replySource = page.getByText("Ollama · fixture-used:latest", { exact: true });
    const sidebarToggle = page.getByRole("button", { name: "Toggle sidebar" });
    const synced = page.waitForResponse((response) => new URL(response.url()).pathname === "/fixture-sync");
    await composer.fill("Ordinary prompt");
    await composer.press("Enter");
    await page.getByText("Ordinary answer", { exact: true }).waitFor();
    await label.waitFor();
    await replySource.waitFor();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).threads.some(
      (thread) => thread.messages.some((message) => message.memorySources?.length === 2),
    ), historyKey);
    const snapshot = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), historyKey);
    assert.deepEqual(snapshot.threads[0].messages.at(-1).memorySources, ["personal", "conversation"]);
    assert.deepEqual(snapshot.threads[0].messages.at(-1).responseSource, { provider: "ollama", model: "fixture-used:latest" });
    assert.doesNotMatch(JSON.stringify(snapshot), /hidden-path|must-not-store/);
    await synced;
    assert.equal(cloud.length, 1);
    assert.doesNotMatch(JSON.stringify(cloud), /memorySources|responseSource|hidden-path|fixture-used/);

    await page.reload();
    await sidebarToggle.click();
    await page.getByRole("button", { name: "Ordinary prompt", exact: true }).click();
    await label.waitFor();
    await replySource.waitFor();
    assert.deepEqual(chats, [{ mode: "persistent", saved: true, prior: 0 }]);

    const profile = page.getByRole("button", { name: /Memory Fixture/ });
    await profile.click();
    const dialog = page.getByRole("dialog", { name: "Edit profile" });
    const memory = dialog.getByRole("checkbox", { name: "Use saved memory" });
    const sync = dialog.getByRole("checkbox", { name: "Cloud conversation sync" });
    assert.equal(await memory.isChecked(), true);
    assert.equal(await sync.isChecked(), true);
    await memory.focus();
    await memory.press("Space");
    assert.equal(await memory.isChecked(), false);
    assert.equal(await sync.isChecked(), true);

    await page.evaluate((key) => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new Error("Fixture write failure.");
        return setItem.call(this, name, value);
      };
      window.restoreFixtureStorage = () => { Storage.prototype.setItem = setItem; };
    }, historyKey);
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await dialog.getByText("Preferences couldn’t be saved. Try again.").waitFor();
    assert.equal(await memory.isChecked(), false);
    assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).savedMemory, historyKey), true);
    await page.evaluate(() => window.restoreFixtureStorage());
    await save.click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate((key) => {
      const { savedMemory, cloudSync } = JSON.parse(localStorage.getItem(key));
      return { savedMemory, cloudSync };
    }, historyKey), { savedMemory: false, cloudSync: true });

    const syncedAgain = page.waitForResponse((response) => new URL(response.url()).pathname === "/fixture-sync");
    await composer.fill("Follow-up prompt");
    await composer.press("Enter");
    await page.getByText("Follow-up answer", { exact: true }).waitFor();
    await page.getByText("Jarvis Cloud · gemini-legacy", { exact: true }).waitFor();
    await syncedAgain;
    assert.deepEqual(chats[1], { mode: "persistent", saved: false, prior: 2 });
    assert.equal(await label.count(), 1);

    await page.reload();
    await sidebarToggle.click();
    await profile.click();
    assert.equal(await memory.isChecked(), false);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Temporary Chat", exact: true }).click();
    await composer.fill("Temporary prompt");
    await composer.press("Enter");
    await page.getByText("Temporary answer", { exact: true }).waitFor();
    await page.getByText("OpenAI-compatible API", { exact: true }).waitFor();
    assert.equal(await page.getByText(/private-model|fixture-configured/).count(), 0);
    assert.equal(await label.count(), 0);
    assert.deepEqual(chats[2], { mode: "temporary", saved: undefined, prior: 0 });
    assert.equal(cloud.length, 2);
    assert.doesNotMatch(await page.evaluate((key) => localStorage.getItem(key), historyKey), /Temporary prompt/);
  } finally {
    await browser.close();
  }
});
