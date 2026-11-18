const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;
const key = "jarvis-chat-history:v1:cleanup";
const createdAt = "2026-11-17T00:00:00.000Z";
const time = Date.parse(createdAt);

function thread(id, title, status = "regular") {
  return { remoteId: id, title, status, updatedAt: time,
    messages: [{ id: id + "-message", role: "assistant", text: title + " reply", createdAt }] };
}

const initial = {
  version: 1,
  threads: [
    thread("keep", "Current project discussion"),
    thread("closed", "Completed planning call"),
    thread("archive", "Archived meeting", "archived"),
  ],
  sidebar: {
    projects: [{ id: "project", name: "Important project", createdAt: time }],
    selectedProjectId: null,
    threadMetaById: { keep: { projectId: "project", createdAt: time, updatedAt: time } },
  },
  profile: { name: "Test", language: "en" },
  cloudSync: false,
  savedMemory: true,
};

test("reviewed conversation deletion persists locally, retries after failure and protects other drafts", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const origin = new URL(testUrl).origin;
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", reducedMotion: "reduce", viewport: { width: 1180, height: 772 } });
    page.setDefaultTimeout(5000);
    const chatRequests = [];
    await page.route("**/*", (route) => {
      const target = new URL(route.request().url());
      if (target.pathname.includes("/api/chat")) {
        chatRequests.push(route.request().method());
        return route.abort();
      }
      if (target.origin !== origin) return route.abort();
      if (target.pathname === "/fixture-account/login") return route.fulfill({ json: {
        token: "cleanup-token", user: { id: "cleanup", email: "cleanup@example.invalid", plan: "free" },
      } });
      if (target.pathname === "/fixture-account/plan") return route.fulfill({ json: { success: true, plan: "free" } });
      return route.continue();
    });
    await page.addInitScript(({ key, initial }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
      const nativeWrite = Storage.prototype.setItem;
      Storage.prototype.setItem = function (target, value) {
        if (target === key && window.failDeletion && !JSON.parse(value).threads.some(({ remoteId }) => remoteId === "closed")) {
          window.failDeletion = false;
          throw new Error("Fixture write failure");
        }
        return nativeWrite.call(this, target, value);
      };
      let account = { token: null, user: null };
      const networkFetch = window.fetch;
      window.fetch = (input, options) => {
        const target = new URL(typeof input === "string" ? input : input.url, location.href);
        if (target.hostname === "jarvis-auth-service.dexproject.workers.dev" && target.pathname.startsWith("/api/auth/")) {
          return networkFetch(target.pathname.replace("/api/auth/", "/fixture-account/"), options);
        }
        return networkFetch(input, options);
      };
      window.assistantAPI = {
        restoreAccountSession: async () => account,
        saveAccountSession: async ({ token, user }) => (account = { token, user }),
      };
    }, { key, initial });
    await page.goto(origin);
    await page.getByLabel("Email", { exact: true }).fill("cleanup@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();
    const composer = page.getByRole("textbox", { name: "Message input" });
    const manage = page.getByRole("button", { name: "Manage conversations" });
    const panel = page.getByRole("dialog", { name: "Manage conversations" });
    const cancel = panel.getByRole("button", { name: "Cancel" });
    const review = panel.getByRole("button", { name: "Review deletion (2)", exact: true });
    const remove = panel.getByRole("button", { name: "Delete on this device" });
    const read = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    await composer.waitFor();
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await page.getByRole("button", { name: "Current project discussion", exact: true }).click();
    await page.getByText("Current project discussion reply", { exact: true }).waitFor();
    await composer.fill("Preserve this draft.");
    await manage.click();
    const selectAll = panel.getByRole("checkbox", { name: "Select all", exact: true });
    await selectAll.check();
    await panel.getByRole("button", { name: "Review deletion (3)", exact: true }).waitFor();
    await selectAll.uncheck();
    await panel.getByRole("checkbox", { name: "Completed planning call", exact: true }).check();
    await panel.getByRole("checkbox", { name: "Archived meeting", exact: true }).check();
    await review.click();
    await cancel.waitFor();
    assert.equal(await cancel.evaluate((button) => button === document.activeElement), true);
    await cancel.press("Enter");
    assert.deepEqual((await read()).threads.map((value) => value.remoteId), ["keep", "closed", "archive"]);
    await review.click();
    const previous = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      const changed = JSON.parse(raw);
      changed.threads.find((value) => value.remoteId === "closed").title = "Edited in another window";
      localStorage.setItem(key, JSON.stringify(changed));
      return raw;
    }, key);
    await remove.click();
    await panel.getByRole("alert").getByText("History changed in another window. Reopen the app before reviewing it again.").waitFor();
    assert.equal((await read()).threads.find((value) => value.remoteId === "closed").title, "Edited in another window");
    await page.evaluate(({ key, previous }) => localStorage.setItem(key, previous), { key, previous });
    await review.click();
    await page.evaluate(() => { window.failDeletion = true; });
    await remove.click();
    await panel.getByRole("alert").getByText("Couldn’t delete the conversations. Try again.").waitFor();
    assert.deepEqual((await read()).threads.map((value) => value.remoteId), ["keep", "closed", "archive"]);
    await remove.click();
    await panel.waitFor({ state: "hidden" });
    assert.deepEqual((await read()).threads.map((value) => value.remoteId), ["keep"]);
    assert.equal(await composer.inputValue(), "Preserve this draft.");
    await page.getByRole("button", { name: "Completed planning call", exact: true }).waitFor({ state: "hidden" });
    assert.deepEqual((await read()).sidebar.projects, initial.sidebar.projects);
    assert.deepEqual((await read()).profile, initial.profile);

    await composer.fill("clear chat");
    await composer.press("Enter");
    await panel.getByText("This also clears the current draft and opens a new chat.").waitFor();
    await panel.getByText("Current project discussion", { exact: true }).waitFor();
    await remove.click();
    await panel.waitFor({ state: "hidden" });
    assert.deepEqual((await read()).threads, []);
    assert.equal(await composer.inputValue(), "");
    await page.getByText("Current project discussion reply", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await manage.isDisabled(), true);
    await composer.fill("clear conversation");
    await composer.press("Enter");
    await page.getByText("This conversation has no saved history.").waitFor();
    assert.deepEqual(chatRequests, []);
  } finally {
    await browser.close();
  }
});
