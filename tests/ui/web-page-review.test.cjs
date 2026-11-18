const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("the desktop page review reads on demand, discards closed reviews, and attaches edited text on request", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000
}, async () => {
  const url = new URL(testUrl);
  assert.equal(url.origin, "http://127.0.0.1:" + url.port);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", reducedMotion: "reduce", viewport: { width: 420, height: 560 } });
    page.setDefaultTimeout(4000);
    const chatRequests = [];
    await page.route("**/*", (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if (target.origin !== url.origin) return route.abort();
      if (target.pathname === "/fixture-account/login") return route.fulfill({ json: {
        token: "page-review-fixture", user: { id: "page-review", email: "review@example.invalid", plan: "free" },
      } });
      if (target.pathname === "/fixture-account/plan") return route.fulfill({ json: { success: true, plan: "free" } });
      if (target.pathname === "/api/chat") {
        chatRequests.push(request.postDataJSON());
        return route.fulfill({ status: 503, json: { error: "Fixture does not call an external model." } });
      }
      return route.continue();
    });
    await page.addInitScript(() => {
      const browserFetch = window.fetch;
      window.fetch = (input, options) => {
        const target = new URL(typeof input === "string" ? input : input.url, location.href);
        if (target.hostname === "jarvis-auth-service.dexproject.workers.dev" && target.pathname.startsWith("/api/auth/")) {
          return browserFetch(target.pathname.replace("/api/auth/", "/fixture-account/"), options);
        }
        return browserFetch(input, options);
      };
      window.reviewReads = [];
      window.reviewAddresses = [];
      let account = { token: null, user: null };
      window.assistantAPI = {
        restoreAccountSession: async () => account,
        saveAccountSession: async ({ token, user, remember }) => {
          account = { token, user, remembered: remember, canRemember: true };
          return account;
        },
        getComputerControl: async () => true,
        invokeTool: (tool, payload) => {
          window.reviewReads.push(tool);
          if (tool === "browser:read-address") window.reviewAddresses.push(payload.address);
          return new Promise((resolve) => { window.resolveReview = resolve; });
        },
      };
    });
    await page.goto(url.href);
    await page.getByLabel("Email", { exact: true }).fill("review@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();
    const composer = page.getByRole("textbox", { name: "Message input" });
    const panel = page.getByRole("dialog", { name: "Read web page", exact: true });
    const read = panel.getByRole("button", { name: "Read page", exact: true });
    const preview = panel.getByRole("textbox", { name: "Page text" });

    await composer.fill("summarize the current page");
    await composer.press("Enter");
    await panel.waitFor();
    assert.deepEqual(await page.evaluate(() => window.reviewReads), []);
    assert.equal(chatRequests.length, 0);

    await read.press("Enter");
    await panel.getByText("Reading page…").waitFor();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    await page.evaluate(() => window.resolveReview({
      ok: true, data: { title: "Discarded page", origin: "https://fixture.invalid", text: "Discarded contents", truncated: false }
    }));

    await composer.fill("review url https://requested.invalid/Document?key=fixture");
    await composer.press("Enter");
    const address = panel.getByRole("textbox", { name: "Page address" });
    await address.waitFor();
    assert.equal(await address.inputValue(), "https://requested.invalid/Document?key=fixture");
    assert.equal(await address.evaluate((input) => input === document.activeElement), true);
    assert.equal(await panel.getByRole("button", { name: "Web address", exact: true }).getAttribute("aria-pressed"), "true");
    assert.deepEqual(await page.evaluate(() => window.reviewAddresses), []);
    await address.fill("file:///example");
    await address.press("Enter");
    await panel.getByRole("alert").getByText("Enter an HTTP or HTTPS address without a username or password.").waitFor();
    assert.deepEqual(await page.evaluate(() => window.reviewAddresses), []);
    await address.fill("https://requested.invalid/Document?key=fixture");
    await panel.getByRole("button", { name: "Open and read", exact: true }).click();
    await panel.getByText("Reading page…").waitFor();
    assert.deepEqual(await page.evaluate(() => window.reviewAddresses), ["https://requested.invalid/Document?key=fixture"]);
    await page.evaluate(() => window.resolveReview({
      ok: true, data: { title: "New Page", origin: "https://redirected.invalid", text: "Page loaded from an address", truncated: false }
    }));
    await panel.getByText("https://redirected.invalid", { exact: true }).waitFor();
    assert.equal(await preview.inputValue(), "Page loaded from an address");
    assert.equal(chatRequests.length, 0);
    await panel.getByRole("button", { name: "Current page", exact: true }).click();
    await read.waitFor();
    assert.equal(await preview.count(), 0);
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });

    await composer.fill("Keep this draft.");
    await page.getByRole("button", { name: "Local tools", exact: true }).click();
    await page.getByRole("button", { name: "Read web page", exact: true }).click();
    await read.press("Enter");
    await page.evaluate(() => window.resolveReview({
      ok: true, data: { title: "Fixture title", origin: "https://fixture.invalid", text: "Unreviewed page text", truncated: true }
    }));
    await panel.getByText("Fixture title", { exact: true }).waitFor();
    await panel.getByText("https://fixture.invalid", { exact: true }).waitFor();
    await panel.getByText("Only part of the recognized text is shown.").waitFor();
    await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA" && document.activeElement.value === "Unreviewed page text");
    assert.equal(await preview.inputValue(), "Unreviewed page text");
    await preview.fill("Reviewed synopsis.");
    await panel.getByRole("button", { name: "Attach to draft" }).click();
    await panel.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Remove file Web page text.txt" }).waitFor();
    assert.equal(await composer.inputValue(), "Keep this draft.");
    assert.deepEqual(await page.evaluate(() => window.reviewReads), ["browser:read", "browser:read-address", "browser:read"]);
    assert.equal(chatRequests.length, 0);
    const chat = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/chat");
    await composer.press("Enter");
    await chat;
    assert.equal(chatRequests.length, 1);
    const payload = JSON.stringify(chatRequests[0]);
    assert.match(payload, /Reviewed synopsis/);
    assert.doesNotMatch(payload, /Unreviewed|Discarded|fixture\.invalid|Fixture title/);
  } finally {
    await browser.close();
  }
});
