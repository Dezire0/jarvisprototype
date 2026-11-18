const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("desktop update controls keep notifications quiet and let the user check, retry and hand off", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const origin = new URL(testUrl).origin;
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", reducedMotion: "reduce", viewport: { width: 420, height: 560 } });
    page.setDefaultTimeout(5000);
    let chatCalls = 0;
    await page.route("**/*", (route) => {
      const target = new URL(route.request().url());
      if (target.origin !== origin) return route.abort();
      if (target.pathname === "/fixture-account/login") return route.fulfill({ json: {
        token: "update-token", user: { id: "update", email: "update@example.invalid", plan: "free" },
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
      let status = { version: "1.8.9", mode: "installer", state: "idle", enabled: true, manualInstall: true };
      const listeners = new Set();
      window.updateRequests = [];
      window.updateStatus = (patch) => {
        status = { ...status, ...patch };
        listeners.forEach((listener) => listener(status));
      };
      window.assistantAPI = {
        restoreAccountSession: async () => account,
        saveAccountSession: async ({ token, user }) => (account = { token, user }),
        getAppState: async () => ({ version: "1.8.9", updater: status }),
        onUpdateStatus: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        checkForUpdates: () => {
          window.updateRequests.push("check");
          return new Promise((resolve) => {
            window.finishCheck = (patch) => { window.updateStatus(patch); resolve(status); };
          });
        },
        installUpdate: async () => {
          window.updateRequests.push("install");
          return window.handoffFails
            ? { ok: false, mode: "installer" }
            : { ok: true, mode: "installer", targetUrl: "https://github.com/example/project/releases" };
        },
      };
    });
    await page.goto(origin);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("update@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();

    const composer = page.getByRole("textbox", { name: "Message input" });
    const panel = page.getByRole("dialog", { name: "Updates", exact: true });
    const sidebar = page.getByRole("button", { name: "Toggle sidebar" });
    const updates = page.getByRole("button", { name: /^Updates/ });
    const check = panel.getByRole("button", { name: "Check for updates", exact: true });
    const requests = () => page.evaluate(() => window.updateRequests);
    await composer.fill("Keep this draft.");
    await page.evaluate(() => window.updateStatus({ state: "available", availableVersion: "1.9.0" }));
    assert.equal(await panel.count(), 0);
    assert.equal(await composer.evaluate((input) => input === document.activeElement), true);
    await sidebar.click();
    await updates.getByText("New version").waitFor();
    await updates.press("Enter");
    await panel.getByText("1.8.9", { exact: true }).waitFor();
    await panel.getByText("1.9.0", { exact: true }).waitFor();
    assert.deepEqual(await requests(), []);
    await check.click();
    assert.equal(await check.isDisabled(), true);
    await panel.getByText("Checking for updates…", { exact: true }).waitFor();
    await page.evaluate(() => window.finishCheck({ state: "error" }));
    await panel.getByRole("alert").getByText("The update check or download failed. Try again.").waitFor();
    await check.click();
    await page.evaluate(() => window.finishCheck({ state: "idle", checked: true }));
    await panel.getByText("No newer compatible update found.").waitFor();
    await page.evaluate(() => window.updateStatus({ state: "available" }));
    const release = panel.getByRole("button", { name: "Open GitHub releases" });
    await page.evaluate(() => { window.handoffFails = true; });
    await release.click();
    await panel.getByRole("alert").getByText("Couldn’t open the update. Try again.").waitFor();
    await page.evaluate(() => { window.handoffFails = false; });
    await release.click();
    await panel.getByText("Sent the releases page to your default browser.").waitFor();
    await page.evaluate(() => window.updateStatus({
      state: "downloading", mode: "native", manualInstall: false, progressPercent: 37,
    }));
    assert.equal(await panel.getByRole("progressbar", { name: "Download progress" }).getAttribute("value"), "37");
    assert.equal(await check.isDisabled(), true);
    await page.evaluate(() => window.updateStatus({ state: "downloaded", downloadedVersion: "1.9.0" }));
    await panel.getByRole("button", { name: "Restart to install" }).waitFor();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    await page.waitForFunction(() => /^Updates/.test(document.activeElement?.textContent ?? ""));
    await page.getByRole("button", { name: "Close sidebar" }).click();
    assert.equal(await composer.inputValue(), "Keep this draft.");
    assert.deepEqual(await requests(), ["check", "check", "install", "install"]);
    assert.equal(chatCalls, 0);
  } finally {
    await browser.close();
  }
});
