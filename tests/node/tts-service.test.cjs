const test = require("node:test");
const assert = require("node:assert/strict");

const { TtsService } = require("../../src/main/tts-service.cjs");

function createSettingsStore(overrides = {}) {
  return {
    getTtsSettings() {
      return {
        providers: {
          en: "auto",
          ko: "auto"
        },
        elevenlabs: {
          apiKey: "",
          modelEn: "eleven_flash_v2_5",
          modelKo: "eleven_multilingual_v2",
          voiceEn: "",
          voiceKo: ""
        },
        cartesia: {
          apiKey: "",
          modelId: "sonic-3",
          voiceEn: "",
          voiceKo: ""
        },
        naverClova: {
          clientId: "",
          clientSecret: "",
          speakerEn: "matt",
          speakerKo: "vyuna"
        },
        openai: {
          apiKey: "",
          model: "gpt-4o-mini-tts",
          voiceEn: "marin",
          voiceKo: "marin"
        },
        gemini: {
          apiKey: "",
          model: "gemini-3.1-flash-tts-preview",
          voiceEn: "Aoede",
          voiceKo: "Kore"
        },
        google: {
          credentialsPath: ""
        },
        ...overrides
      };
    }
  };
}

test("TtsService auto provider chain includes Gemini and OpenAI defaults", () => {
  const service = new TtsService({
    settingsStore: createSettingsStore()
  });

  assert.deepEqual(service.getProviderChain("en-US"), [
    "elevenlabs",
    "openai",
    "gemini",
    "cartesia",
    "google-cloud",
    "naver-clova",
    "system"
  ]);

  assert.deepEqual(service.getProviderChain("ko-KR"), [
    "naver-clova",
    "gemini",
    "elevenlabs",
    "cartesia",
    "openai",
    "google-cloud",
    "system"
  ]);
});

test("TtsService status reports Gemini and OpenAI configuration", async () => {
  const service = new TtsService({
    settingsStore: createSettingsStore({
      openai: {
        apiKey: "openai-key",
        model: "gpt-4o-mini-tts",
        voiceEn: "marin",
        voiceKo: "marin"
      },
      gemini: {
        apiKey: "gemini-key",
        model: "gemini-3.1-flash-tts-preview",
        voiceEn: "Aoede",
        voiceKo: "Kore"
      }
    })
  });

  const status = await service.status();

  assert.equal(status.configuredProviders.openai, true);
  assert.equal(status.configuredProviders.gemini, true);
  assert.match(status.message, /Gemini TTS and OpenAI TTS/);
});
