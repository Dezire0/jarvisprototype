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
    }
  });

  assert.equal(view.provider, "auto");
  assert.equal(view.gemini.configured, true);
  assert.equal(view.gemini.model, "gemini-2.5-pro");
  assert.deepEqual(view.web, {
    provider: "",
    model: "auto"
  });
});

test("settings store normalizes legacy Claude conversation settings to supported providers", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-settings-store-"));
  const settingsPath = path.join(tmpDir, "jarvis-settings.json");

  await fs.writeFile(
    settingsPath,
    JSON.stringify({
      version: 1,
      conversationModel: {
        provider: "claude-code",
        openai: {
          model: "gpt-4o-mini",
          baseUrl: "",
          apiKeyEncrypted: ""
        },
        anthropic: {
          model: "claude-sonnet-4-6",
          baseUrl: "https://api.anthropic.com/v1/messages",
          apiKeyEncrypted: ""
        },
        gemini: {
          model: "gemini-2.5-flash",
          apiKeyEncrypted: ""
        },
        ollama: {
          model: "qwen3:14b",
          url: ""
        },
        web: {
          provider: "claude",
          model: "claude-sonnet-4-6"
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
  const view = store.getConversationModelSettingsView();

  assert.equal(view.provider, "auto");
  assert.deepEqual(view.web, {
    provider: "",
    model: "auto"
  });
});

test("conversation model settings tolerate undecryptable stored secrets", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-settings-store-"));
  const originalWarn = console.warn;
  let warnCount = 0;

  console.warn = () => {
    warnCount += 1;
  };

  try {
    const store = new SettingsStore({
      app: {
        getPath() {
          return tmpDir;
        }
      }
    });

    store.cache = {
      version: 1,
      geminiApiKeyEncrypted: "broken-legacy-key",
      conversationModel: {
        provider: "openai-compatible",
        openai: {
          model: "gpt-5.4",
          baseUrl: "",
          apiKeyEncrypted: "broken-openai-key"
        },
        anthropic: {
          model: "claude-haiku-4-5",
          baseUrl: "",
          apiKeyEncrypted: ""
        },
        gemini: {
          model: "gemini-2.5-flash",
          apiKeyEncrypted: "broken-gemini-key"
        },
        ollama: {
          model: "qwen3:14b",
          url: ""
        },
        web: {
          provider: "chatgpt",
          model: "chatgpt-auto"
        }
      },
      tts: {
        providers: {
          en: "auto",
          ko: "auto"
        },
        elevenlabs: {
          modelEn: "eleven_flash_v2_5",
          modelKo: "eleven_multilingual_v2",
          voiceEn: "",
          voiceKo: "",
          apiKeyEncrypted: ""
        },
        cartesia: {
          modelId: "sonic-3",
          voiceEn: "",
          voiceKo: "",
          apiKeyEncrypted: ""
        },
        naverClova: {
          speakerEn: "matt",
          speakerKo: "vyuna",
          clientIdEncrypted: "",
          clientSecretEncrypted: ""
        },
        openai: {
          model: "gpt-4o-mini-tts",
          voiceEn: "marin",
          voiceKo: "marin",
          apiKeyEncrypted: ""
        },
        gemini: {
          model: "gemini-3.1-flash-tts-preview",
          voiceEn: "Aoede",
          voiceKo: "Kore",
          apiKeyEncrypted: ""
        },
        google: {
          credentialsPath: ""
        }
      }
    };

    const settings = store.getConversationModelSettings();

    assert.equal(settings.openai.apiKey, "");
    assert.equal(settings.gemini.apiKey, "");
    assert.equal(store.getGeminiApiKey(), "");
    assert.ok(warnCount >= 2);
  } finally {
    console.warn = originalWarn;
  }
});
