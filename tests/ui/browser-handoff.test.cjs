const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("direct browser controls hand off only on submit and preserve the conversation draft", {
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
        token: "browser-handoff-token", user: { id: "handoff", email: "handoff@example.invalid", plan: "free" },
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
      window.handoffs = [];
      window.assistantAPI = {
        restoreAccountSession: async () => account,
        saveAccountSession: async ({ token, user }) => (account = { token, user }),
        getComputerControl: async () => true,
        invokeTool: (tool, request) => {
          window.handoffs.push({ tool, ...request });
          return new Promise((resolve) => { window.finishHandoff = resolve; });
        },
      };
    });
    await page.goto(origin);
    await page.getByLabel("Email", { exact: true }).fill("handoff@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();

    const composer = page.getByRole("textbox", { name: "Message input" });
    const directory = page.getByRole("dialog", { name: "Local tools" });
    const row = directory.getByRole("button", { name: "Open browser", exact: true });
    const panel = page.getByRole("dialog", { name: "Open browser", exact: true });
    const address = panel.getByRole("textbox", { name: "Page address" });
    const open = panel.getByRole("button", { name: "Open in browser" });
    const query = panel.getByRole("textbox", { name: "Search query" });
    const search = panel.getByRole("button", { name: "Search on Google" });
    const handoffs = () => page.evaluate(() => window.handoffs);
    await composer.fill("Keep this draft.");
    await page.getByRole("button", { name: "Local tools", exact: true }).click();
    await directory.getByRole("textbox", { name: "Find a tool" }).fill("Google search");
    await row.press("Enter");
    await address.waitFor();
    assert.equal(await address.evaluate((input) => input === document.activeElement), true);
    assert.equal(await panel.evaluate((element) => element.getBoundingClientRect().height <= innerHeight), true);

    await address.fill("https://person:password@example.invalid");
    await address.press("Enter");
    await panel.getByRole("alert").getByText("Enter an HTTP or HTTPS address without a username or password.").waitFor();
    assert.deepEqual(await handoffs(), []);
    await address.fill("https://example.invalid/docs");
    await panel.getByRole("button", { name: "Google search", exact: true }).click();
    await query.fill("한글 & test");
    await panel.getByRole("button", { name: "Web address", exact: true }).click();
    assert.equal(await address.inputValue(), "https://example.invalid/docs");
    assert.deepEqual(await handoffs(), []);

    await open.click();
    await panel.getByText("Opening browser…").waitFor();
    await address.press("Enter");
    assert.deepEqual(await handoffs(), [{ tool: "browser:handoff", mode: "address", input: "https://example.invalid/docs" }]);
    await page.evaluate(() => window.finishHandoff({ ok: false, reason: "BROWSER_HANDOFF_FAILED" }));
    await panel.getByRole("alert").getByText("Couldn’t open the browser.", { exact: false }).waitFor();
    assert.equal(await address.inputValue(), "https://example.invalid/docs");
    await panel.getByRole("button", { name: "Google search", exact: true }).click();
    assert.equal(await query.inputValue(), "한글 & test");
    await search.click();
    await panel.getByText("Opening browser…").waitFor();
    await page.evaluate(() => window.finishHandoff({ ok: true }));
    await panel.getByText("Sent to your default browser.").waitFor();
    await search.click();
    await panel.getByText("Opening browser…").waitFor();
    await panel.getByRole("button", { name: "Back to local tools" }).click();
    await row.waitFor();
    await page.evaluate(() => window.finishHandoff({ ok: true }));
    assert.equal(await row.evaluate((button) => button === document.activeElement), true);
    await page.keyboard.press("Escape");
    await directory.waitFor({ state: "hidden" });
    assert.equal(await composer.inputValue(), "Keep this draft.");
    assert.deepEqual((await handoffs()).slice(1), Array.from({ length: 2 },
      () => ({ tool: "browser:handoff", mode: "search", input: "한글 & test" })));
    assert.equal(chatCalls, 0);
  } finally {
    await browser.close();
  }
});
