const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;
const account = { id: "fallback-control", email: "fallback@example.invalid", plan: "free" };

test("the composer applies the saved fallback choice to each new request", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const url = new URL(testUrl);
  assert.equal(url.hostname, "127.0.0.1");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", reducedMotion: "reduce", viewport: { width: 420, height: 560 } });
    page.setDefaultTimeout(6000);
    const requests = [];
    await page.route("**/*", (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if (target.origin !== url.origin) return route.abort();
      if (target.pathname === "/fixture/login") return route.fulfill({ json: { token: "fallback-control-fixture", user: account } });
      if (target.pathname === "/fixture/plan") return route.fulfill({ json: { success: true, plan: "free" } });
      if (target.pathname !== "/api/chat") return route.continue();
      const { state, memoryContext, allowCloudFallback } = request.postDataJSON();
      requests.push({ allowCloudFallback, mode: memoryContext.memoryMode });
      const createdAt = new Date().toISOString();
      const messages = [
        ...state.messages,
        { id: "fallback-user-" + requests.length, role: "user", text: "Test request " + requests.length, createdAt, status: "complete" },
        { id: "fallback-answer-" + requests.length, role: "assistant", text: "Fixture reply " + requests.length, createdAt, status: "complete" },
      ];
      return route.fulfill({
        contentType: "text/plain",
        body: "aui-state:" + JSON.stringify([{ type: "set", path: [], value: { messages } }]) +
          '\nd:{"finishReason":"stop","usage":{"inputTokens":0,"outputTokens":0}}\n',
      });
    });
    await page.addInitScript(() => {
      const fetchNetwork = window.fetch;
      window.fetch = (input, options) => {
        const target = new URL(typeof input === "string" ? input : input.url, location.href);
        if (target.hostname === "jarvis-auth-service.dexproject.workers.dev" && target.pathname.startsWith("/api/auth/")) {
          return fetchNetwork(target.pathname.replace("/api/auth/", "/fixture/"), options);
        }
        return fetchNetwork(input, options);
      };
      const capability = Promise.withResolvers();
      window.releaseFallbackCapability = () => {
        localStorage.setItem("fixture-fallback-capability", "available");
        capability.resolve({ settings: {}, availability: "configured", cloudFallbackAvailable: true });
      };
      if (localStorage.getItem("fixture-fallback-capability")) window.releaseFallbackCapability();
      const key = (accountId) => "fixture-history:" + accountId;
      const sessionKey = "fixture-fallback-session";
      window.assistantAPI = {
        restoreAccountSession: async () => JSON.parse(localStorage.getItem(sessionKey)) || { token: null, user: null },
        saveAccountSession: async ({ token, user, remember }) => {
          const session = { token, user, remembered: remember };
          localStorage.setItem(sessionKey, JSON.stringify(session));
          return session;
        },
        clearAccountSession: async () => { localStorage.removeItem(sessionKey); },
        getConversationModelSettings: () => capability.promise,
        loadChatHistory: async (accountId) => localStorage.getItem(key(accountId)),
        saveChatHistory: async (accountId, value) => {
          if (window.holdFallbackSave && JSON.parse(value).allowCloudFallback === false) {
            window.holdFallbackSave = false;
            await new Promise((resolve, reject) => {
              window.rejectFallbackSave = () => reject(new Error("Fixture preference write failure"));
            });
          }
          localStorage.setItem(key(accountId), value);
        },
      };
    });
    await page.goto(url.href);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();
    const composer = page.getByRole("textbox", { name: "Message input" });
    const on = page.getByRole("button", { name: "Jarvis Cloud fallback on", exact: true });
    const off = page.getByRole("button", { name: "Configured connection only", exact: true });
    const dialog = page.getByRole("dialog", { name: "Jarvis Cloud fallback" });
    const choice = dialog.getByRole("checkbox", { name: "Allow Jarvis Cloud fallback" });
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    async function send(number) {
      await composer.fill("Test request " + number);
      await composer.press("Enter");
      await page.getByText("Fixture reply " + number, { exact: true }).waitFor();
    }

    await send(1);
    assert.equal(await on.count(), 0);
    await page.evaluate(() => window.releaseFallbackCapability());
    await on.waitFor();
    await composer.fill("Keep the current draft");
    await on.press("Enter");
    await dialog.getByText(/up to ten recent text messages/).waitFor();
    assert.equal(await choice.isChecked(), true);
    assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    await choice.uncheck();
    await page.evaluate(() => { window.holdFallbackSave = true; });
    await save.click();
    await page.waitForFunction(() => typeof window.rejectFallbackSave === "function");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await off.waitFor();
    assert.equal(await composer.inputValue(), "Keep the current draft");
    await send(2);
    await page.evaluate(() => window.rejectFallbackSave());
    await send(3);
    await off.click();
    assert.equal(await choice.isChecked(), false);
    await save.click();
    await dialog.waitFor({ state: "hidden" });
    await page.reload();
    await off.waitFor();
    await send(4);
    await off.click();
    await choice.check();
    await save.click();
    await on.waitFor();
    await send(5);

    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await page.getByRole("button", { name: "Temporary Chat", exact: true }).click();
    assert.equal(await on.count(), 0);
    await send(6);
    assert.deepEqual(requests, [
      { allowCloudFallback: false, mode: "persistent" },
      { allowCloudFallback: false, mode: "persistent" },
      { allowCloudFallback: false, mode: "persistent" },
      { allowCloudFallback: false, mode: "persistent" },
      { allowCloudFallback: true, mode: "persistent" },
      { allowCloudFallback: false, mode: "temporary" },
    ]);
  } finally {
    await browser.close();
  }
});
