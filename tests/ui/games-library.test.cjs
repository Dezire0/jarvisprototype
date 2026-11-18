const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("game commands prefill the chosen store and leave lookup and install to explicit controls", {
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
        token: "games-fixture", user: { id: "games-review", email: "games@example.invalid", plan: "free" },
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
      window.gameCalls = [];
      window.assistantAPI = {
        restoreAccountSession: async () => account,
        saveAccountSession: async ({ token, user }) => (account = { token, user }),
        getComputerControl: async () => true,
        invokeTool: async (tool, payload) => {
          window.gameCalls.push({ tool, payload });
          if (tool === "games:search") return {
            ok: true, data: { revision: 1, results: [{ id: "201", name: "Astral Survey" }, { id: "202", name: "Astral Survey Demo" }] },
          };
          if (tool === "games:install") return { ok: true, data: { destination: "steam-install" } };
          return { ok: false, reason: "Unexpected fixture action" };
        },
      };
    });
    await page.goto(url.href);
    await page.getByLabel("Email", { exact: true }).fill("games@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();

    const composer = page.getByRole("textbox", { name: "Message input" });
    const panel = page.getByRole("dialog", { name: "Games", exact: true });
    const query = panel.getByRole("textbox", { name: "Game name" });
    const store = panel.getByRole("combobox", { name: "Store", exact: true });
    await composer.fill("find on Epic Games Astral Survey");
    await composer.press("Enter");
    await panel.waitFor();
    assert.equal(await store.inputValue(), "epic");
    assert.equal(await query.inputValue(), "Astral Survey");
    assert.deepEqual(await page.evaluate(() => window.gameCalls), []);
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });

    await composer.fill("find game Astral Survey");
    await composer.press("Enter");
    await panel.waitFor();
    assert.equal(await store.inputValue(), "steam");
    assert.equal(await query.inputValue(), "Astral Survey");
    await panel.getByRole("button", { name: "Search Steam", exact: true }).press("Enter");
    const matches = panel.getByRole("combobox", { name: "Search results" });
    await matches.waitFor();
    const install = panel.getByRole("button", { name: "Send install request to Steam" });
    assert.equal(await install.isDisabled(), true);
    await matches.selectOption("202");
    await install.press("Enter");
    await panel.getByText("Install request sent to Steam. Check its progress in Steam.").waitFor();
    assert.deepEqual(await page.evaluate(() => window.gameCalls), [
      { tool: "games:search", payload: { gameName: "Astral Survey" } },
      { tool: "games:install", payload: { id: "202", revision: 1 } },
    ]);
    assert.equal(chatRequests, 0);
  } finally {
    await browser.close();
  }
});
