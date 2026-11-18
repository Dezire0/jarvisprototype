const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("Spotify prefill leaves handoffs explicit and clears the reported state after a denied read", {
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
        token: "spotify-fixture", user: { id: "spotify-review", email: "music@example.invalid", plan: "free" },
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
      window.spotifyCalls = [];
      window.spotifyDenied = false;
      window.assistantAPI = {
        restoreAccountSession: async () => account,
        saveAccountSession: async ({ token, user }) => (account = { token, user }),
        getComputerControl: async () => true,
        invokeTool: async (tool, payload) => {
          window.spotifyCalls.push({ tool, payload });
          if (tool === "spotify:availability") return { ok: true, data: { native: "available" } };
          if (tool === "spotify:search") return { ok: true, data: { destination: "search" } };
          if (window.spotifyDenied) return { ok: false, reason: "SPOTIFY_OS_PERMISSION" };
          return { ok: true, data: { state: "paused", title: "Fixture song", artist: "Fixture artist", requested: false } };
        },
      };
    });
    await page.goto(url.href);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("music@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();

    const composer = page.getByRole("textbox", { name: "Message input" });
    const panel = page.getByRole("dialog", { name: "Spotify", exact: true });
    const input = panel.getByRole("textbox", { name: "Search term or Spotify link" });
    await composer.fill("Spotify search Evening Jazz");
    await composer.press("Enter");
    await panel.getByRole("button", { name: "Play", exact: true }).waitFor();
    assert.equal(await input.inputValue(), "Evening Jazz");
    assert.deepEqual(await page.evaluate(() => window.spotifyCalls), [{ tool: "spotify:availability", payload: {} }]);

    await input.press("Enter");
    await panel.getByText("Asked your browser to open Spotify search.").waitFor();
    assert.deepEqual(await page.evaluate(() => window.spotifyCalls.at(-1)), {
      tool: "spotify:search", payload: { text: "Evening Jazz" },
    });
    await panel.getByRole("button", { name: "Check playback" }).press("Enter");
    await panel.getByText("Fixture song", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("button", { name: "Pause", exact: true }).count(), 0);
    await page.evaluate(() => { window.spotifyDenied = true; });
    await panel.getByRole("button", { name: "Check playback" }).click();
    await panel.getByRole("alert").getByText(/Privacy & Security/).waitFor();
    assert.equal(await panel.getByText("Fixture song", { exact: true }).count(), 0);
    assert.equal(chatRequests, 0);
  } finally {
    await browser.close();
  }
});
