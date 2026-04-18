const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { AssistantService } = require("../../src/main/assistant-service.cjs");
const { ExtensionsService } = require("../../src/main/extensions-service.cjs");

test("ExtensionsService loads connector aliases and skill planning hints", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-ext-"));
  const extensionsDir = path.join(workspaceRoot, "extensions");
  t.after(async () => {
    await fs.rm(workspaceRoot, {
      recursive: true,
      force: true
    });
  });

  await fs.mkdir(extensionsDir, {
    recursive: true
  });
  await fs.writeFile(
    path.join(extensionsDir, "todoist-connector.json"),
    JSON.stringify(
      {
        kind: "connector",
        name: "todoist",
        connector: {
          canonicalName: "Todoist",
          aliases: ["투두이스트", "할일앱"],
          planningHints: ["Use quick add when creating a task."]
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(
    path.join(extensionsDir, "todoist-skill.json"),
    JSON.stringify(
      {
        kind: "skill",
        name: "todoist-priority",
        apps: ["Todoist"],
        instructions: "Prefer concise task titles and due dates when the user mentions a deadline."
      },
      null,
      2
    ),
    "utf8"
  );

  const service = new ExtensionsService({
    workspaceRoot,
    fetchImpl: async () => {
      throw new Error("fetch should not be called in this test");
    }
  });

  await service.load();

  assert.equal(service.resolveConnectorAppName("투두이스트"), "Todoist");
  assert.deepEqual(service.getAppPlanningHints("Todoist"), [
    "Use quick add when creating a task.",
    "Prefer concise task titles and due dates when the user mentions a deadline."
  ]);
});

test("ExtensionsService invokes matching webhook manifests", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-hook-"));
  const extensionsDir = path.join(workspaceRoot, "extensions");
  t.after(async () => {
    await fs.rm(workspaceRoot, {
      recursive: true,
      force: true
    });
  });

  await fs.mkdir(extensionsDir, {
    recursive: true
  });
  await fs.writeFile(
    path.join(extensionsDir, "deploy-webhook.json"),
    JSON.stringify(
      {
        kind: "webhook",
        name: "deploy-runner",
        match: {
          phrases: ["배포 시작"]
        },
        webhook: {
          url: "https://example.invalid/deploy",
          responsePath: "reply"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const calls = [];
  const service = new ExtensionsService({
    workspaceRoot,
    fetchImpl: async (url, options) => {
      calls.push({
        url,
        options
      });

      return {
        ok: true,
        status: 200,
        headers: new Map([
          ["content-type", "application/json"]
        ]),
        json: async () => ({
          reply: "배포 웹훅을 실행했어요."
        })
      };
    }
  });

  await service.load();
  const result = await service.maybeHandleWebhook("지금 배포 시작해", {
    language: "ko",
    lastActiveApp: "Terminal"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.invalid/deploy");
  assert.equal(result.provider, "extension-webhook");
  assert.equal(result.reply, "배포 웹훅을 실행했어요.");
  assert.equal(result.actions[0].type, "extension_webhook");
});

test("AssistantService handles extension webhooks before normal routing", async () => {
  const service = new AssistantService({
    automation: {},
    browser: {},
    credentials: {},
    extensions: {
      async maybeHandleWebhook(input) {
        if (!input.includes("배포")) {
          return null;
        }

        return {
          reply: "외부 배포 러너를 실행했어요.",
          actions: [
            {
              type: "extension_webhook",
              target: "deploy-runner",
              status: "executed"
            }
          ],
          provider: "extension-webhook"
        };
      },
      resolveConnectorAppName(value) {
        return value;
      },
      getAppPlanningHints() {
        return [];
      }
    },
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleInput("배포 시작해");

  assert.equal(result.provider, "extension-webhook");
  assert.equal(result.reply, "외부 배포 러너를 실행했어요.");
  assert.equal(result.actions[0].target, "deploy-runner");
});
