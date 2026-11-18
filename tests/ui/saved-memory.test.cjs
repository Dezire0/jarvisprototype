const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("saved memory previews belong to the signed-in account and clear only after review", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const origin = new URL(testUrl).origin;
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", reducedMotion: "reduce", viewport: { width: 420, height: 560 } });
    page.setDefaultTimeout(5000);
    const networkCalls = [];
    await page.route("**/*", (route) => {
      const target = new URL(route.request().url());
      if (target.origin !== origin || target.pathname.startsWith("/api/chat")) {
        networkCalls.push(target.pathname);
        return route.abort();
      }
      if (target.pathname === "/fixture-account/login") return route.fulfill({ json: {
        token: "memory-token", user: { id: "memory-review", email: "memory@example.invalid", plan: "free" },
      } });
      if (target.pathname === "/fixture-account/plan") return route.fulfill({ json: { success: true, plan: "free" } });
      return route.continue();
    });
    await page.addInitScript(() => {
      const nativeFetch = window.fetch;
      window.fetch = (input, options) => {
        const target = new URL(typeof input === "string" ? input : input.url, location.href);
        if (target.hostname === "jarvis-auth-service.dexproject.workers.dev" && target.pathname.startsWith("/api/auth/")) {
          return nativeFetch(target.pathname.replace("/api/auth/", "/fixture-account/"), options);
        }
        return nativeFetch(input, options);
      };
      localStorage.setItem("jarvis-chat-history:v1:memory-review", JSON.stringify({
        version: 1, threads: [], sidebar: { projects: [], threadMetaById: {}, selectedProjectId: null }, savedMemory: false,
      }));
      let account = { token: null, user: null };
      let snapshot = {
        revision: "preview-1",
        categories: {
          personal: { count: 14, entries: [{ title: "Notebook color", excerpt: "Blue cover" }] },
          threads: { count: 1, entries: [{ title: "Design notes", excerpt: "A previous discussion" }] },
          projects: { count: 1, entries: [{ title: "Workbench", excerpt: "Sketch the layout" }] },
          documents: { count: 1, entries: [{ title: "Weekly brief", excerpt: "An indexed excerpt" }] },
        },
      };
      window.memoryCalls = [];
      window.assistantAPI = {
        restoreAccountSession: async () => account,
        saveAccountSession: async ({ token, user }) => (account = { token, user }),
        reviewSavedMemory: async (id) => {
          window.memoryCalls.push(["review", id]);
          return snapshot;
        },
        clearSavedMemory: async (id, revision) => {
          window.memoryCalls.push(["clear", id, revision]);
          if (snapshot.revision === "preview-1") {
            snapshot = { ...snapshot, revision: "preview-2" };
            return null;
          }
          if (window.failClear) throw new Error("Fixture write failure");
          snapshot = { revision: "empty", categories: Object.fromEntries(Object.keys(snapshot.categories)
            .map(category => [category, { count: 0, entries: [] }])) };
          return snapshot;
        },
      };
    });
    await page.goto(origin);
    await page.getByLabel("Email", { exact: true }).fill("memory@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();
    const composer = page.getByRole("textbox", { name: "Message input" });
    await composer.fill("Keep my draft.");
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    const trigger = page.getByRole("button", { name: "Saved memory", exact: true });
    const panel = page.getByRole("dialog", { name: "Saved memory", exact: true });
    const review = panel.getByRole("button", { name: "Clear saved memory", exact: true });
    const clear = panel.getByRole("button", { name: "Clear on this device" });
    const cancel = panel.getByRole("button", { name: "Cancel" });
    assert.deepEqual(await page.evaluate(() => window.memoryCalls), []);
    await trigger.press("Enter");
    await panel.getByText("Use of saved memory is off for this account.").waitFor();
    await panel.getByText("Personal memory", { exact: true }).click();
    await panel.getByText("Blue cover", { exact: true }).waitFor();
    await panel.getByText("Showing 1 of 14", { exact: true }).waitFor();
    await panel.getByText("Document excerpts", { exact: true }).click();
    await panel.getByText("An indexed excerpt", { exact: true }).waitFor();
    await review.click();
    assert.equal(await cancel.evaluate((element) => element === document.activeElement), true);
    await cancel.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.memoryCalls), [["review", "memory-review"]]);
    await review.click();
    await clear.click();
    await panel.getByRole("alert").getByText("Saved memory changed. Review it again.").waitFor();
    await review.click();
    await page.evaluate(() => { window.failClear = true; });
    await clear.click();
    await panel.getByRole("alert").getByText("Couldn’t clear saved memory. Try again.").waitFor();
    await page.evaluate(() => { window.failClear = false; });
    await clear.click();
    await panel.getByRole("status").getByText("Cleared saved memory for this account.").waitFor();
    assert.equal(await panel.getByText("Blue cover", { exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Close sidebar" }).click();
    assert.equal(await composer.inputValue(), "Keep my draft.");
    assert.deepEqual(await page.evaluate(() => window.memoryCalls), [
      ["review", "memory-review"], ["clear", "memory-review", "preview-1"], ["review", "memory-review"],
      ["clear", "memory-review", "preview-2"], ["clear", "memory-review", "preview-2"],
    ]);
    assert.deepEqual(networkCalls, []);
  } finally {
    await browser.close();
  }
});
