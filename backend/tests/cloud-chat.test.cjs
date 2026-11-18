const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { readFile, readdir } = require("node:fs/promises");
const { createRequire } = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, Response } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const backend = path.join(__dirname, "..");
const origin = "https://jarvis-test.example.invalid";
const providerKey = "cloud-chat-fixture-secret";

const bundledWorker = build({
  entryPoints: [path.join(backend, "src/index.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  write: false,
  logLevel: "silent",
});

async function setup(t, outboundService, bindings = {}) {
  const script = (await bundledWorker).outputFiles[0].text;
  const worker = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2024-04-05",
    bindings: {
      JARVIS_SESSION_SIGNING_KEY: randomBytes(32).toString("hex"),
      GEMINI_API_KEY: providerKey,
      ...bindings,
    },
    d1Databases: ["DB"],
    outboundService,
  });
  t.after(() => worker.dispose());

  const db = await worker.getD1Database("DB");
  const migrationDir = path.join(backend, "migrations");
  for (const name of (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = await readFile(path.join(migrationDir, name), "utf8");
    const statements = sql.split("--> statement-breakpoint").map((line) => line.trim()).filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
  }

  function request(route, { token, method = "GET", body } = {}) {
    return worker.dispatchFetch(origin + route, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  async function signIn(tier) {
    const body = { email: tier + "@example.invalid", password: "fixture-password" };
    assert.equal((await request("/api/auth/register", { method: "POST", body })).status, 200);
    const login = await request("/api/auth/login", { method: "POST", body });
    assert.equal(login.status, 200);
    const { token, user } = await login.json();
    if (tier === "pro") {
      const plan = await request("/api/auth/plan", { token, method: "PUT", body: { plan: tier } });
      assert.equal(plan.status, 200);
    }
    return { token, id: user.id };
  }

  return { db, request, signIn };
}

const requestBody = {
  messages: [
    { role: "user", content: "First message" },
    { role: "assistant", content: "Previous answer" },
    { role: "user", content: "Follow up" },
  ],
  language: "en",
};

test("Free and Pro choose their account models, report usage, and handle concurrent replies", { timeout: 30000 }, async (t) => {
  const calls = [];
  const { request, signIn } = await setup(t, async (upstream) => {
    calls.push({
      method: upstream.method,
      url: upstream.url,
      apiKey: upstream.headers.get("x-goog-api-key"),
      session: upstream.headers.get("authorization"),
      body: await upstream.json(),
    });
    return Response.json({
      candidates: [{ content: { parts: [
        { thought: true, text: "internal fixture trace" },
        { text: "A " },
        { text: "cloud reply." },
      ] } }],
      usageMetadata: { totalTokenCount: 12 },
    });
  });
  const free = await signIn("free");
  const pro = await signIn("pro");
  const chat = (token) => request("/api/ai/chat", { token, method: "POST", body: requestBody });
  const usage = async (token) => (await request("/api/ai/usage", { token })).json();

  assert.equal((await chat()).status, 401);
  assert.equal(calls.length, 0);
  for (const [account, model, tier] of [
    [free, "gemini-3.5-flash-lite", "free"],
    [pro, "gemini-3.5-flash", "pro"],
  ]) {
    const response = await chat(account.token);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.reply, "A cloud reply.");
    assert.equal(data.model, model);
    assert.equal(data.plan, tier);
    const { method, url, apiKey, session, body } = calls.at(-1);
    assert.equal(method, "POST");
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
    assert.equal(apiKey, providerKey);
    assert.equal(session, null);
    assert.deepEqual(body.contents.map(({ role }) => role), ["user", "model", "user"]);
    assert.equal(body.generationConfig.maxOutputTokens, tier === "pro" ? 8192 : 2048);
    assert.equal((await usage(account.token)).model, model);
  }

  await Promise.all([chat(free.token), chat(free.token)]).then((responses) => {
    for (const response of responses) assert.equal(response.status, 200);
  });
  assert.equal((await usage(free.token)).messagesUsed, 3);
  assert.equal((await usage(pro.token)).tokensUsed, 12);
});

test("malformed requests, quota failures, and invalid provider replies leave usage unchanged", { timeout: 30000 }, async (t) => {
  let calls = 0;
  let providerResponse;
  const { db, request, signIn } = await setup(t, () => {
    calls++;
    return providerResponse();
  }, { JARVIS_CLOUD_FREE_MODEL: "gemini-3.8-flash" });
  const free = await signIn("free");
  const chat = (body = requestBody) => request("/api/ai/chat", { token: free.token, method: "POST", body });
  const usage = async () => (await request("/api/ai/usage", { token: free.token })).json();

  for (const input of ["{", { messages: [null] }, { messages: [{ role: "assistant", content: "Only reply" }] }]) {
    assert.equal((await chat(input)).status, 400);
  }
  assert.equal(calls, 0);
  assert.equal((await usage()).model, "gemini-3.8-flash");

  for (const [status, code, respond] of [
    [502, "provider_unavailable", () => Response.json({ detail: providerKey }, { status: 401 })],
    [502, "provider_unavailable", () => new Response(null, { status: 307, headers: { Location: "https://redirect.example.invalid" } })],
    [429, "provider_limit", () => Response.json({ detail: providerKey }, { status: 429 })],
    [502, "provider_empty", () => new Response("not JSON")],
    [502, "provider_empty", () => Response.json({ candidates: [{ content: { parts: [{ thought: true, text: providerKey }] } }] })],
  ]) {
    providerResponse = respond;
    const response = await chat();
    assert.equal(response.status, status);
    const text = await response.text();
    assert.equal(text.includes(providerKey), false);
    assert.equal(JSON.parse(text).code, code);
    assert.equal((await usage()).messagesUsed, 0);
  }

  await db.prepare("UPDATE users SET daily_message_count = ?, last_message_date = ? WHERE id = ?")
    .bind(15, new Date().toISOString().slice(0, 10), free.id).run();
  const limit = await chat();
  assert.equal(limit.status, 429);
  assert.equal((await limit.json()).code, "plan_limit");
  assert.equal(calls, 5);
});

test("an invalid model or missing provider key stops before provider access", { timeout: 30000 }, async (t) => {
  const { request, signIn } = await setup(t, () => assert.fail("The provider must not be contacted"), {
    GEMINI_API_KEY: "",
    JARVIS_CLOUD_PRO_MODEL: "gemini-invalid?foo",
  });
  const free = await signIn("free");
  const pro = await signIn("pro");
  assert.equal((await request("/api/ai/usage", { token: pro.token })).status, 503);
  for (const account of [free, pro]) {
    const reply = await request("/api/ai/chat", { token: account.token, method: "POST", body: requestBody });
    assert.equal(reply.status, 503);
    assert.equal((await reply.json()).code, "cloud_configuration");
  }
});
