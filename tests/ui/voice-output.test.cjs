const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");
const { installSpeechFixture } = require("./fixtures/speech-recognition.cjs");

const testUrl = process.env.JARVIS_UI_TEST_URL;
const answer = "한국어로 읽을 테스트 답변입니다. " + "한글".repeat(260);

test("voice output handles explicit choices and automatic replies without talking over the microphone", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 40000,
}, async () => {
  const url = new URL(testUrl);
  assert.equal(url.origin, "http://127.0.0.1:" + url.port);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", viewport: { width: 420, height: 560 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(5000);
    let replyNumber = 0;
    await page.route("**/*", (route) => {
      const target = new URL(route.request().url());
      if (target.origin !== url.origin) return route.abort();
      if (target.pathname === "/fixture-account/login") return route.fulfill({ json: {
        token: "voice-output-fixture", user: { id: "voice-output", email: "read@example.invalid", plan: "free" },
      } });
      if (target.pathname === "/fixture-account/plan") return route.fulfill({ json: { success: true, plan: "free" } });
      if (target.pathname === "/api/chat") {
        const request = route.request().postDataJSON();
        const input = request.commands[0].message.parts[0].text;
        const id = ++replyNumber;
        const messages = [
          ...(request.state?.messages ?? []),
          { id: "voice-user-" + id, role: "user", text: input, status: "complete" },
          {
            id: "voice-answer-" + id, role: "assistant", text: answer, status: "complete", provider: "fixture",
            attachmentReview: input === "Private file fixture",
          },
        ];
        return route.fulfill({
          contentType: "text/plain",
          body: "aui-state:" + JSON.stringify([{ type: "set", path: [], value: { messages } }]) +
            (input === "Interrupted fixture" ? "\n" : '\nd:{"finishReason":"stop","usage":{"inputTokens":0,"outputTokens":0}}\n'),
        });
      }
      return route.continue();
    });
    await page.addInitScript(installSpeechFixture);
    await page.addInitScript(() => {
      const browserFetch = window.fetch;
      window.fetch = (input, options) => {
        const target = new URL(typeof input === "string" ? input : input.url, location.href);
        if (target.hostname === "jarvis-auth-service.dexproject.workers.dev" && target.pathname.startsWith("/api/auth/")) {
          return browserFetch(target.pathname.replace("/api/auth/", "/fixture-account/"), options);
        }
        return browserFetch(input, options);
      };
      const events = { device: [], provider: [], play: 0, pauses: 0, deviceStops: 0 };
      window.voiceOutputFixture = events;
      const speech = new EventTarget();
      speech.getVoices = () => [
        { name: "Installed English", voiceURI: "fixture-device-en", lang: "en-US", localService: true },
        { name: "Installed Korean", voiceURI: "fixture-device-ko", lang: "ko-KR", localService: true },
        { name: "Remote English", voiceURI: "fixture-remote-en", lang: "en-US", localService: false },
      ];
      speech.speak = (utterance) => {
        events.device.push({ text: utterance.text, voice: utterance.voice.voiceURI });
        window.finishDeviceSpeech = () => utterance.onend?.();
      };
      speech.cancel = () => { events.deviceStops++; };
      Object.defineProperty(window, "speechSynthesis", { value: speech });
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      window.Audio = class {
        play() { events.play++; return Promise.resolve(); }
        pause() { events.pauses++; }
        removeAttribute() {}
      };
      let settings = {
        providers: { en: "auto", ko: "auto" },
        autoRead: { en: "off", ko: "off" },
        systemVoices: { en: "", ko: "" },
        elevenlabs: {}, naverClova: {}, gemini: {}, openai: {}, cartesia: { modelId: "sonic-3" }, google: {},
      };
      let muted = false;
      let account = { token: null, user: null, canRemember: true };
      window.assistantAPI = {
        restoreAccountSession: async () => account,
        saveAccountSession: async ({ token, user, remember }) => {
          account = { token, user, remembered: remember, canRemember: true };
          return account;
        },
        getTtsSettings: async () => ({ settings }),
        saveTtsSettings: async (draft) => {
          const { apiKey, ...cartesia } = draft.cartesia;
          settings = { ...draft, cartesia: { ...cartesia, configured: Boolean(apiKey || settings.cartesia.configured) } };
          return { settings };
        },
        getMuteState: async () => ({ muted }),
        setMuteState: async ({ muted: value }) => {
          muted = value;
          return { muted };
        },
        speakWorkspace: (payload) => {
          events.provider.push(payload);
          return new Promise((resolve) => { window.resolveSpeechFixture = resolve; });
        },
      };
    });
    await page.goto(url.href);
    await page.getByLabel("Email", { exact: true }).fill("read@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();

    const events = () => page.evaluate(() => window.voiceOutputFixture);
    const respond = (result) => page.evaluate((result) => window.resolveSpeechFixture(result), result);
    const sidebar = page.getByRole("button", { name: "Toggle sidebar" });
    await sidebar.click();
    await page.getByRole("button", { name: "Voice output", exact: true }).press("Enter");
    const dialog = page.getByRole("dialog", { name: "Voice output", exact: true });
    const language = dialog.getByLabel("Reading language");
    const engine = dialog.getByLabel("Voice engine");
    const voice = dialog.getByLabel("Installed device voice");
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    assert.equal(await engine.inputValue(), "system");
    assert.equal(await voice.getByRole("option", { name: /Remote English/ }).count(), 0);
    assert.equal((await events()).device.length, 0);
    await voice.selectOption("fixture-device-en");
    assert.equal(await dialog.getByRole("button", { name: "Preview voice" }).isDisabled(), true);
    await save.click();
    await dialog.getByText("Voice settings saved.").waitFor();
    assert.equal((await events()).device.length, 0);
    await dialog.getByRole("button", { name: "Preview voice" }).press("Enter");
    await dialog.getByText("Reading aloud", { exact: true }).waitFor();
    assert.deepEqual((await events()).device, [{ text: "Hello. This is a preview of the voice you selected.", voice: "fixture-device-en" }]);
    assert.equal((await events()).provider.length, 0);
    await dialog.getByRole("button", { name: "Stop preview" }).click();
    assert.equal((await events()).deviceStops, 1);
    const mute = dialog.getByRole("checkbox", { name: "Mute Jarvis" });
    await mute.check();
    assert.equal(await dialog.getByRole("button", { name: "Preview voice" }).isDisabled(), true);
    await mute.uncheck();

    await language.selectOption("ko");
    await engine.selectOption("cartesia");
    await dialog.getByText("Provider settings", { exact: true }).click();
    const key = dialog.getByLabel("API key", { exact: true });
    assert.equal(await key.getAttribute("type"), "password");
    await key.fill("voice-fixture-anonymous-key");
    await save.click();
    await dialog.getByText("Voice settings saved.").waitFor();
    assert.equal(await key.inputValue(), "");
    assert.deepEqual((await events()).provider, []);
    const preview = dialog.getByRole("button", { name: "Preview with Cartesia" });
    await preview.click();
    await dialog.getByText("Preparing audio…").waitFor();
    await page.waitForFunction(() => window.voiceOutputFixture.provider.length === 1);
    assert.deepEqual((await events()).provider[0], {
      text: "안녕하세요. 선택한 음성을 미리 들어보세요.", provider: "cartesia", language: "ko",
    });
    await dialog.getByRole("button", { name: "Stop preview" }).click();
    await respond({ status: "audio", mimeType: "audio/wav", audioBase64: "QUJD" });
    assert.equal((await events()).play, 0);
    await language.selectOption("en");
    assert.equal(await engine.inputValue(), "system");
    assert.equal(await voice.inputValue(), "fixture-device-en");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Close sidebar", exact: true }).click();

    const composer = page.getByRole("textbox", { name: "Message input" });
    await composer.fill("Test speech");
    await composer.press("Enter");
    await page.getByText(answer, { exact: true }).waitFor();
    const more = page.getByRole("button", { name: "More", exact: true });
    const read = page.getByRole("menuitem", { name: /Read aloud with Cartesia/ });
    await more.press("Enter");
    await read.getByText("First 500 characters").waitFor();
    assert.equal((await events()).provider.length, 1);
    await read.click();
    await page.waitForFunction(() => window.voiceOutputFixture.provider.length === 2);
    assert.deepEqual((await events()).provider[1], { text: answer.slice(0, 500), language: "ko", provider: "cartesia" });
    await respond({ status: "failed", error: "Private provider response" });
    await page.getByText("Couldn’t play audio. Check Voice output and try again.").waitFor();
    assert.equal(await page.getByText("Private provider response").count(), 0);
    await more.click();
    await read.click();
    await page.waitForFunction(() => window.voiceOutputFixture.provider.length === 3);
    await respond({ status: "audio", mimeType: "audio/wav", audioBase64: "QUJD" });
    await page.getByText("Reading aloud", { exact: true }).waitFor();
    assert.equal((await events()).play, 1);
    await page.getByRole("button", { name: "Start voice input", exact: true }).click();
    await page.getByRole("button", { name: "Stop voice input", exact: true }).waitFor();
    await page.waitForFunction(() => window.voiceOutputFixture.pauses === 1);
    assert.equal(await page.getByText("Reading aloud", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Stop voice input", exact: true }).click();
    await more.click();
    await read.click();
    await page.waitForFunction(() => window.voiceOutputFixture.provider.length === 4);
    await sidebar.click();
    await page.getByRole("button", { name: "New Chat", exact: true }).click();
    await page.getByText(answer, { exact: true }).waitFor({ state: "hidden" });
    await respond({ status: "audio", mimeType: "audio/wav", audioBase64: "QUJD" });
    assert.equal((await events()).play, 1);

    async function openVoiceSettings() {
      await sidebar.click();
      await page.getByRole("button", { name: "Voice output", exact: true }).click();
      await dialog.waitFor();
    }
    async function closeVoiceSettings() {
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
    }
    const automatic = dialog.getByLabel("Read new replies automatically");
    await openVoiceSettings();
    assert.equal(await automatic.inputValue(), "off");
    await language.selectOption("ko");
    assert.equal(await engine.inputValue(), "cartesia");
    await automatic.selectOption("system");
    await save.click();
    await dialog.getByText("Voice settings saved.").waitFor();
    await closeVoiceSettings();

    const recognitionCount = () => page.evaluate(() => window.jarvisVoiceFixture.started);
    const firstRecognition = await recognitionCount();
    await page.getByRole("button", { name: "Start continuous voice", exact: true }).click();
    await page.waitForFunction((count) => window.jarvisVoiceFixture.started === count + 1, firstRecognition);
    await page.evaluate((index) => window.jarvisVoiceFixture.deliver(index, "Automatic voice turn"), firstRecognition);
    await page.getByText("Reading aloud", { exact: true }).waitFor();
    await page.getByText("Listening resumes after playback.").waitFor();
    assert.deepEqual((await events()).device.at(-1), { text: answer.slice(0, 500), voice: "fixture-device-ko" });
    assert.equal((await events()).provider.length, 4);
    await page.waitForTimeout(550);
    assert.equal(await recognitionCount(), firstRecognition + 1);
    await page.evaluate(() => window.finishDeviceSpeech());
    await page.waitForFunction((count) => window.jarvisVoiceFixture.started === count + 2, firstRecognition);
    await page.getByRole("button", { name: "Stop continuous voice", exact: true }).click();

    await openVoiceSettings();
    assert.equal(await automatic.inputValue(), "off");
    await language.selectOption("ko");
    assert.equal(await automatic.inputValue(), "system");
    await automatic.selectOption("cartesia");
    await dialog.getByText("Sends new text replies in regular chats to Cartesia.").waitFor();
    await save.click();
    await dialog.getByText("Voice settings saved.").waitFor();
    await closeVoiceSettings();
    await composer.fill("Named automatic turn");
    await composer.press("Enter");
    await page.waitForFunction(() => window.voiceOutputFixture.provider.length === 5);
    assert.deepEqual((await events()).provider[4], { text: answer.slice(0, 500), language: "ko", provider: "cartesia", automatic: true });
    await respond({ status: "failed" });
    await page.getByText("Couldn’t play audio. Check Voice output and try again.").waitFor();
    assert.equal(await recognitionCount(), firstRecognition + 2);

    await composer.fill("Interrupted fixture");
    await composer.press("Enter");
    await page.getByRole("button", { name: "Restore draft", exact: true }).waitFor();
    assert.equal((await events()).provider.length, 5);
    await composer.fill("Private file fixture");
    await composer.press("Enter");
    await page.getByText(answer, { exact: true }).nth(2).waitFor();
    assert.equal((await events()).provider.length, 5);
    await sidebar.click();
    await page.getByRole("button", { name: "Temporary Chat", exact: true }).click();
    await composer.fill("Temporary fixture");
    await composer.press("Enter");
    await page.getByText(answer, { exact: true }).waitFor();
    assert.equal((await events()).provider.length, 5);
    await sidebar.click();
    await page.getByRole("button", { name: "Automatic voice turn", exact: true }).click();
    await page.getByText(answer, { exact: true }).first().waitFor();
    assert.equal((await events()).provider.length, 5);
  } finally {
    await browser.close();
  }
});
