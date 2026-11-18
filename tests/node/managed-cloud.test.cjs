const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { test } = require("node:test");
const { AssistantService } = require("../../src/main/assistant-service.cjs");
const { createManagedCloudChat } = require("../../src/main/assistant/managed-cloud.cjs");
const { setExternalLlmSettingsProvider } = require("../../src/main/ollama-service.cjs");

async function fixture(t) {
  let directStatus = 503;
  let cloudStatus = 200;
  let cloudCode = "";
  const cloudRequests = [];
  const directRequests = [];
  let redirectHits = 0;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    const data = text ? JSON.parse(text) : null;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/chat/completions") {
      directRequests.push(data);
      res.writeHead(directStatus).end(JSON.stringify(directStatus === 200
        ? { choices: [{ message: { content: "Direct response" } }] }
        : { error: "fixture direct outage" }));
      return;
    }
    if (req.url === "/api/ai/chat") {
      cloudRequests.push({ data, token: req.headers.authorization });
      if (cloudStatus === 307) {
        res.writeHead(307, { Location: "/redirect-target" }).end();
        return;
      }
      const pro = req.headers.authorization === "Bearer pro-fixture";
      res.writeHead(cloudStatus).end(JSON.stringify(cloudStatus === 200
        ? { success: true, reply: "Cloud reply [ACTION: OPEN_APP] Fixture", model: pro ? "gemini-3.5-flash" : "gemini-3.5-flash-lite" }
        : { code: cloudCode, error: "fixture-private-provider-details", messageEn: "fixture-private-provider-details" }));
      return;
    }
    if (req.url === "/redirect-target") redirectHits++;
    res.writeHead(404).end("{}");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  setExternalLlmSettingsProvider(() => ({
    provider: "openai-compatible",
    openai: { baseUrl, model: "fixture-direct" }
  }));
  t.after(() => setExternalLlmSettingsProvider(null));

  function assistant({ tier, enabled = true, computerControl = false }) {
    const service = new AssistantService({
      computerControl: { enabled: computerControl },
      readAccountSession: () => tier ? { token: tier + "-fixture", user: { id: tier, plan: tier } } : null,
      managedCloudChat: createManagedCloudChat({ enabled, baseUrl }),
      memory: {
        formatForPrompt: () => "private local fixture context",
        getProjectContext: () => ({ name: "private project context" }),
        searchConversation: () => [{ scope: "project", role: "user", content: "private conversation context" }],
        searchDocuments: () => [{ scope: "project", path: "/fixture/report.txt", excerpt: "private document context" }],
      },
    });
    service.routeInput = async () => ({ route: "chat", language: "en" });
    service.handleAppOpen = () => assert.fail("Managed chat must remain text-only");
    return service;
  }

  return {
    assistant,
    cloudRequests,
    directRequests,
    setCloudStatus(status, code = "") { cloudStatus = status; cloudCode = code; },
    setDirectStatus(status) { directStatus = status; },
    getRedirectHits: () => redirectHits,
  };
}

test("the normal desktop turn uses the same managed request for both tiers after a primary failure", async (t) => {
  const test = await fixture(t);

  for (const [tier, computerControl, model] of [
    ["free", false, "gemini-3.5-flash-lite"],
    ["pro", true, "gemini-3.5-flash"],
  ]) {
    const service = test.assistant({ tier, computerControl });
    service.rememberTurn("assistant", "Previous reply");
    const result = await service.handleInput("Tell me something useful");
    assert.equal(result.provider, "jarvis-cloud-" + model);
    assert.deepEqual(result.responseSource, { provider: "jarvis-cloud", model });
    assert.match(result.reply, /^Cloud reply/);
    assert.deepEqual(result.actions, []);
    assert.equal(result.memorySources, undefined);
    const request = test.cloudRequests.at(-1);
    assert.equal(request.token, "Bearer " + tier + "-fixture");
    assert.deepEqual(request.data.messages, [
      { role: "assistant", content: "Previous reply" },
      { role: "user", content: "Tell me something useful" },
    ]);
    assert.equal(JSON.stringify(request).includes("private local fixture context"), false);
  }
  assert.equal(test.directRequests.length, 2);
  assert.ok(test.directRequests.every((request) => JSON.stringify(request).includes("private local fixture context")));
  assert.equal(test.cloudRequests.length, 2);
});

test("the normal turn keeps direct success and avoids fallback while disabled, signed out or temporary", async (t) => {
  const test = await fixture(t);
  test.setDirectStatus(200);
  const direct = await test.assistant({ tier: "free" }).handleInput("A question");
  assert.equal(direct.provider, "openai-compatible:fixture-direct");
  assert.deepEqual(direct.responseSource, { provider: "openai-compatible", model: "fixture-direct" });
  assert.equal(direct.reply, "Direct response");
  assert.deepEqual(direct.memorySources, ["personal", "conversation"]);
  test.setDirectStatus(503);

  const temporary = test.assistant({ tier: "free" });
  await temporary.setSessionContext({ memoryMode: "temporary" });
  for (const service of [test.assistant({ tier: "free", enabled: false }), test.assistant({}), temporary]) {
    const result = await service.handleInput("A question");
    assert.equal(result.provider, "model-error");
    assert.equal(result.responseSource, undefined);
  }
  assert.equal(test.cloudRequests.length, 0);
});

test("successful conversation receipts match the exact memory blocks sent to the configured model", async (t) => {
  const test = await fixture(t);
  test.setDirectStatus(200);
  const markers = {
    personal: "private local fixture context",
    project: "private project context",
    conversation: "private conversation context",
    document: "private document context",
  };
  for (const [computerControl, memoryMode, sources] of [
    [false, "persistent", ["personal", "project", "conversation"]],
    [true, "persistent", ["personal", "project", "conversation", "document"]],
    [true, "temporary", []],
    [false, "temporary", []],
  ]) {
    const service = test.assistant({ tier: "free", computerControl });
    await service.setSessionContext({ memoryMode, projectId: "fixture-project" });
    const reply = await service.handleInput("A fixture question");
    assert.equal(reply.reply, "Direct response");
    assert.deepEqual(reply.memorySources, sources);
    const prompt = JSON.stringify(test.directRequests.at(-1));
    for (const [category, marker] of Object.entries(markers)) {
      assert.equal(prompt.includes(marker), sources.includes(category), category);
    }
  }
  assert.equal(test.cloudRequests.length, 0);
});

test("managed failure messages distinguish common errors and ignore private details and redirects", async (t) => {
  const test = await fixture(t);
  const service = test.assistant({ tier: "free" });
  for (const [status, code, message] of [
    [401, "", /session expired/],
    [429, "plan_limit", /daily limit/],
    [429, "provider_limit", /Cloud is busy/],
    [502, "", /did not respond/],
    [307, "", /did not respond/],
  ]) {
    test.setCloudStatus(status, code);
    const result = await service.handleInput("A question");
    assert.equal(result.provider, "jarvis-cloud-error");
    assert.equal(result.responseSource, undefined);
    assert.match(result.reply, message);
    assert.doesNotMatch(result.reply, /fixture-private-provider-details/);
    assert.deepEqual(result.actions, []);
  }
  assert.equal(test.cloudRequests.length, 5);
  assert.equal(test.getRedirectHits(), 0);
});
