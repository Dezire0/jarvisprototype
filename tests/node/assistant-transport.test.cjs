const assert = require("node:assert/strict");
const { test } = require("node:test");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { createAssistantTransportServer } = require("../../src/main/assistant-transport-server.cjs");
const { prefix: attachmentPrefix } = require("../../src/main/assistant/attachment-contract.json");
const { SESSION_HEADER, attachDesktopChatHeader, createDesktopSessionToken } = require("../../src/main/desktop-session.cjs");

const payload = {
  threadId: "thread-1",
  commands: [{ type: "add-message", message: { role: "user", parts: [{ type: "text", text: "fixture request" }] } }],
};

test("assistant transport has no browser-to-desktop authentication callback", async (t) => {
  const server = createAssistantTransportServer({
    port: 0,
    sessionToken: createDesktopSessionToken(),
    createAssistantForThread: () => ({}),
  });
  await server.start();
  t.after(() => server.stop());
  const response = await fetch(new URL("/auth/callback", server.url));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: "Not found" });
});

test("exact file reads keep their turns out of the following model history", async (t) => {
  const token = createDesktopSessionToken();
  const calls = [];
  const server = createAssistantTransportServer({
    port: 0,
    sessionToken: token,
    createAssistantForThread: () => ({
      async setSessionContext(context) { calls.push(context.stateMessages); },
      async handleInput(input) {
        if (input === "read file /tmp/screen.txt") {
          return {
            reply: "File read.",
            details: { filePreview: { name: "screen.txt", text: "Private preview", truncated: false } },
          };
        }
        return { reply: "General conversation" };
      },
    }),
  });
  await server.start();
  t.after(() => server.stop());

  async function send(text, state) {
    const response = await fetch(server.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [SESSION_HEADER]: token },
      body: JSON.stringify({
        threadId: "file-history",
        commands: [{ type: "add-message", message: { role: "user", parts: [{ type: "text", text }] } }],
        state,
      }),
    });
    assert.equal(response.status, 200);
    const frames = (await response.text()).split("\n").filter((line) => line.startsWith("aui-state:"))
      .flatMap((line) => JSON.parse(line.slice("aui-state:".length)));
    const next = frames.shift().value;
    for (const frame of frames) {
      const [, index, key] = frame.path;
      const message = next.messages[index];
      message[key] = frame.type === "append-text" ? message[key] + frame.value : frame.value;
    }
    return next;
  }
  const regular = await send("A general request");
  const read = await send("read file /tmp/screen.txt", regular);
  assert.deepEqual(read.messages.map((message) => message.attachmentReview), [false, false, true, true]);
  assert.equal(read.messages.at(-1).details.filePreview.text, "Private preview");
  assert.deepEqual(calls, [[]]);
  await send("A follow-up request", read);
  assert.deepEqual(calls.at(-1).map((message) => message.text), ["A general request", "General conversation"]);
});

test("the conversation stream emits only allowlisted memory categories for regular replies", async (t) => {
  const token = createDesktopSessionToken();
  const fixtureResult = {
    reply: "Fixture answer",
    memorySources: ["conversation", "personal", "personal", "/fixture/private.md", { category: "document" }],
  };
  const server = createAssistantTransportServer({
    port: 0,
    sessionToken: token,
    createAssistantForThread: () => ({
      async handleInput() { return fixtureResult; },
      async handleAttachmentInput() { return fixtureResult; },
    }),
  });
  await server.start();
  t.after(() => server.stop());
  const send = async (body) => {
    const response = await fetch(server.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [SESSION_HEADER]: token },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.text();
  };

  const regular = await send(payload);
  assert.match(regular, /"memorySources"\],"value":\["personal","conversation"\]/);
  assert.doesNotMatch(regular, /private\.md/);
  const temporary = await send({ ...payload, memoryContext: { memoryMode: "temporary" } });
  assert.doesNotMatch(temporary, /memorySources/);
  const attachment = await send({
    ...payload,
    commands: [{
      type: "add-message",
      message: {
        role: "user",
        parts: [{ type: "text", text: attachmentPrefix + JSON.stringify({ kind: "text", name: "test.txt", text: "Fixture file" }) }],
      },
    }],
  });
  assert.match(attachment, /"attachmentReview":true/);
  assert.doesNotMatch(attachment, /memorySources/);
});

test("assistant validates session and JSON before resolving or invoking a thread", async (t) => {
  const token = createDesktopSessionToken();
  const resolved = [];
  const invoked = [];
  const server = createAssistantTransportServer({
    port: 0,
    sessionToken: token,
    createAssistantForThread(threadId) {
      resolved.push(threadId);
      return {
        async handleInput(text) {
          invoked.push(text);
          return { reply: "fixture response", provider: "fixture" };
        },
      };
    },
  });
  await server.start();
  t.after(() => server.stop());

  const post = (header, body = JSON.stringify(payload)) => fetch(server.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...header },
    body,
  });

  for (const header of [{}, { [SESSION_HEADER]: createDesktopSessionToken() }]) {
    assert.equal((await post(header)).status, 401);
  }
  const authorized = { [SESSION_HEADER]: token };
  assert.equal((await post({ ...authorized, "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post(authorized, "{")).status, 400);
  assert.equal((await post(authorized, '{"commands":{}}')).status, 400);
  assert.equal((await post(authorized, "x".repeat(8 * 1024 * 1024 + 1))).status, 413);
  assert.deepEqual(resolved, []);

  const response = await post(authorized);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-vercel-ai-data-stream"), "v1");
  const text = await response.text();
  assert.match(text, /fixture response/);
  assert.match(text, /finishReason/);
  assert.doesNotMatch(text, new RegExp(token));
  assert.deepEqual(resolved, ["thread-1"]);
  assert.deepEqual(invoked, ["fixture request"]);
});

test("assistant stops before running a command when the client disconnects while loading context", async (t) => {
  const token = createDesktopSessionToken();
  const { promise: context, resolve } = Promise.withResolvers();
  let invoked = false;
  const server = createAssistantTransportServer({
    port: 0,
    sessionToken: token,
    createAssistantForThread: () => ({
      setSessionContext: () => context,
      async handleInput() { invoked = true; return {}; },
    }),
  });
  await server.start();
  t.after(async () => {
    resolve();
    await server.stop();
  });

  const controller = new AbortController();
  const response = await fetch(server.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", [SESSION_HEADER]: token },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });

  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  controller.abort();
  await assert.rejects(reader.read(), { name: "AbortError" });
  // Closing the server waits for the cancelled connection to finish before the
  // test releases the context lookup. The observable command must be untouched.
  await server.stop();
  resolve();
  await nextTurn();
  assert.equal(invoked, false);
});

test("the same thread ID gets separate Assistants for each account and memory mode", async (t) => {
  const token = createDesktopSessionToken();
  const created = [];
  const server = createAssistantTransportServer({
    port: 0,
    sessionToken: token,
    async createAssistantForThread(threadId, context) {
      assert.equal(threadId, payload.threadId);
      created.push([context.accountId, context.memoryMode]);
      let count = 0;
      return { async handleInput() { return { reply: "Turn " + ++count }; } };
    },
  });
  await server.start();
  t.after(() => server.stop());

  async function send(memoryContext) {
    const response = await fetch(server.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [SESSION_HEADER]: token },
      body: JSON.stringify({ ...payload, memoryContext }),
    });
    assert.equal(response.status, 200);
    return response.text();
  }

  const regular = { accountId: "account-a" };
  const temporary = { ...regular, memoryMode: "temporary" };
  assert.match(await send(regular), /Turn 1/);
  assert.match(await send({ accountId: "account-b" }), /Turn 1/);
  assert.match(await send(temporary), /Turn 1/);
  assert.match(await send({}), /Turn 1/);
  assert.match(await send(regular), /Turn 2/);
  assert.match(await send(temporary), /Turn 2/);
  assert.deepEqual(created, [
    ["account-a", "persistent"], ["account-b", "persistent"], ["account-a", "temporary"], ["", "persistent"],
  ]);
});

test("changing computer control drops prior action continuations even for the same conversation", async (t) => {
  const token = createDesktopSessionToken();
  const computerControl = { enabled: true, revision: 0 };
  const server = createAssistantTransportServer({
    port: 0,
    sessionToken: token,
    computerControl,
    createAssistantForThread() {
      let turns = 0;
      return { async handleInput() { return { reply: "Turn " + ++turns }; } };
    },
  });
  await server.start();
  t.after(() => server.stop());

  async function send() {
    const response = await fetch(server.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [SESSION_HEADER]: token },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200);
    return response.text();
  }

  assert.match(await send(), /Turn 1/);
  assert.match(await send(), /Turn 2/);
  Object.assign(computerControl, { enabled: false, revision: 1 });
  assert.match(await send(), /Turn 1/);
  Object.assign(computerControl, { enabled: true, revision: 2 });
  assert.match(await send(), /Turn 1/);
});

test("only the current desktop main frame is assigned the synthetic session header", () => {
  let onRequest;
  const origin = "http://127.0.0.1:3310";
  const mainFrame = { url: origin + "/" };
  const contents = {
    id: 1,
    mainFrame,
    isDestroyed: () => false,
    session: { webRequest: { onBeforeSendHeaders(handler) { onRequest = handler; } } },
  };
  const token = createDesktopSessionToken();
  attachDesktopChatHeader(contents, origin, token);
  const good = { webContentsId: 1, frame: mainFrame, method: "POST", url: origin + "/api/chat", requestHeaders: {} };
  let response;
  const dispatch = (details) => onRequest(details, (value) => { response = value; });
  dispatch(good);
  assert.equal(response.requestHeaders[SESSION_HEADER], token);

  dispatch({ ...good, frame: { url: origin }, requestHeaders: { "X-Jarvis-Desktop-Session": token, test: "kept" } });
  assert.deepEqual(response.requestHeaders, { test: "kept" });
  dispatch({ ...good, webContentsId: 2 });
  assert.equal(response.requestHeaders[SESSION_HEADER], undefined);
  dispatch({ ...good, url: "https://example.invalid/api/chat", requestHeaders: { [SESSION_HEADER]: token } });
  assert.equal(response.requestHeaders[SESSION_HEADER], undefined);
});
