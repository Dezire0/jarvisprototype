const test = require("node:test");
const assert = require("node:assert/strict");

const MODULE_PATH = require.resolve("../../src/main/stt-service.cjs");
const MANAGED_ENV_KEYS = [
  "GROQ_API_KEY",
  "GROQ_STT_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_STT_MODEL"
];

function withFreshSttModule(envPatch, callback) {
  const backup = new Map();

  for (const key of MANAGED_ENV_KEYS) {
    backup.set(key, process.env[key]);
    delete process.env[key];
  }

  Object.assign(process.env, envPatch);
  delete require.cache[MODULE_PATH];

  try {
    return callback(require(MODULE_PATH));
  } finally {
    delete require.cache[MODULE_PATH];

    for (const key of MANAGED_ENV_KEYS) {
      const original = backup.get(key);

      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  }
}

function createSettingsStore({
  ttsOpenaiApiKey = "",
  conversationOpenaiApiKey = "",
  groqApiKey = "",
  groqSttModel = ""
} = {}) {
  return {
    getTtsSettings() {
      return {
        openai: {
          apiKey: ttsOpenaiApiKey
        }
      };
    },
    getConversationModelSettings() {
      return {
        groq: {
          apiKey: groqApiKey,
          sttModel: groqSttModel
        },
        openai: {
          apiKey: conversationOpenaiApiKey
        }
      };
    }
  };
}

test("SttService uses only Groq Whisper when Groq and OpenAI are both configured", () => {
  withFreshSttModule(
    {
      GROQ_API_KEY: "gsk-test-key",
      OPENAI_API_KEY: "sk-test-key"
    },
    ({ SttService }) => {
      const service = new SttService({
        settingsStore: createSettingsStore()
      });

      const providers = service.getProviderChain().map((provider) => provider.name);
      const status = service.getStatus();

      assert.deepEqual(providers, ["groq"]);
      assert.equal(status.primaryProvider, "groq");
      assert.equal(status.label, "cloud-stt:groq(primary)");
    }
  );
});

test("SttService reuses the stored OpenAI key when Groq is not configured", () => {
  withFreshSttModule({}, ({ SttService }) => {
    const service = new SttService({
      settingsStore: createSettingsStore({
        ttsOpenaiApiKey: "sk-stored-openai"
      })
    });

    const providers = service.getProviderChain().map((provider) => provider.name);
    const status = service.getStatus();

    assert.deepEqual(providers, ["openai"]);
    assert.equal(status.primaryProvider, "openai");
    assert.equal(status.label, "cloud-stt:openai(primary)");
  });
});

test("SttService prefers the stored Groq key over stored OpenAI keys", () => {
  withFreshSttModule({}, ({ SttService }) => {
    const service = new SttService({
      settingsStore: createSettingsStore({
        groqApiKey: "gsk-stored-groq",
        groqSttModel: "whisper-large-v3",
        conversationOpenaiApiKey: "sk-stored-openai",
        ttsOpenaiApiKey: "sk-stored-tts-openai"
      })
    });

    const providers = service.getProviderChain();
    const status = service.getStatus();

    assert.deepEqual(providers.map((provider) => provider.name), ["groq"]);
    assert.equal(providers[0].model, "whisper-large-v3");
    assert.equal(status.primaryProvider, "groq");
    assert.equal(status.label, "cloud-stt:groq(primary)");
  });
});

test("SttService surfaces Groq errors instead of falling through to OpenAI", async () => {
  await withFreshSttModule({}, async ({ SttService }) => {
    const originalFetch = global.fetch;
    const urls = [];

    global.fetch = async (url) => {
      urls.push(String(url));
      return {
        ok: false,
        status: 401,
        async json() {
          return {
            error: {
              message: "Invalid Groq API key"
            }
          };
        }
      };
    };

    try {
      const service = new SttService({
        settingsStore: createSettingsStore({
          groqApiKey: "gsk-stored-groq",
          conversationOpenaiApiKey: "sk-stored-openai"
        })
      });

      await assert.rejects(
        () => service.transcribe({
          audioBase64: Buffer.from("fake audio").toString("base64"),
          mimeType: "audio/webm",
          language: "ko-KR"
        }),
        /groq transcription failed: Invalid Groq API key/
      );

      assert.deepEqual(urls, ["https://api.groq.com/openai/v1/audio/transcriptions"]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
