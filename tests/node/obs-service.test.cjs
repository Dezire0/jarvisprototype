const test = require("node:test");
const assert = require("node:assert/strict");

const { ObsService } = require("../../src/main/obs-service.cjs");
const { AssistantService } = require("../../src/main/assistant-service.cjs");
const { startObsFixture } = require("../fixtures/obs-websocket.cjs");

test("ObsService connect returns a friendly message when OBS is offline", async () => {
  const service = new ObsService();
  service.client.connect = async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:4455");
  };

  await assert.rejects(
    () => service.connect(),
    /Could not reach OBS WebSocket at ws:\/\/127\.0\.0\.1:4455/
  );
});

test("OBS status, scene changes and approved transitions use the real v5 WebSocket protocol", async (t) => {
  const fixture = await startObsFixture();
  t.after(() => fixture.close());
  const service = new ObsService();
  const { address, password } = fixture;
  await assert.rejects(service.connect({ address, password: "invalid" }), { code: "OBS_AUTH" });
  await service.connect({ address, password });
  assert.equal((await service.status()).currentScene, "Opening");
  assert.equal((await service.switchScene("Slides")).currentScene, "Slides");
  const assertAllowed = () => {};
  let confirmations = 0;
  const confirm = async (status) => {
    confirmations++;
    assert.equal(status.currentScene, "Slides");
    assert.equal(status.address, address);
    return true;
  };
  await assert.rejects(service.setStreaming(true), { code: "OBS_PERMISSION" });
  assert.equal((await service.setStreaming(true, { assertAllowed, confirm: async () => false })).outcome, "cancelled");
  assert.equal(fixture.state.active, false);
  assert.equal((await service.setStreaming(true, { assertAllowed, confirm })).data.outputActive, true);
  assert.equal((await service.setStreaming(true, { assertAllowed, confirm })).outcome, "unchanged");
  assert.equal((await service.setStreaming(false, { assertAllowed, confirm })).data.outputActive, false);
  assert.equal(confirmations, 2);
  assert.deepEqual(fixture.calls.filter((call) => /^(Start|Stop)Stream$/.test(call)), ["StartStream", "StopStream"]);
});

test("changed scene, desktop permission, and lost connection invalidate OBS approval", async (t) => {
  const fixture = await startObsFixture();
  t.after(() => fixture.close());
  const service = new ObsService();
  await service.connect({ address: fixture.address, password: fixture.password });
  await assert.rejects(service.setStreaming(true, {
    assertAllowed() {},
    async confirm() { fixture.state.scene = "Slides"; return true; },
  }), { code: "OBS_CHANGED" });
  let allowed = true;
  await assert.rejects(service.setStreaming(true, {
    assertAllowed() {
      if (!allowed) throw Object.assign(new Error("Approval revoked"), { code: "OBS_PERMISSION" });
    },
    async confirm() { allowed = false; return true; },
  }), { code: "OBS_PERMISSION" });
  await assert.rejects(service.setStreaming(true, {
    assertAllowed() {},
    async confirm() {
      await assert.rejects(service.setStreaming(true, { assertAllowed() {}, async confirm() { return true; } }),
        { code: "OBS_BUSY" });
      await service.client.disconnect();
      return true;
    },
  }), { code: "OBS_CHANGED" });
  assert.equal(fixture.calls.includes("StartStream"), false);
});

test("OBS validates addresses and the model route cannot transition a broadcast", async () => {
  const service = new ObsService();
  for (const address of ["https://example.invalid", "ws://x:fixture@127.0.0.1:4455", "ws://127.0.0.1:4455/?token=fixture"]) {
    await assert.rejects(service.connect({ address }), { code: "OBS_ADDRESS" });
  }
  const assistant = new AssistantService({ obs: {}, computerControl: { enabled: false } });
  assistant.handleModelConversation = () => assert.fail("Exact OBS commands stay local");
  assert.match((await assistant.handleInput("방송 시작")).reply, /로컬 도구/);
  for (const route of ["obs_start", "obs_stop"]) {
    const result = await assistant.handleObsRoute("OBS broadcast request", { route });
    assert.match(result.reply, /Open OBS in Local tools/);
    assert.deepEqual(result.actions, []);
  }
});
