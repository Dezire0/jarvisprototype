const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");
const { installSpeechFixture } = require("./fixtures/speech-recognition.cjs");

const testUrl = process.env.JARVIS_UI_TEST_URL;
const authHost = "jarvis-auth-service.dexproject.workers.dev";

test("voice preserves drafts, stays in its thread, and submits from an empty composer only", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const url = new URL(testUrl);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    let chatRequests = 0;
    await page.route("**/*", async (route) => {
      const target = new URL(route.request().url());
      if (target.origin !== url.origin) return route.abort();
      if (target.pathname === "/fixture-account/login") {
        return route.fulfill({
          json: { token: "voice-fixture", user: { id: "voice-user", email: "voice@example.invalid", plan: "free" } },
        });
      }
      if (target.pathname === "/fixture-account/plan") return route.fulfill({ json: { success: true, plan: "free" } });
      if (target.pathname === "/api/chat") {
        chatRequests++;
        const messages = [
          { id: "user-message", role: "user", text: "A spoken question", status: "complete" },
          { id: "assistant-message", role: "assistant", text: "A fixture answer", status: "complete" },
        ];
        return route.fulfill({
          contentType: "text/plain",
          body: 'aui-state:' + JSON.stringify([{ type: "set", path: [], value: { messages } }]) +
            '\nd:{"finishReason":"stop","usage":{"inputTokens":0,"outputTokens":0}}\n',
        });
      }
      return route.continue();
    });
    await page.addInitScript(installSpeechFixture);
    await page.addInitScript((host) => {
      const fetchNetwork = window.fetch;
      window.fetch = (input, options) => {
        const request = new URL(typeof input === "string" ? input : input.url, location.href);
        if (request.hostname === host && request.pathname.startsWith("/api/auth/")) {
          return fetchNetwork(request.pathname.replace("/api/auth/", "/fixture-account/"), options);
        }
        return fetchNetwork(input, options);
      };
    }, authHost);

    await page.goto(url.href);
    await page.getByLabel("Email", { exact: true }).fill("voice@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();

    const composer = page.getByRole("textbox", { name: "Message input" });
    const start = page.getByRole("button", { name: "Start voice input", exact: true });
    const stop = page.getByRole("button", { name: "Stop voice input", exact: true });
    const continuous = page.getByRole("button", { name: "Start continuous voice", exact: true });
    const deliver = (index, text, repeats = 1) => page.evaluate(
      ({ index, text, repeats }) => window.jarvisVoiceFixture.deliver(index, text, repeats), { index, text, repeats },
    );
    const waitForDraft = (text) => page.waitForFunction((value) =>
      document.querySelector('textarea[aria-label="Message input"]')?.value === value, text,
    );

    await composer.fill("Keep this draft");
    await start.click();
    await stop.waitFor();
    await deliver(0, "Spoken addition", 2);
    await waitForDraft("Keep this draft\nSpoken addition");
    await page.getByText("Voice input added to your draft.").waitFor();
    assert.equal(chatRequests, 0);

    await composer.fill("");
    const fileChooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add Attachment" }).click();
    await (await fileChooser).setFiles({
      name: "voice-test.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic file."),
    });
    const remove = page.getByRole("button", { name: "Remove file voice-test.txt" });
    await remove.waitFor();
    await start.click();
    await stop.waitFor();
    await deliver(1, "Read this file");
    await waitForDraft("Read this file");
    assert.equal(await remove.isVisible(), true);
    assert.equal(chatRequests, 0);
    await remove.click();
    await composer.fill("");

    await start.click();
    await stop.waitFor();
    await stop.click();
    await deliver(2, "Discard this transcript");
    await start.waitFor();
    await waitForDraft("");
    assert.equal(chatRequests, 0);

    await continuous.click();
    await stop.waitFor();
    await deliver(3, "Set a timer for 3 minutes", 2);
    await page.getByText("Timer started", { exact: true }).waitFor();
    await page.waitForFunction(() => window.jarvisVoiceFixture.started === 5);
    assert.equal(chatRequests, 0);
    await page.getByRole("button", { name: "Stop continuous voice" }).click();
    await start.waitFor();

    await start.click();
    await stop.waitFor();
    await deliver(5, "A spoken question", 2);
    await page.getByText("A fixture answer", { exact: true }).waitFor();
    assert.equal(chatRequests, 1);

    await continuous.click();
    await stop.waitFor();
    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await page.getByRole("button", { name: "New Chat", exact: true }).click();
    await page.getByRole("heading", { name: "What would you like to do?" }).waitFor();
    await start.waitFor();
    await continuous.waitFor();
    await composer.fill("Destination draft");
    await deliver(6, "note: stale command");
    await waitForDraft("Destination draft");
    assert.equal(chatRequests, 1);
    assert.deepEqual(await page.evaluate(() => ({
      started: window.jarvisVoiceFixture.started, aborted: window.jarvisVoiceFixture.aborted,
    })), { started: 7, aborted: 3 });

    await start.click();
    await stop.waitFor();
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await start.waitFor();
    await deliver(7, "Ignore the hidden-tab result");
    await waitForDraft("Destination draft");
    assert.equal(chatRequests, 1);
    assert.equal(await page.evaluate(() => window.jarvisVoiceFixture.aborted), 4);

  } finally {
    await browser.close();
  }
});
