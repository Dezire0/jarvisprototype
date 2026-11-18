const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;
const authHost = "jarvis-auth-service.dexproject.workers.dev";
const fixtureToken = "plan-fixture-token";

test("cloud plan supports keyboard selection, retry, and local tools while signed in", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000
}, async () => {
  const url = new URL(testUrl);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 420, height: 560 },
      colorScheme: "light",
      locale: "en-US"
    });
    page.setDefaultTimeout(4000);

    const savedPlans = [];
    const planResponses = [503, 401, 200];
    await page.route("**/*", async (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if (target.origin !== url.origin) return route.abort();
      if (target.pathname === "/fixture-account/login") {
        return route.fulfill({
          json: {
            token: fixtureToken,
            user: { id: "plan-fixture", email: "plan@example.invalid", plan: "free" }
          }
        });
      }
      if (target.pathname === "/fixture-account/plan") {
        assert.equal(request.method(), "PUT");
        assert.equal(request.headers().authorization, "Bearer " + fixtureToken);
        const { plan } = request.postDataJSON();
        savedPlans.push(plan);
        const status = planResponses.shift();
        assert.ok(status, "Unexpected plan submission");
        return route.fulfill({ status, json: { success: status === 200, plan } });
      }
      return route.continue();
    });
    await page.addInitScript((host) => {
      const fetchFromBrowser = window.fetch;
      window.fetch = (input, options) => {
        const request = new URL(typeof input === "string" ? input : input.url, location.href);
        if (request.hostname === host && request.pathname.startsWith("/api/auth/")) {
          return fetchFromBrowser(request.pathname.replace("/api/auth/", "/fixture-account/"), options);
        }
        return fetchFromBrowser(input, options);
      };
    }, authHost);

    async function signIn() {
      await page.getByLabel("Email", { exact: true }).fill("plan@example.invalid");
      await page.getByLabel("Password", { exact: true }).fill("fixture-password");
      await page.getByRole("button", { name: "Continue with Email" }).click();
      await page.getByRole("heading", { name: "Choose a cloud plan" }).waitFor();
    }

    await page.goto(url.href);
    await signIn();
    const free = page.getByRole("radio", { name: "Free" });
    const pro = page.getByRole("radio", { name: "Pro" });
    const continueFree = page.getByRole("button", { name: "Continue with Free" });
    const continuePro = page.getByRole("button", { name: "Continue with Pro" });
    const bounds = await continueFree.boundingBox();
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 560);

    await page.getByRole("link", { name: "Local tools" }).click();
    await page.waitForURL("**/tools");
    await page.goBack();
    await continueFree.waitFor();
    await page.keyboard.press("Tab");
    assert.equal(await free.evaluate((radio) => radio === document.activeElement), true);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    assert.equal(await pro.isChecked(), true);
    await page.keyboard.press("Tab");
    assert.equal(await continuePro.evaluate((button) => button === document.activeElement), true);
    assert.equal(await continuePro.evaluate((button) => getComputedStyle(button).outlineWidth), "2px");
    await page.keyboard.press("Enter");
    await page.getByRole("alert").filter({ hasText: "Couldn’t save your plan" }).waitFor();
    assert.equal(await pro.isChecked(), true);

    await continuePro.click();
    await page.getByRole("alert").filter({ hasText: "Your session expired" }).waitFor();
    await signIn();
    await continueFree.click();
    await page.getByRole("button", { name: "Toggle sidebar" }).waitFor();
    assert.deepEqual(savedPlans, ["pro", "pro", "free"]);
  } finally {
    await browser.close();
  }
});
