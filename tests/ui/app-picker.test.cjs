const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("the app picker puts focus in search and requires an explicit named location", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const url = new URL(testUrl);
  assert.equal(url.origin, "http://127.0.0.1:" + url.port);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", reducedMotion: "reduce", viewport: { width: 420, height: 560 } });
    page.setDefaultTimeout(4000);
    let chatRequests = 0;
    await page.route("**/*", (route) => {
      const target = new URL(route.request().url());
      if (target.origin !== url.origin) return route.abort();
      if (target.pathname === "/fixture-account/login") return route.fulfill({ json: {
        token: "app-picker-fixture", user: { id: "app-picker", email: "apps@example.invalid", plan: "free" },
      } });
      if (target.pathname === "/fixture-account/plan") return route.fulfill({ json: { success: true, plan: "free" } });
      if (target.pathname === "/api/chat") chatRequests++;
      return route.continue();
    });
    await page.addInitScript(() => {
      const fetchNetwork = window.fetch;
      window.fetch = (input, options) => {
        const target = new URL(typeof input === "string" ? input : input.url, location.href);
        if (target.hostname === "jarvis-auth-service.dexproject.workers.dev" && target.pathname.startsWith("/api/auth/")) {
          return fetchNetwork(target.pathname.replace("/api/auth/", "/fixture-account/"), options);
        }
        return fetchNetwork(input, options);
      };
      let account = { token: null, user: null };
      window.appPickerCalls = [];
      window.assistantAPI = {
        restoreAccountSession: async () => account,
        saveAccountSession: async ({ token, user }) => (account = { token, user }),
        getComputerControl: async () => true,
        invokeTool: async (tool, payload) => {
          window.appPickerCalls.push({ tool, payload });
          if (tool === "apps:catalog") return {
            ok: true, data: { supported: true, revision: 5, more: false, apps: [
              { id: "1", name: "Studio", location: "/Applications/Studio.app" },
              { id: "2", name: "Studio", location: "/Volumes/Fixture/Studio.app" },
            ] },
          };
          return { ok: true, data: { name: "Studio" } };
        },
      };
    });
    await page.goto(url.href);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("apps@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();
    const composer = page.getByRole("textbox", { name: "Message input" });
    await composer.fill("find an app Studio");
    await composer.press("Enter");
    const panel = page.getByRole("dialog", { name: "Apps", exact: true });
    const input = panel.getByRole("textbox", { name: "App name" });
    const first = panel.getByRole("button", { name: "Open Studio · /Applications/Studio.app", exact: true });
    const other = panel.getByRole("button", { name: "Open Studio · /Volumes/Fixture/Studio.app", exact: true });
    await first.waitFor();
    await other.waitFor();
    await page.waitForFunction(() => document.activeElement?.tagName === "INPUT" && document.activeElement.value === "Studio");
    assert.deepEqual(await page.evaluate(() => window.appPickerCalls), [
      { tool: "apps:catalog", payload: { query: "Studio", refresh: false } },
    ]);
    await other.press("Enter");
    await panel.getByText("Asked the system to open Studio.").waitFor();
    assert.deepEqual(await page.evaluate(() => window.appPickerCalls.at(-1)), {
      tool: "apps:open-selected", payload: { id: "2", revision: 5 },
    });
    assert.equal(await input.inputValue(), "Studio");
    assert.equal(chatRequests, 0);
  } finally {
    await browser.close();
  }
});
