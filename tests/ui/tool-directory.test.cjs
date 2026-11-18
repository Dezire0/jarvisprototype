const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("the local tools directory filters, opens focused tools, and restores the selected row", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const url = new URL(testUrl);
  assert.equal(url.origin, "http://127.0.0.1:" + url.port);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", reducedMotion: "reduce", viewport: { width: 420, height: 560 } });
    page.setDefaultTimeout(5000);
    let chatRequests = 0;
    await page.route("**/*", (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if (target.origin !== url.origin) return route.abort();
      if (target.pathname === "/fixture-account/login") return route.fulfill({ json: {
        token: "directory-fixture", user: { id: "tool-directory", email: "tools@example.invalid", plan: "free" },
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
      window.toolReads = [];
      window.assistantAPI = {
        restoreAccountSession: async () => account,
        saveAccountSession: async ({ token, user }) => (account = { token, user }),
        getComputerControl: async () => false,
        invokeTool: async (name) => { window.toolReads.push(name); return { ok: true }; },
        readHostDiagnostics: async () => {
          window.toolReads.push("diagnostics");
          return { cpuPercent: 17, memoryPercent: 42 };
        },
      };
    });
    await page.goto(url.href);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("tools@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();

    const toolbar = page.getByRole("button", { name: "Local tools", exact: true });
    const directory = page.getByRole("dialog", { name: "Local tools", exact: true });
    const search = directory.getByRole("textbox", { name: "Find a tool" });
    const screenRow = directory.getByRole("button", { name: "Read screen", exact: true });
    await toolbar.press("Enter");
    await directory.getByRole("region", { name: "Apps and services" }).waitFor();
    assert.equal(await directory.locator("[data-tool-id]").count(), 18);
    assert.equal(await directory.getByRole("button", { name: "Open browser", exact: true }).count(), 1);
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Find a tool");
    await search.fill("nonesuch");
    await directory.getByText("No matching tools.").waitFor();
    await directory.getByRole("button", { name: "Clear search" }).click();
    assert.equal(await directory.locator("[data-tool-id]").count(), 18);
    await search.fill("ocr");
    assert.equal(await directory.locator("[data-tool-id]").count(), 1);
    await search.press("ArrowDown");
    assert.equal(await screenRow.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press("Enter");
    const screen = page.getByRole("dialog", { name: "Read screen", exact: true });
    await screen.waitFor();
    assert.equal(await screen.getByRole("button", { name: "Read text", exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.toolReads), []);
    await screen.getByRole("button", { name: "Back to local tools" }).click();
    await screenRow.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-tool-id") === "screen");
    assert.equal(await search.inputValue(), "ocr");
    await page.keyboard.press("ArrowUp");
    assert.equal(await search.evaluate(node => node === document.activeElement), true);

    await search.fill("cpu");
    await search.press("Enter");
    const diagnostics = page.getByRole("dialog", { name: "Diagnostics", exact: true });
    await diagnostics.waitFor();
    assert.deepEqual(await page.evaluate(() => window.toolReads), []);
    await diagnostics.getByRole("button", { name: "Measure system usage" }).press("Enter");
    await diagnostics.getByText(/CPU 17%/).waitFor();
    assert.deepEqual(await page.evaluate(() => window.toolReads), ["diagnostics"]);
    await page.keyboard.press("Escape");
    await diagnostics.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Local tools");

    const timer = page.getByRole("button", { name: "Timer", exact: true });
    await timer.click();
    const timerPanel = page.getByRole("dialog", { name: "Timer", exact: true });
    await timerPanel.getByRole("timer").waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Start");
    assert.equal(await timerPanel.getByRole("button", { name: "Back to local tools" }).count(), 0);
    assert.equal(await timerPanel.getByRole("textbox", { name: "Local command" }).count(), 0);
    assert.ok(await timerPanel.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    assert.equal(chatRequests, 0);
  } finally {
    await browser.close();
  }
});
