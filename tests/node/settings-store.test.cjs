const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SettingsStore } = require("../../src/main/settings-store.cjs");

test("conversation settings view does not decrypt stored API keys", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-settings-store-"));
  const settingsPath = path.join(tmpDir, "jarvis-settings.json");

  await fs.writeFile(
    settingsPath,
    JSON.stringify({
      version: 1,
      conversationModel: {
        provider: "auto",
        openai: {
          model: "gpt-4o-mini",
          baseUrl: "",
          apiKeyEncrypted: ""
        },
        anthropic: {
          model: "claude-haiku-4-5",
          baseUrl: "",
          apiKeyEncrypted: ""
        },
        gemini: {
          model: "gemini-2.5-flash",
          apiKeyEncrypted: "not-a-valid-safe-storage-payload"
        },
        ollama: {
          model: "qwen3:14b",
          url: ""
        },
        web: {
          provider: "gemini",
          model: "gemini-2.5-flash"
        }
      }
    }),
    "utf8"
  );

  const store = new SettingsStore({
    app: {
      getPath() {
        return tmpDir;
      }
    }
  });

  await store.load();
  const view = await store.updateConversationModelSettings({
    provider: "auto",
    gemini: {
      apiKey: "",
      model: "gemini-2.5-pro"
    },
    web: {
      provider: "gemini",
      model: "gemini-2.5-pro"
    }
  });

  assert.equal(view.provider, "auto");
  assert.equal(view.gemini.configured, true);
  assert.equal(view.gemini.model, "gemini-2.5-pro");
  assert.deepEqual(view.web, {
    provider: "gemini",
    model: "gemini-2.5-pro"
  });
});
