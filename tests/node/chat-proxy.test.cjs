const assert = require("node:assert/strict");
const { test, beforeEach, afterEach } = require("node:test");
const { GET, POST } = require("../../Jarvis Ui/templates/cloud/app/api/chat/route.ts");
const { createDesktopSessionToken, desktopUiProof, SESSION_HEADER } = require("../../src/main/desktop-session.cjs");

const ui = "http://127.0.0.1:3310";
const assistantUrl = "http://127.0.0.1:8010/assistant";
const token = createDesktopSessionToken();
const environment = {
  JARVIS_UI_ORIGIN: ui,
  JARVIS_TRANSPORT_URL: assistantUrl,
  JARVIS_DESKTOP_SESSION_TOKEN: token,
};
let original;
beforeEach(() => {
  original = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
});
afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request(headers = {}, body = '{"commands":[]}') {
  return new Request(ui + "/api/chat", {
    method: "POST",
    headers: { origin: ui, "content-type": "application/json", [SESSION_HEADER]: token, ...headers },
    body,
  });
}

test("desktop UI proves it has this startup session without returning the credential", async () => {
  const challenge = createDesktopSessionToken();
  const response = GET(new Request(ui + "/api/chat?challenge=" + challenge));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("x-jarvis-ui-proof"), desktopUiProof(token, challenge));
  assert.equal(await response.text(), "");
});

test("chat proxy preserves successful streams and forwards only the private transport header", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), assistantUrl);
    assert.equal(options.body.toString(), '{"commands":[]}');
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers[SESSION_HEADER], token);
    assert.equal(options.headers.Authorization, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return new Response("streamed result", { headers: { "x-vercel-ai-data-stream": "v1" } });
  });

  const response = await POST(request({ Authorization: "Bearer test-account" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-vercel-ai-data-stream"), "v1");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(await response.text(), "streamed result");
});

test("chat proxy rejects browsers, stale sessions, other origins and non-JSON before dispatch", async (t) => {
  const upstream = t.mock.method(globalThis, "fetch");
  assert.equal((await POST(request({ [SESSION_HEADER]: "" }))).status, 401);
  assert.equal((await POST(request({ [SESSION_HEADER]: createDesktopSessionToken() }))).status, 401);
  assert.equal((await POST(request({ origin: "https://example.invalid" }))).status, 403);
  assert.equal((await POST(request({ "sec-fetch-site": "same-site" }))).status, 403);
  assert.equal((await POST(request({ "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(request({}, "x".repeat(8 * 1024 * 1024 + 1)))).status, 413);
  assert.equal(upstream.mock.callCount(), 0);
});

test("chat proxy requires a configured desktop transport and declines remote endpoints", async (t) => {
  const upstream = t.mock.method(globalThis, "fetch");
  process.env.JARVIS_TRANSPORT_URL = "https://example.invalid/assistant";
  assert.equal((await POST(request())).status, 503);
  delete process.env.JARVIS_DESKTOP_SESSION_TOKEN;
  assert.equal((await POST(request())).status, 503);
  assert.equal(upstream.mock.callCount(), 0);
});

test("chat proxy reports an unavailable assistant without returning request internals", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("private upstream details");
  });
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Open Jarvis Desktop/);
});

test("chat proxy keeps an upstream rejection status without leaking the body", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("private upstream details", { status: 429 }));
  const response = await POST(request());
  assert.equal(response.status, 429);
  assert.doesNotMatch(await response.text(), /private upstream details/);
});
