const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { SettingsStore } = require("../../src/main/settings-store.cjs");

test("failed settings replacement preserves committed values and concurrent edits are serialized", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-atomic-settings-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const app = { getPath: () => directory };
  const store = new SettingsStore({ app });
  const original = await store.updateConversationModelSettings({ provider: "ollama", ollama: { model: "original-model" } });
  const temporary = store.settingsPath + ".tmp";
  await fs.mkdir(temporary);
  await assert.rejects(store.updateConversationModelSettings({ provider: "openai-compatible" }));
  assert.deepEqual(store.getConversationModelSettingsView(), original);
  const reopened = new SettingsStore({ app });
  await reopened.load();
  assert.deepEqual(reopened.getConversationModelSettingsView(), original);
  await fs.rmdir(temporary);
  await Promise.all([
    store.updateConversationModelSettings({ ollama: { model: "new-model" } }),
    store.updateTtsSettings({ openai: { model: "voice-model" }, systemVoices: { ko: "fixture-ko", en: "fixture-en" } }),
    store.updateConversationModelSettings({ ollama: { url: "http://127.0.0.1:11434" } }),
  ]);
  await reopened.load();
  assert.deepEqual(reopened.getConversationModelSettingsView().ollama, { model: "new-model", url: "http://127.0.0.1:11434" });
  assert.equal(reopened.getTtsSettingsView().openai.model, "voice-model");
  await reopened.updateTtsSettings({ providers: { ko: "system", en: "off" }, systemVoices: { ko: "another-ko" } });
  const afterVoiceSave = reopened.getTtsSettingsView();
  assert.deepEqual(afterVoiceSave.systemVoices, { en: "fixture-en", ko: "another-ko" });
  assert.deepEqual(afterVoiceSave.providers, { en: "off", ko: "system" });
});

test("changing a compatible API origin clears a saved key unless a replacement is supplied", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-model-origin-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new SettingsStore({ app: { getPath: () => directory } });
  store.encryptSecret = (secret) => "fixture-encrypted-" + secret;
  await store.updateConversationModelSettings({
    provider: "openai-compatible",
    openai: { baseUrl: "https://original.example.invalid/v1", apiKey: "fixture-key" }
  });
  const sameOrigin = await store.updateConversationModelSettings({
    openai: { baseUrl: "https://original.example.invalid/new" }
  });
  assert.equal(sameOrigin.openai.configured, true);
  const differentOrigin = await store.updateConversationModelSettings({
    openai: { baseUrl: "http://127.0.0.1:12345" }
  });
  assert.equal(differentOrigin.openai.configured, false);
  assert.doesNotMatch(await fs.readFile(store.settingsPath, "utf8"), /fixture-key/);
});

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
