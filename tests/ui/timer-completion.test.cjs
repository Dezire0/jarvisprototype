const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("standalone tools share one completion across tabs and do not replay it on reload", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const url = new URL("/tools", testUrl);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: "en-US", reducedMotion: "reduce" });
    let chatRequests = 0;
    await context.route("**/*", (route) => {
      const target = new URL(route.request().url());
      if (target.origin !== url.origin) return route.abort();
      if (target.pathname === "/api/chat") chatRequests++;
      return route.continue();
    });
    await context.addInitScript(() => {
      window.spokenTimerResults = [];
      window.speechSynthesis.speak = (utterance) => window.spokenTimerResults.push(utterance.text);
    });
    const first = await context.newPage();
    const second = await context.newPage();
    for (const page of [first, second]) page.setDefaultTimeout(8000);

    const status = (page) => page.getByRole("status").filter({ hasText: "Timer finished" });
    const command = (page) => page.getByRole("textbox", { name: "Local command" });
    const send = async (page, text) => {
      await command(page).fill(text);
      await command(page).press("Enter");
    };
    const readCompletions = (page) => page.evaluate(() => {
      const workspace = JSON.parse(localStorage.getItem("jarvis-local-workspace:v1"));
      return workspace.activity.filter(({ kind }) => kind === "timer-complete");
    });
    const spokenCompletions = (page) => page.evaluate(() =>
      window.spokenTimerResults.filter((label) => label === "Timer finished").length,
    );

    await Promise.all([first.goto(url.href), second.goto(url.href)]);
    await send(first, "speak on");
    await send(first, "timer 2 seconds");
    await Promise.all([status(first).waitFor(), status(second).waitFor()]);
    const completions = await readCompletions(first);
    assert.equal(completions.length, 1);
    for (const page of [first, second]) {
      assert.equal(await status(page).count(), 1);
      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("pageshow"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }
    assert.equal((await spokenCompletions(first)) + (await spokenCompletions(second)), 1);

    await second.reload();
    await status(second).waitFor();
    assert.equal(await spokenCompletions(second), 0);
    assert.deepEqual(await readCompletions(second), completions);
    await send(second, "reset timer");
    await Promise.all([status(first).waitFor({ state: "hidden" }), status(second).waitFor({ state: "hidden" })]);
    assert.deepEqual(await readCompletions(first), completions);
    assert.equal(chatRequests, 0);
  } finally {
    await browser.close();
  }
});
