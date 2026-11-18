const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { setExternalLlmSettingsProvider, listInstalledModels } = require("../../src/main/ollama-service.cjs");
const { testSavedModelConnection } = require("../../src/main/model-connection.cjs");

test("connection check sends one short request to the saved model and requires usable text", async (t) => {
  const requests = [];
  let result = "valid";
  const server = createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.end(JSON.stringify({ models: [{ name: "fixture-model" }] }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) });
    if (result === "stall") return;
    if (result === "rejected") res.statusCode = 401;
    res.end(JSON.stringify(result === "valid" ? { message: { content: "Ready" } } : {}));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); setExternalLlmSettingsProvider(null); });
  const url = "http://127.0.0.1:" + server.address().port;
  setExternalLlmSettingsProvider(() => ({ provider: "ollama", ollama: { model: "fixture-model", url } }));

  assert.deepEqual(await listInstalledModels({ forceRefresh: true, url }), ["fixture-model"]);
  assert.deepEqual(await testSavedModelConnection(), { status: "responded", provider: "ollama", model: "fixture-model" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/chat");
  assert.deepEqual(requests[0].body.messages.map(({ role }) => role), ["system", "user"]);
  assert.equal(requests[0].body.messages[1].content, "Ready?");

  result = "empty";
  assert.equal((await testSavedModelConnection()).status, "failed");
  result = "rejected";
  assert.equal((await testSavedModelConnection()).status, "failed");
  result = "stall";
  assert.equal((await testSavedModelConnection({ signal: AbortSignal.timeout(40) })).status, "timeout");

  setExternalLlmSettingsProvider(() => ({ provider: "openai-cli" }));
  assert.equal((await testSavedModelConnection()).status, "cli");
  assert.equal(requests.length, 4);
});

test("saved keyless compatible endpoint can be tested without transmitting any conversation", async (t) => {
  const variables = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "JARVIS_COMPLEX_LLM_URL", "JARVIS_COMPLEX_LLM_API_KEY"];
  const previous = new Map(variables.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.OPENAI_API_KEY = "fixture-origin-key";
  process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
  delete process.env.JARVIS_COMPLEX_LLM_URL;
  delete process.env.JARVIS_COMPLEX_LLM_API_KEY;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, undefined);
    assert.equal(JSON.parse(Buffer.concat(chunks).toString()).messages.at(-1).content, "Ready?");
    res.end(JSON.stringify({ choices: [{ message: { content: "Ready" } }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); setExternalLlmSettingsProvider(null); });
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  setExternalLlmSettingsProvider(() => ({ provider: "openai-compatible", openai: { model: "local-chat", baseUrl } }));
  assert.equal((await testSavedModelConnection()).status, "responded");
});
