const fs = require("node:fs/promises");
const path = require("node:path");
const { safeStorage } = require("electron");

const DEFAULT_TTS_SETTINGS = {
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
};

function createDefaultSettings() {
  return {
    version: 1,
    tts: {
      providers: {
        ...DEFAULT_TTS_SETTINGS.providers
      },
      elevenlabs: {
        ...DEFAULT_TTS_SETTINGS.elevenlabs
      },
      cartesia: {
        ...DEFAULT_TTS_SETTINGS.cartesia
      },
      naverClova: {
        ...DEFAULT_TTS_SETTINGS.naverClova
      },
      openai: {
        ...DEFAULT_TTS_SETTINGS.openai
      },
      gemini: {
        ...DEFAULT_TTS_SETTINGS.gemini
      },
      google: {
        ...DEFAULT_TTS_SETTINGS.google
      }
    },
    geminiApiKeyEncrypted: ""
  };
}

function trimmedOrFallback(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const trimmed = String(value).trim();
  return trimmed || fallback;
}

class SettingsStore {
  constructor({ app }) {
    this.app = app;
    this.cache = createDefaultSettings();
  }

  get settingsPath() {
    return path.join(this.app.getPath("userData"), "jarvis-settings.json");
  }

  ensureEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS encryption is not available right now, so secure settings storage cannot be enabled.");
    }
  }

  encryptSecret(text) {
    if (!text) {
      return "";
    }

    this.ensureEncryption();
    return safeStorage.encryptString(text).toString("base64");
  }

  decryptSecret(encoded) {
    if (!encoded) {
      return "";
    }

    this.ensureEncryption();
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  }

  normalize(raw = {}) {
    const defaults = createDefaultSettings();
    const storedTts = raw.tts || {};

    return {
      version: 1,
      tts: {
        providers: {
          en: trimmedOrFallback(storedTts.providers?.en, defaults.tts.providers.en),
          ko: trimmedOrFallback(storedTts.providers?.ko, defaults.tts.providers.ko)
        },
        elevenlabs: {
          modelEn: trimmedOrFallback(storedTts.elevenlabs?.modelEn, defaults.tts.elevenlabs.modelEn),
          modelKo: trimmedOrFallback(storedTts.elevenlabs?.modelKo, defaults.tts.elevenlabs.modelKo),
          voiceEn: String(storedTts.elevenlabs?.voiceEn || "").trim(),
          voiceKo: String(storedTts.elevenlabs?.voiceKo || "").trim(),
          apiKeyEncrypted: String(storedTts.elevenlabs?.apiKeyEncrypted || "")
        },
        cartesia: {
          modelId: trimmedOrFallback(storedTts.cartesia?.modelId, defaults.tts.cartesia.modelId),
          voiceEn: String(storedTts.cartesia?.voiceEn || "").trim(),
          voiceKo: String(storedTts.cartesia?.voiceKo || "").trim(),
          apiKeyEncrypted: String(storedTts.cartesia?.apiKeyEncrypted || "")
        },
        naverClova: {
          speakerEn: trimmedOrFallback(storedTts.naverClova?.speakerEn, defaults.tts.naverClova.speakerEn),
          speakerKo: trimmedOrFallback(storedTts.naverClova?.speakerKo, defaults.tts.naverClova.speakerKo),
          clientIdEncrypted: String(storedTts.naverClova?.clientIdEncrypted || ""),
          clientSecretEncrypted: String(storedTts.naverClova?.clientSecretEncrypted || "")
        },
        openai: {
          model: trimmedOrFallback(storedTts.openai?.model, defaults.tts.openai.model),
          voiceEn: trimmedOrFallback(storedTts.openai?.voiceEn, defaults.tts.openai.voiceEn),
          voiceKo: trimmedOrFallback(storedTts.openai?.voiceKo, defaults.tts.openai.voiceKo),
          apiKeyEncrypted: String(storedTts.openai?.apiKeyEncrypted || "")
        },
        gemini: {
          model: trimmedOrFallback(storedTts.gemini?.model, defaults.tts.gemini.model),
          voiceEn: trimmedOrFallback(storedTts.gemini?.voiceEn, defaults.tts.gemini.voiceEn),
          voiceKo: trimmedOrFallback(storedTts.gemini?.voiceKo, defaults.tts.gemini.voiceKo),
          apiKeyEncrypted: String(storedTts.gemini?.apiKeyEncrypted || "")
        },
        google: {
          credentialsPath: String(storedTts.google?.credentialsPath || "").trim()
        }
      }
    };
  }

  async load() {
    try {
      const raw = await fs.readFile(this.settingsPath, "utf8");
      this.cache = this.normalize(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      this.cache = createDefaultSettings();
    }

    return this.getTtsSettingsView();
  }

  async writeCache() {
    await fs.mkdir(path.dirname(this.settingsPath), {
      recursive: true
    });

    await fs.writeFile(this.settingsPath, JSON.stringify(this.cache, null, 2), "utf8");
  }

  getTtsSettings() {
    const tts = this.cache.tts || createDefaultSettings().tts;

    return {
      providers: {
        ...tts.providers
      },
      elevenlabs: {
        modelEn: tts.elevenlabs.modelEn,
        modelKo: tts.elevenlabs.modelKo,
        voiceEn: tts.elevenlabs.voiceEn,
        voiceKo: tts.elevenlabs.voiceKo,
        apiKey: this.decryptSecret(tts.elevenlabs.apiKeyEncrypted)
      },
      cartesia: {
        modelId: tts.cartesia.modelId,
        voiceEn: tts.cartesia.voiceEn,
        voiceKo: tts.cartesia.voiceKo,
        apiKey: this.decryptSecret(tts.cartesia.apiKeyEncrypted)
      },
      naverClova: {
        speakerEn: tts.naverClova.speakerEn,
        speakerKo: tts.naverClova.speakerKo,
        clientId: this.decryptSecret(tts.naverClova.clientIdEncrypted),
        clientSecret: this.decryptSecret(tts.naverClova.clientSecretEncrypted)
      },
      openai: {
        model: tts.openai.model,
        voiceEn: tts.openai.voiceEn,
        voiceKo: tts.openai.voiceKo,
        apiKey: this.decryptSecret(tts.openai.apiKeyEncrypted)
      },
      gemini: {
        model: tts.gemini.model,
        voiceEn: tts.gemini.voiceEn,
        voiceKo: tts.gemini.voiceKo,
        apiKey: this.decryptSecret(tts.gemini.apiKeyEncrypted)
      },
      google: {
        credentialsPath: tts.google.credentialsPath
      }
    };
  }

  getTtsSettingsView() {
    const tts = this.getTtsSettings();

    return {
      providers: {
        ...tts.providers
      },
      elevenlabs: {
        configured: Boolean(tts.elevenlabs.apiKey),
        modelEn: tts.elevenlabs.modelEn,
        modelKo: tts.elevenlabs.modelKo,
        voiceEn: tts.elevenlabs.voiceEn,
        voiceKo: tts.elevenlabs.voiceKo
      },
      cartesia: {
        configured: Boolean(tts.cartesia.apiKey),
        modelId: tts.cartesia.modelId,
        voiceEn: tts.cartesia.voiceEn,
        voiceKo: tts.cartesia.voiceKo
      },
      naverClova: {
        configured: Boolean(tts.naverClova.clientId && tts.naverClova.clientSecret),
        speakerEn: tts.naverClova.speakerEn,
        speakerKo: tts.naverClova.speakerKo
      },
      openai: {
        configured: Boolean(tts.openai.apiKey),
        model: tts.openai.model,
        voiceEn: tts.openai.voiceEn,
        voiceKo: tts.openai.voiceKo
      },
      gemini: {
        configured: Boolean(tts.gemini.apiKey),
        model: tts.gemini.model,
        voiceEn: tts.gemini.voiceEn,
        voiceKo: tts.gemini.voiceKo
      },
      google: {
        configured: Boolean(tts.google.credentialsPath),
        credentialsPath: tts.google.credentialsPath
      }
    };
  }

  async updateTtsSettings(patch = {}) {
    const current = this.cache.tts || createDefaultSettings().tts;
    const next = this.normalize({
      version: 1,
      tts: {
        providers: {
          en: trimmedOrFallback(patch.providers?.en, current.providers.en),
          ko: trimmedOrFallback(patch.providers?.ko, current.providers.ko)
        },
        elevenlabs: {
          modelEn: trimmedOrFallback(patch.elevenlabs?.modelEn, current.elevenlabs.modelEn),
          modelKo: trimmedOrFallback(patch.elevenlabs?.modelKo, current.elevenlabs.modelKo),
          voiceEn: patch.elevenlabs?.voiceEn !== undefined ? String(patch.elevenlabs.voiceEn || "").trim() : current.elevenlabs.voiceEn,
          voiceKo: patch.elevenlabs?.voiceKo !== undefined ? String(patch.elevenlabs.voiceKo || "").trim() : current.elevenlabs.voiceKo,
          apiKeyEncrypted: String(patch.elevenlabs?.apiKey || "").trim()
            ? this.encryptSecret(String(patch.elevenlabs.apiKey).trim())
            : current.elevenlabs.apiKeyEncrypted
        },
        cartesia: {
          modelId: trimmedOrFallback(patch.cartesia?.modelId, current.cartesia.modelId),
          voiceEn: patch.cartesia?.voiceEn !== undefined ? String(patch.cartesia.voiceEn || "").trim() : current.cartesia.voiceEn,
          voiceKo: patch.cartesia?.voiceKo !== undefined ? String(patch.cartesia.voiceKo || "").trim() : current.cartesia.voiceKo,
          apiKeyEncrypted: String(patch.cartesia?.apiKey || "").trim()
            ? this.encryptSecret(String(patch.cartesia.apiKey).trim())
            : current.cartesia.apiKeyEncrypted
        },
        naverClova: {
          speakerEn: trimmedOrFallback(patch.naverClova?.speakerEn, current.naverClova.speakerEn),
          speakerKo: trimmedOrFallback(patch.naverClova?.speakerKo, current.naverClova.speakerKo),
          clientIdEncrypted: String(patch.naverClova?.clientId || "").trim()
            ? this.encryptSecret(String(patch.naverClova.clientId).trim())
            : current.naverClova.clientIdEncrypted,
          clientSecretEncrypted: String(patch.naverClova?.clientSecret || "").trim()
            ? this.encryptSecret(String(patch.naverClova.clientSecret).trim())
            : current.naverClova.clientSecretEncrypted
        },
        openai: {
          model: trimmedOrFallback(patch.openai?.model, current.openai.model),
          voiceEn: trimmedOrFallback(patch.openai?.voiceEn, current.openai.voiceEn),
          voiceKo: trimmedOrFallback(patch.openai?.voiceKo, current.openai.voiceKo),
          apiKeyEncrypted: String(patch.openai?.apiKey || "").trim()
            ? this.encryptSecret(String(patch.openai.apiKey).trim())
            : current.openai.apiKeyEncrypted
        },
        gemini: {
          model: trimmedOrFallback(patch.gemini?.model, current.gemini.model),
          voiceEn: trimmedOrFallback(patch.gemini?.voiceEn, current.gemini.voiceEn),
          voiceKo: trimmedOrFallback(patch.gemini?.voiceKo, current.gemini.voiceKo),
          apiKeyEncrypted: String(patch.gemini?.apiKey || "").trim()
            ? this.encryptSecret(String(patch.gemini.apiKey).trim())
            : current.gemini.apiKeyEncrypted
        },
        google: {
          credentialsPath: patch.google?.credentialsPath !== undefined
            ? String(patch.google.credentialsPath || "").trim()
            : current.google.credentialsPath
        }
      }
    });

    this.cache = next;
    await this.writeCache();
    return this.getTtsSettingsView();
  }

  getGeminiApiKey() {
    return this.decryptSecret(this.cache.geminiApiKeyEncrypted) || process.env.GEMINI_API_KEY || "";
  }

  async updateGeminiApiKey(key = "") {
    this.cache.geminiApiKeyEncrypted = this.encryptSecret(String(key).trim());
    await this.writeCache();
    return { success: true };
  }
}

module.exports = {
  SettingsStore
};
