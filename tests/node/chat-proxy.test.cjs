const assert = require("node:assert/strict");
const { test } = require("node:test");
const { POST } = require("../../Jarvis Ui/templates/cloud/app/api/chat/route.ts");

function request() {
  return new Request("http://127.0.0.1/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"commands":[]}',
  });
}

test("chat proxy preserves a successful stream and its protocol headers", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.body, '{"commands":[]}');
    assert.equal(options.method, "POST");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response("streamed result", { headers: { "x-vercel-ai-data-stream": "v1" } });
  });

  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-vercel-ai-data-stream"), "v1");
  assert.equal(await response.text(), "streamed result");
});

test("chat proxy reports an unavailable local assistant without forwarding connection details", async (t) => {
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
