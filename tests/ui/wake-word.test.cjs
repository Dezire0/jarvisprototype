const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");
const { installWakeFixture } = require("./fixtures/speech-recognition.cjs");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("wake listening requires a chosen recognizer and routes only the following command", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 40000,
}, async () => {
  const url = new URL(testUrl);
  assert.equal(url.origin, "http://127.0.0.1:" + url.port);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", viewport: { width: 420, height: 560 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(6000);
    const chats = [];
    await page.route("**/*", (route) => {
      const target = new URL(route.request().url());
      if (target.origin !== url.origin) return route.abort();
      if (target.pathname === "/fixture-account/login") return route.fulfill({ json: {
        token: "wake-fixture", user: { id: "wake-user", email: "wake@example.invalid", plan: "free" },
      } });
      if (target.pathname === "/fixture-account/plan") return route.fulfill({ json: { success: true, plan: "free" } });
      if (target.pathname === "/api/chat") {
        const request = route.request().postDataJSON();
        const input = request.commands[0].message.parts[0].text;
        chats.push(input);
        const messages = [
          { id: "user-" + chats.length, role: "user", text: input, status: "complete" },
          { id: "assistant-" + chats.length, role: "assistant", text: "Fixture reply", status: "complete", provider: "fixture" },
        ];
        return route.fulfill({
          contentType: "text/plain",
          body: "aui-state:" + JSON.stringify([{ type: "set", path: [], value: { messages } }]) +
            '\nd:{"finishReason":"stop","usage":{"inputTokens":0,"outputTokens":0}}\n',
        });
      }
      return route.continue();
    });
    await page.addInitScript(installWakeFixture);
    await page.addInitScript(() => {
      const fetchNetwork = window.fetch;
      window.fetch = (input, options) => {
        const target = new URL(typeof input === "string" ? input : input.url, location.href);
        if (target.hostname === "jarvis-auth-service.dexproject.workers.dev" && target.pathname.startsWith("/api/auth/")) {
          return fetchNetwork(target.pathname.replace("/api/auth/", "/fixture-account/"), options);
        }
        return fetchNetwork(input, options);
      };
    });
    await page.clock.install();
    await page.goto(url.href);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("wake@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();

    const composer = page.getByRole("textbox", { name: "Message input" });
    const wake = page.getByRole("button", { name: "Wake word", exact: true });
    const stop = page.getByRole("button", { name: "Stop wake word", exact: true });
    const dialog = page.getByRole("dialog", { name: "Wake word", exact: true });
    const startDevice = dialog.getByRole("button", { name: "Start on-device listening" });
    const startBrowser = dialog.getByRole("button", { name: "Start with browser recognition" });
    const checkStarts = (count) => page.waitForFunction((count) => window.jarvisWakeFixture.starts.length === count, count);
    const events = () => page.evaluate(() => ({ ...window.jarvisWakeFixture, deliver: null, fail: null, end: null }));
    const say = (index, text, isFinal = true) => page.evaluate(
      ([index, text, isFinal]) => window.jarvisWakeFixture.deliver(index, text, isFinal), [index, text, isFinal],
    );

    await wake.press("Enter");
    await dialog.getByText(/may send microphone audio/).waitFor();
    assert.deepEqual((await events()).starts, []);
    await dialog.getByRole("button", { name: "Download on-device language pack" }).press("Enter");
    await startDevice.waitFor();
    assert.deepEqual((await events()).downloads, [{ langs: ["en-US"], processLocally: true }]);
    assert.deepEqual((await events()).starts, []);
    await startDevice.click();
    await page.getByText("Listening for “Jarvis” on this device").waitFor();
    assert.deepEqual((await events()).starts, [{ locale: "en-US", local: true, continuous: true }]);
    assert.equal(await stop.getAttribute("aria-pressed"), "true");
    await say(0, "An unrelated private sentence");
    await say(0, "I saw Jarvis in a movie");
    await say(0, "Jarvis, message from interim speech", false);
    assert.equal(await composer.inputValue(), "");
    assert.equal(await page.getByText(/unrelated private sentence|interim speech/).count(), 0);
    assert.deepEqual(chats, []);

    await say(0, "Jarvis.");
    await page.getByText("Say your command.").waitFor();
    await page.clock.fastForward(8001);
    await page.getByText("Listening for “Jarvis” on this device").waitFor();
    await say(0, "A command after the window expired");
    assert.deepEqual(chats, []);
    await say(0, "Hey Jarvis, timer 10 minutes");
    await page.getByText(/Timer started/).waitFor();
    assert.deepEqual(chats, []);
    await checkStarts(2);

    await say(1, "자비스");
    await page.getByText("Say your command.").waitFor();
    await page.evaluate(() => window.jarvisWakeFixture.end(1));
    await checkStarts(3);
    await page.getByText("Say your command.").waitFor();
    await say(2, "Tell me something useful");
    await page.getByText("Fixture reply", { exact: true }).waitFor();
    assert.deepEqual(chats, ["Tell me something useful"]);
    await checkStarts(4);
    await composer.fill("Keep the draft");
    await say(3, "Jarvis, add my spoken text");
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Message input"]').value === "Keep the draft\nadd my spoken text");
    assert.deepEqual(chats, ["Tell me something useful"]);
    await wake.waitFor();
    await composer.fill("");

    await wake.click();
    await startDevice.click();
    await checkStarts(5);
    await page.evaluate(() => window.jarvisWakeFixture.fail(4, "language-not-supported"));
    await page.getByText(/Check the on-device language pack/).waitFor();
    await wake.waitFor();
    await page.clock.runFor(550);
    assert.equal((await events()).starts.length, 5);

    await wake.click();
    await startBrowser.click();
    await page.getByText("Listening for “Jarvis” with browser recognition").waitFor();
    assert.equal((await events()).starts[5].local, false);
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await page.getByRole("button", { name: "New Chat", exact: true }).click();
    await wake.waitFor();
    await say(5, "Jarvis, a stale command");
    assert.deepEqual(chats, ["Tell me something useful"]);
    await wake.click();
    await startBrowser.click();
    await stop.click();
    await wake.waitFor();
    await page.clock.runFor(550);
    assert.equal((await events()).starts.length, 7);
    assert.deepEqual(chats, ["Tell me something useful"]);
  } finally {
    await browser.close();
  }
});
