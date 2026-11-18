const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("desktop quick input preserves onboarding, dialogs and the current draft", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const origin = new URL(testUrl).origin;
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", reducedMotion: "reduce", viewport: { width: 420, height: 560 } });
    page.setDefaultTimeout(4000);
    let chatCalls = 0;
    await page.route("**/*", (route) => {
      const target = new URL(route.request().url());
      if (target.origin !== origin) return route.abort();
      if (target.pathname === "/fixture-account/login") return route.fulfill({ json: {
        token: "quick-command-token", user: { id: "quick-command", email: "command@example.invalid", plan: "free" },
      } });
      if (target.pathname === "/fixture-account/plan") return route.fulfill({ json: { success: true, plan: "free" } });
      if (target.pathname === "/api/chat") {
        chatCalls++;
        return route.abort();
      }
      return route.continue();
    });
    await page.addInitScript(() => {
      const networkFetch = window.fetch;
      window.fetch = (input, options) => {
        const target = new URL(typeof input === "string" ? input : input.url, location.href);
        if (target.hostname === "jarvis-auth-service.dexproject.workers.dev" && target.pathname.startsWith("/api/auth/")) {
          return networkFetch(target.pathname.replace("/api/auth/", "/fixture-account/"), options);
        }
        return networkFetch(input, options);
      };
      let account = { token: null, user: null };
      const quickInputListeners = new Set();
      window.invokeQuickInput = () => quickInputListeners.forEach((listener) => listener());
      window.assistantAPI = {
        restoreAccountSession: async () => account,
        saveAccountSession: async ({ token, user }) => (account = { token, user }),
        getComputerControl: async () => true,
        onFocusCommandInput: (callback) => {
          quickInputListeners.add(callback);
          return () => { quickInputListeners.delete(callback); };
        },
      };
    });
    await page.goto(origin);
    const signal = () => page.evaluate(() => window.invokeQuickInput());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const email = page.getByLabel("Email", { exact: true });
    const password = page.getByLabel("Password", { exact: true });
    await email.fill("command@example.invalid");
    await password.fill("fixture-password");
    await signal();
    assert.equal(await password.evaluate((element) => element === document.activeElement), true);
    await page.getByRole("button", { name: "Continue with Email" }).click();
    const plan = page.getByRole("button", { name: "Continue with Free" });
    await plan.focus();
    await signal();
    assert.equal(await plan.evaluate((element) => element === document.activeElement), true);
    await plan.click();

    const composer = page.getByRole("textbox", { name: "Message input" });
    const toolbar = page.getByRole("button", { name: "Local tools", exact: true });
    const directory = page.getByRole("dialog", { name: "Local tools" });
    const search = directory.getByRole("textbox", { name: "Find a tool" });
    await composer.fill("Keep this draft.");
    await composer.evaluate((input) => input.setSelectionRange(5, 9));
    await toolbar.focus();
    await signal();
    assert.deepEqual(await composer.evaluate((input) => ({
      focused: input === document.activeElement, start: input.selectionStart, end: input.selectionEnd, value: input.value,
    })), { focused: true, start: 5, end: 9, value: "Keep this draft." });
    await toolbar.click();
    await search.fill("timer");
    await signal();
    assert.equal(await search.evaluate((input) => input === document.activeElement), true);
    assert.equal(await search.inputValue(), "timer");
    await page.keyboard.press("Escape");
    await directory.waitFor({ state: "hidden" });
    await signal();
    assert.equal(await composer.evaluate((input) => input === document.activeElement), true);
    assert.equal(await composer.inputValue(), "Keep this draft.");
    assert.equal(chatCalls, 0);
  } finally {
    await browser.close();
  }
});
