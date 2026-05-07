const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_AGENT_DEPTH,
  SubAgentManager
} = require("../../src/main/subagent-manager.cjs");

test("SubAgentManager rejects sessions deeper than MAX_AGENT_DEPTH", async () => {
  const manager = new SubAgentManager({
    createRuntime: () => ({
      async runLoop() {
        return { finalSummary: "done", stopReason: "success", state: null };
      }
    })
  });

  const result = await manager.spawn({
    task: "too deep",
    agentId: "researcher",
    depth: MAX_AGENT_DEPTH + 1
  });

  assert.match(result.error, /MAX_AGENT_DEPTH/);
  assert.match(result.possible_fix, /depth/i);
});

test("SubAgentManager can list, steer, and kill a running subagent session", async () => {
  let released = false;
  let seenNotes = [];
  const manager = new SubAgentManager({
    sharedBrowser: {
      async observe() {
        return {
          url: "https://example.com",
          title: "Example",
          elements: []
        };
      }
    },
    createRuntime: ({ session }) => ({
      async runLoop(options = {}) {
        seenNotes = options.consumeExternalNotes ? options.consumeExternalNotes() : [];
        await new Promise((resolve) => setTimeout(resolve, 10));
        while (!options.abortSignal?.aborted && !released) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        if (options.abortSignal?.aborted) {
          return {
            finalSummary: "killed",
            stopReason: "killed",
            state: null
          };
        }
        return {
          finalSummary: `done:${session.agentId}`,
          stopReason: "success",
          state: null
        };
      }
    })
  });

  const spawnResult = await manager.spawn({
    task: "investigate",
    agentId: "researcher",
    depth: 1,
    parentSessionId: "root"
  });
  const sessionId = spawnResult.state.session.sessionId;

  const steerResult = await manager.steer(sessionId, "Focus on login blockers.");
  assert.equal(steerResult.error, null);

  const listed = manager.list(sessionId);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, "running");

  released = true;
  await manager.getSession(sessionId).promise;
  assert.deepEqual(seenNotes, ["Focus on login blockers."]);

  const killResult = await manager.kill(sessionId);
  assert.equal(killResult.error, null);
  assert.equal(killResult.state.session.status, "completed");
});

test("SubAgentManager marks a running session as killed after abort", async () => {
  const manager = new SubAgentManager({
    sharedBrowser: {
      async observe() {
        return {
          url: "https://example.com",
          title: "Example",
          elements: []
        };
      }
    },
    createRuntime: () => ({
      async runLoop(options = {}) {
        while (!options.abortSignal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return {
          finalSummary: "killed",
          stopReason: "killed",
          state: null
        };
      }
    })
  });

  const spawnResult = await manager.spawn({
    task: "wait forever",
    agentId: "watcher",
    depth: 1
  });
  const sessionId = spawnResult.state.session.sessionId;

  const killResult = await manager.kill(sessionId);
  assert.equal(killResult.error, null);
  await manager.getSession(sessionId).promise;

  const listed = manager.list(sessionId);
  assert.equal(listed[0].status, "killed");
});
