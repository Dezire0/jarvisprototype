const test = require("node:test");
const assert = require("node:assert/strict");

const { ObsService } = require("../../src/main/obs-service.cjs");

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
