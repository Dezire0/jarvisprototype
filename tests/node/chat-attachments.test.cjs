const assert = require("node:assert/strict");
const { test } = require("node:test");
const contract = require("../../src/main/assistant/attachment-contract.json");
const { parseAssistantInput } = require("../../src/main/assistant/chat-attachments.cjs");
const { createAssistantTransportServer } = require("../../src/main/assistant-transport-server.cjs");
const { SESSION_HEADER, createDesktopSessionToken } = require("../../src/main/desktop-session.cjs");
const { AssistantService } = require("../../src/main/assistant-service.cjs");
const { setExternalLlmSettingsProvider } = require("../../src/main/ollama-service.cjs");

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cP6UAAAAASUVORK5CYII=";
const document = { kind: "text", name: "회의.txt", text: "Only the model should see this file text." };
const image = { kind: "image", name: "pixel.png", mimeType: "image/png", data: png };
const file = (attachment) => ({ type: "text", text: contract.prefix + JSON.stringify(attachment) });
const text = (value) => ({ type: "text", text: value });
const commands = (...parts) => [{ type: "add-message", message: { role: "user", parts } }];

test("the shared file contract bounds and validates text and raster image data", () => {
  const parsed = parseAssistantInput(commands(text("Compare these"), file(document), file(image)));
  assert.equal(parsed.text, "Compare these");
  assert.deepEqual(parsed.attachments.map(({ size, ...value }) => value), [document, image]);
  assert.equal(parseAssistantInput(commands(file(document))).text, "");
  for (const bad of [
    file({ ...document, name: "script.sh" }),
    file({ ...document, text: "x".repeat(contract.maxTextBytes + 1) }),
    file({ ...image, data: "YmFk" }),
    file({ ...image, mimeType: "image/jpeg" }),
    { type: "image", image: "https://example.invalid/image.png" },
  ]) {
    assert.throws(() => parseAssistantInput(commands(bad)), /attachment/);
  }
  assert.throws(() => parseAssistantInput(commands(...Array.from({ length: contract.maxFiles + 1 }, () => file(image)))), /message limit/);
});

test("authenticated file-only turns bypass the automation path and stream labels without file bytes", async (t) => {
  const token = createDesktopSessionToken();
  const reviewed = [];
  const server = createAssistantTransportServer({
    port: 0,
    sessionToken: token,
    createAssistantForThread: () => ({
      async setSessionContext() { assert.fail("File reviews must not load automation context"); },
      async handleInput() { assert.fail("File reviews must not dispatch an action"); },
      async handleAttachmentInput(input, attachments, { signal }) {
        reviewed.push({ input, attachments, signal });
        return { reply: "Review complete", actions: [{ target: "must-not-stream" }] };
      },
    }),
  });
  await server.start();
  t.after(() => server.stop());
  const post = (...parts) => fetch(server.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", [SESSION_HEADER]: token },
    body: JSON.stringify({ commands: commands(...parts) }),
  });
  const invalid = await post(file({ ...image, data: "invalid" }));
  assert.equal(invalid.status, 422);
  await invalid.text();
  assert.equal(reviewed.length, 0);

  const response = await post(file(document), file(image));
  assert.equal(response.status, 200);
  const wire = await response.text();
  assert.match(wire, /회의\.txt/);
  assert.match(wire, /pixel\.png/);
  assert.match(wire, /Review complete/);
  assert.equal(wire.includes(png), false);
  assert.equal(wire.includes(document.text), false);
  assert.equal(wire.includes("must-not-stream"), false);
  assert.equal(reviewed[0].input, "");
  assert.deepEqual(reviewed[0].attachments.map(({ size, ...value }) => value), [document, image]);
  assert.ok(reviewed[0].signal instanceof AbortSignal);
});

test("closing a file review stream aborts the provider request", { timeout: 4000 }, async (t) => {
  const token = createDesktopSessionToken();
  const cancelled = Promise.withResolvers();
  const started = Promise.withResolvers();
  const server = createAssistantTransportServer({
    port: 0,
    sessionToken: token,
    createAssistantForThread: () => ({
      async handleAttachmentInput(_input, _files, { signal }) {
        started.resolve();
        await new Promise((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", resolve, { once: true });
        });
        cancelled.resolve();
        return { reply: "" };
      },
    }),
  });
  await server.start();
  t.after(() => server.stop());
  const controller = new AbortController();
  const response = await fetch(server.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", [SESSION_HEADER]: token },
    body: JSON.stringify({ commands: commands(file(document)) }),
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  await started.promise;
  controller.abort();
  await cancelled.promise;
});

test("attachment review sends each direct-model format and never executes reply text", async (t) => {
  const input = "Read the selected files";
  const replyText = "[ACTION: OPEN_APP] Calculator";
  const fakeUrl = "http://127.0.0.1:12345";
  const assistant = new AssistantService({
    automation: { execute() { assert.fail("An attachment must never act on an app"); } },
  });
  let request;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.method, "POST");
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    request = { url: String(url), body };
    return Response.json({
      message: { content: replyText },
      choices: [{ message: { content: replyText } }],
      candidates: [{ content: { parts: [{ text: replyText }] } }],
    });
  });
  t.after(() => setExternalLlmSettingsProvider(null));

  const settings = {
    ollama: { model: "vision-fixture", url: fakeUrl + "/api/chat" },
    openai: { model: "vision-fixture", baseUrl: fakeUrl + "/v1", apiKey: "test-fixture-key" },
    groq: { chatModel: "vision-fixture", apiKey: "test-fixture-key" },
    gemini: { model: "vision-fixture", apiKey: "test-fixture-key" },
  };
  for (const provider of ["ollama", "openai-compatible", "groq", "gemini"]) {
    setExternalLlmSettingsProvider(() => ({ ...settings, provider }));
    const result = await assistant.handleAttachmentInput(input, [document, image]);
    assert.equal(result.reply, replyText, provider);
    assert.deepEqual(result.actions, []);
    assert.match(result.provider, new RegExp("^" + provider + ":"));
    if (provider === "gemini") {
      const parts = request.body.contents.at(-1).parts;
      assert.deepEqual(parts[1], { inlineData: { mimeType: "image/png", data: png } });
      assert.equal(JSON.parse(parts[0].text).documents[0].text, document.text);
    } else {
      const message = request.body.messages.at(-1);
      if (provider === "ollama") {
        assert.equal(request.url, fakeUrl + "/api/chat");
        assert.deepEqual(message.images, [png]);
        assert.equal(JSON.parse(message.content).documents[0].text, document.text);
      } else {
        assert.deepEqual(message.content[1], { type: "image_url", image_url: { url: "data:image/png;base64," + png } });
        assert.equal(JSON.parse(message.content[0].text).request, input);
      }
    }
  }

  setExternalLlmSettingsProvider(() => ({ provider: "openai-cli" }));
  request = null;
  assert.match((await assistant.handleAttachmentInput(input, [document])).reply, /Choose a direct model/);
  assert.equal(request, null);
});
