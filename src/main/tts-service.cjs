const { GoogleAuth } = require("google-auth-library");

const CARTESIA_API_URL = "https://api.cartesia.ai";
const CARTESIA_API_VERSION = "2025-04-16";
const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const NAVER_CLOVA_TTS_URL = "https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts";
const OPENAI_TTS_API_URL = "https://api.openai.com/v1/audio/speech";

const CARTESIA_PREFERRED_ENGLISH_VOICES = ["Katie", "Brooke", "Jacqueline", "Carson", "Ronald"];
const ELEVENLABS_PREFERRED_ENGLISH_VOICES = ["George", "Brian", "Adam", "Charlie", "Daniel", "Eric"];

function clampTtsText(text = "") {
  return String(text).trim().slice(0, 500);
}

function normalizeTtsLanguage(languageCode = "en-US") {
  return /^ko/i.test(languageCode) ? "ko" : "en";
}

function toBase64Audio(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function pickFirstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function parseMimeParameter(mimeType = "", name) {
  const match = String(mimeType).match(new RegExp(`${name}=([^;]+)`, "i"));
  return match ? Number(match[1]) || null : null;
}

function wrapPcm16ToWav(buffer, { sampleRate = 24000, channels = 1 } = {}) {
  const audioBuffer = Buffer.from(buffer);
  const bytesPerSample = 2;
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + audioBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(audioBuffer.length, 40);

  return Buffer.concat([header, audioBuffer]);
}

function buildGoogleVoiceConfig(languageCode = "en-US") {
  const cleanLanguageCode = /^ko/i.test(languageCode) ? "ko-KR" : "en-US";

  return {
    languageCode: cleanLanguageCode,
    ssmlGender: /^ko/i.test(cleanLanguageCode) ? "FEMALE" : "NEUTRAL"
  };
}

function buildOpenAiInstructions(languageCode = "en-US") {
  if (/^ko/i.test(languageCode)) {
    return "Speak clearly in Korean with a calm, polished assistant tone.";
  }

  return "Speak in a calm, polished assistant tone.";
}

class TtsService {
  constructor({ settingsStore } = {}) {
    this.settingsStore = settingsStore || null;
    this.defaultGoogleAuth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
    this.voiceCache = new Map();
  }

  getRuntimeConfig() {
    const stored = this.settingsStore?.getTtsSettings?.() || {};

    return {
      providers: {
        en: pickFirstNonEmpty(stored.providers?.en, process.env.JARVIS_TTS_PROVIDER_EN, "auto"),
        ko: pickFirstNonEmpty(stored.providers?.ko, process.env.JARVIS_TTS_PROVIDER_KO, "auto")
      },
      elevenlabs: {
        apiKey: pickFirstNonEmpty(stored.elevenlabs?.apiKey, process.env.ELEVENLABS_API_KEY),
        modelEn: pickFirstNonEmpty(stored.elevenlabs?.modelEn, process.env.ELEVENLABS_MODEL_EN, "eleven_flash_v2_5"),
        modelKo: pickFirstNonEmpty(stored.elevenlabs?.modelKo, process.env.ELEVENLABS_MODEL_KO, "eleven_multilingual_v2"),
        voiceEn: pickFirstNonEmpty(stored.elevenlabs?.voiceEn, process.env.ELEVENLABS_VOICE_EN),
        voiceKo: pickFirstNonEmpty(stored.elevenlabs?.voiceKo, process.env.ELEVENLABS_VOICE_KO)
      },
      cartesia: {
        apiKey: pickFirstNonEmpty(stored.cartesia?.apiKey, process.env.CARTESIA_API_KEY),
        modelId: pickFirstNonEmpty(stored.cartesia?.modelId, process.env.CARTESIA_MODEL_ID, "sonic-3"),
        voiceEn: pickFirstNonEmpty(stored.cartesia?.voiceEn, process.env.CARTESIA_VOICE_EN),
        voiceKo: pickFirstNonEmpty(stored.cartesia?.voiceKo, process.env.CARTESIA_VOICE_KO)
      },
      naverClova: {
        clientId: pickFirstNonEmpty(stored.naverClova?.clientId, process.env.NAVER_CLOVA_CLIENT_ID),
        clientSecret: pickFirstNonEmpty(stored.naverClova?.clientSecret, process.env.NAVER_CLOVA_CLIENT_SECRET),
        speakerEn: pickFirstNonEmpty(stored.naverClova?.speakerEn, process.env.NAVER_CLOVA_SPEAKER_EN, "matt"),
        speakerKo: pickFirstNonEmpty(stored.naverClova?.speakerKo, process.env.NAVER_CLOVA_SPEAKER_KO, "vyuna")
      },
      openai: {
        apiKey: pickFirstNonEmpty(stored.openai?.apiKey, process.env.OPENAI_API_KEY),
        model: pickFirstNonEmpty(
          stored.openai?.model,
          process.env.OPENAI_TTS_MODEL_DESKTOP,
          process.env.OPENAI_TTS_MODEL,
          "gpt-4o-mini-tts"
        ),
        voiceEn: pickFirstNonEmpty(
          stored.openai?.voiceEn,
          process.env.OPENAI_TTS_VOICE_EN,
          process.env.OPENAI_TTS_VOICE,
          "marin"
        ),
        voiceKo: pickFirstNonEmpty(
          stored.openai?.voiceKo,
          process.env.OPENAI_TTS_VOICE_KO,
          process.env.OPENAI_TTS_VOICE,
          "marin"
        )
      },
      gemini: {
        apiKey: pickFirstNonEmpty(stored.gemini?.apiKey, process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY),
        model: pickFirstNonEmpty(
          stored.gemini?.model,
          process.env.GEMINI_TTS_MODEL,
          process.env.GOOGLE_TTS_MODEL_DESKTOP,
          process.env.GOOGLE_TTS_MODEL,
          "gemini-3.1-flash-tts-preview"
        ),
        voiceEn: pickFirstNonEmpty(
          stored.gemini?.voiceEn,
          process.env.GEMINI_TTS_VOICE_EN,
          process.env.GOOGLE_TTS_VOICE_EN,
          process.env.GOOGLE_TTS_VOICE,
          "Aoede"
        ),
        voiceKo: pickFirstNonEmpty(
          stored.gemini?.voiceKo,
          process.env.GEMINI_TTS_VOICE_KO,
          process.env.GOOGLE_TTS_VOICE_KO,
          process.env.GOOGLE_TTS_VOICE,
          "Kore"
        )
      },
      google: {
        credentialsPath: pickFirstNonEmpty(stored.google?.credentialsPath, process.env.GOOGLE_APPLICATION_CREDENTIALS)
      }
    };
  }

  hasElevenLabsCredentials() {
    return Boolean(this.getRuntimeConfig().elevenlabs.apiKey);
  }

  hasCartesiaCredentials() {
    return Boolean(this.getRuntimeConfig().cartesia.apiKey);
  }

  hasNaverClovaCredentials() {
    const config = this.getRuntimeConfig().naverClova;
    return Boolean(config.clientId && config.clientSecret);
  }

  hasOpenAICredentials() {
    return Boolean(this.getRuntimeConfig().openai.apiKey);
  }

  hasGeminiCredentials() {
    return Boolean(this.getRuntimeConfig().gemini.apiKey);
  }

  hasExplicitGoogleCredentials() {
    return Boolean(this.getRuntimeConfig().google.credentialsPath);
  }

  getDefaultProvider() {
    if (this.hasElevenLabsCredentials() && this.hasNaverClovaCredentials()) {
      return "elevenlabs + naver-clova";
    }

    if (this.hasElevenLabsCredentials()) {
      return "elevenlabs";
    }

    if (this.hasCartesiaCredentials() && this.hasNaverClovaCredentials()) {
      return "cartesia + naver-clova";
    }

    if (this.hasNaverClovaCredentials() && this.hasGeminiCredentials()) {
      return "naver-clova + gemini";
    }

    if (this.hasGeminiCredentials() && this.hasOpenAICredentials()) {
      return "gemini + openai";
    }

    if (this.hasGeminiCredentials()) {
      return "gemini";
    }

    if (this.hasOpenAICredentials()) {
      return "openai";
    }

    if (this.hasCartesiaCredentials()) {
      return "cartesia";
    }

    if (this.hasNaverClovaCredentials()) {
      return "naver-clova";
    }

    if (this.hasExplicitGoogleCredentials()) {
      return "google-cloud";
    }

    return "system";
  }

  getProviderChain(languageCode = "en-US", requestedProvider) {
    if (requestedProvider && requestedProvider !== "auto") {
      return [requestedProvider];
    }

    const language = normalizeTtsLanguage(languageCode);
    const config = this.getRuntimeConfig();
    const configured = language === "ko" ? config.providers.ko : config.providers.en;
    const defaults = language === "ko"
      ? ["naver-clova", "gemini", "elevenlabs", "cartesia", "openai", "google-cloud", "system"]
      : ["elevenlabs", "openai", "gemini", "cartesia", "google-cloud", "naver-clova", "system"];

    const ordered = configured && configured !== "auto"
      ? [configured, ...defaults]
      : defaults;

    return [...new Set(ordered.filter(Boolean))];
  }

  getDefaultProviderForLanguage(languageCode = "en-US") {
    return this.getProviderChain(languageCode)[0] || "system";
  }

  buildElevenLabsHeaders() {
    const apiKey = this.getRuntimeConfig().elevenlabs.apiKey;

    if (!apiKey) {
      throw new Error("ElevenLabs API key is not configured.");
    }

    return {
      "xi-api-key": apiKey,
      Accept: "audio/mpeg",
      "Content-Type": "application/json"
    };
  }

  buildCartesiaHeaders() {
    const apiKey = this.getRuntimeConfig().cartesia.apiKey;

    if (!apiKey) {
      throw new Error("Cartesia TTS credentials are not configured.");
    }

    return {
      Authorization: `Bearer ${apiKey}`,
      "X-API-Key": apiKey,
      "Cartesia-Version": CARTESIA_API_VERSION,
      "Content-Type": "application/json"
    };
  }

  buildNaverClovaHeaders() {
    const config = this.getRuntimeConfig().naverClova;

    if (!config.clientId || !config.clientSecret) {
      throw new Error("NAVER CLOVA Voice credentials are not configured.");
    }

    return {
      "X-NCP-APIGW-API-KEY-ID": config.clientId,
      "X-NCP-APIGW-API-KEY": config.clientSecret,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    };
  }

  buildOpenAIHeaders() {
    const apiKey = this.getRuntimeConfig().openai.apiKey;

    if (!apiKey) {
      throw new Error("OpenAI TTS credentials are not configured.");
    }

    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    };
  }

  buildGeminiHeaders() {
    const apiKey = this.getRuntimeConfig().gemini.apiKey;

    if (!apiKey) {
      throw new Error("Gemini TTS credentials are not configured.");
    }

    return {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    };
  }

  async getGoogleAccessToken() {
    const credentialsPath = this.getRuntimeConfig().google.credentialsPath;
    const auth = credentialsPath
      ? new GoogleAuth({
        keyFilename: credentialsPath,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"]
      })
      : this.defaultGoogleAuth;
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token || "";

    if (!token) {
      throw new Error("Google Cloud TTS credentials are not configured.");
    }

    return token;
  }

  async parseApiError(response) {
    try {
      const data = await response.json();
      return data.error?.message || data.detail?.message || data.detail || data.message || `status ${response.status}`;
    } catch (_error) {
      try {
        const text = await response.text();
        return text.slice(0, 220) || `status ${response.status}`;
      } catch (_innerError) {
        return `status ${response.status}`;
      }
    }
  }

  async fetchElevenLabsVoices() {
    const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
      headers: this.buildElevenLabsHeaders()
    });

    if (!response.ok) {
      const detail = await this.parseApiError(response);
      throw new Error(`ElevenLabs voice lookup failed: ${detail}`);
    }

    const data = await response.json();
    return Array.isArray(data.voices) ? data.voices : Array.isArray(data) ? data : [];
  }

  pickElevenLabsVoice(voices, languageCode = "en-US") {
    const language = normalizeTtsLanguage(languageCode);
    const candidates = voices.filter((voice) => {
      const languageLabel = String(
        voice.labels?.language || voice.locale || voice.language || voice.preview_language || ""
      ).toLowerCase();

      if (!languageLabel) {
        return language === "en";
      }

      return languageLabel.startsWith(language);
    });

    const pool = candidates.length ? candidates : voices;

    if (!pool.length) {
      return null;
    }

    if (language === "en") {
      for (const preferredName of ELEVENLABS_PREFERRED_ENGLISH_VOICES) {
        const match = pool.find(
          (voice) => String(voice.name || "").toLowerCase() === preferredName.toLowerCase()
        );

        if (match?.voice_id) {
          return match;
        }
      }
    }

    return pool.find((voice) => voice.voice_id) || null;
  }

  async resolveElevenLabsVoiceId(languageCode = "en-US") {
    const language = normalizeTtsLanguage(languageCode);
    const config = this.getRuntimeConfig().elevenlabs;
    const override = language === "ko" ? config.voiceKo : config.voiceEn;
    const cacheKey = `elevenlabs:${language}`;

    if (override) {
      return override;
    }

    if (this.voiceCache.has(cacheKey)) {
      return this.voiceCache.get(cacheKey);
    }

    const voices = await this.fetchElevenLabsVoices();
    const picked = this.pickElevenLabsVoice(voices, languageCode);

    if (!picked?.voice_id) {
      throw new Error(`ElevenLabs does not have an available ${language} voice for this app.`);
    }

    this.voiceCache.set(cacheKey, picked.voice_id);
    return picked.voice_id;
  }

  async fetchCartesiaVoices(params = {}) {
    const url = new URL("/voices", CARTESIA_API_URL);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url, {
      headers: this.buildCartesiaHeaders()
    });

    if (!response.ok) {
      const detail = await this.parseApiError(response);
      throw new Error(`Cartesia voice lookup failed: ${detail}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : data.voices || data.items || [];
  }

  pickCartesiaVoice(voices, languageCode = "en-US") {
    const language = normalizeTtsLanguage(languageCode);
    const candidates = voices.filter((voice) => {
      const voiceLanguage = String(voice.language || voice.locale || "").toLowerCase();
      return voiceLanguage.startsWith(language);
    });

    if (!candidates.length) {
      return null;
    }

    if (language === "en") {
      for (const preferredName of CARTESIA_PREFERRED_ENGLISH_VOICES) {
        const match = candidates.find(
          (voice) => String(voice.name || "").toLowerCase() === preferredName.toLowerCase()
        );

        if (match?.id) {
          return match;
        }
      }
    }

    return candidates.find((voice) => voice.id) || null;
  }

  async resolveCartesiaVoiceId(languageCode = "en-US") {
    const language = normalizeTtsLanguage(languageCode);
    const config = this.getRuntimeConfig().cartesia;
    const override = language === "ko" ? config.voiceKo : config.voiceEn;
    const cacheKey = `cartesia:${language}`;

    if (override) {
      return override;
    }

    if (this.voiceCache.has(cacheKey)) {
      return this.voiceCache.get(cacheKey);
    }

    let voices = [];

    if (language === "en") {
      for (const preferredName of CARTESIA_PREFERRED_ENGLISH_VOICES) {
        voices = await this.fetchCartesiaVoices({
          q: preferredName,
          limit: 20
        });

        const picked = this.pickCartesiaVoice(voices, languageCode);

        if (picked?.id) {
          this.voiceCache.set(cacheKey, picked.id);
          return picked.id;
        }
      }
    }

    voices = await this.fetchCartesiaVoices({
      limit: 100
    });

    const picked = this.pickCartesiaVoice(voices, languageCode);

    if (!picked?.id) {
      throw new Error(`Cartesia does not have an available ${language} voice for this app.`);
    }

    this.voiceCache.set(cacheKey, picked.id);
    return picked.id;
  }

  async speakWithElevenLabs({ text, languageCode }) {
    const clippedText = clampTtsText(text);

    if (!clippedText) {
      throw new Error("Text is required for speech synthesis.");
    }

    const language = normalizeTtsLanguage(languageCode);
    const config = this.getRuntimeConfig().elevenlabs;
    const voiceId = await this.resolveElevenLabsVoiceId(languageCode);
    const modelId = language === "ko" ? config.modelKo : config.modelEn;
    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: this.buildElevenLabsHeaders(),
        body: JSON.stringify({
          text: clippedText,
          model_id: modelId,
          voice_settings: {
            stability: language === "ko" ? 0.4 : 0.38,
            similarity_boost: 0.82,
            style: 0.18,
            use_speaker_boost: true
          }
        })
      }
    );

    if (!response.ok) {
      const detail = await this.parseApiError(response);
      throw new Error(`ElevenLabs TTS failed: ${detail}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return {
      provider: "elevenlabs",
      mimeType: "audio/mpeg",
      audioContentBase64: toBase64Audio(audioBuffer),
      voiceId,
      modelId,
      language
    };
  }

  async speakWithCartesia({ text, languageCode }) {
    const clippedText = clampTtsText(text);

    if (!clippedText) {
      throw new Error("Text is required for speech synthesis.");
    }

    const config = this.getRuntimeConfig().cartesia;
    const language = normalizeTtsLanguage(languageCode);
    const voiceId = await this.resolveCartesiaVoiceId(languageCode);
    const response = await fetch(`${CARTESIA_API_URL}/tts/bytes`, {
      method: "POST",
      headers: this.buildCartesiaHeaders(),
      body: JSON.stringify({
        model_id: config.modelId,
        transcript: clippedText,
        voice: {
          mode: "id",
          id: voiceId
        },
        output_format: {
          container: "wav",
          encoding: "pcm_f32le",
          sample_rate: 44100
        },
        language
      })
    });

    if (!response.ok) {
      const detail = await this.parseApiError(response);
      throw new Error(`Cartesia TTS failed: ${detail}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return {
      provider: "cartesia-sonic",
      mimeType: "audio/wav",
      audioContentBase64: toBase64Audio(audioBuffer),
      voiceId,
      modelId: config.modelId,
      language
    };
  }

  async speakWithNaverClova({ text, languageCode }) {
    const clippedText = clampTtsText(text);

    if (!clippedText) {
      throw new Error("Text is required for speech synthesis.");
    }

    const language = normalizeTtsLanguage(languageCode);
    const config = this.getRuntimeConfig().naverClova;
    const speaker = language === "ko" ? config.speakerKo : config.speakerEn;
    const body = new URLSearchParams({
      speaker,
      volume: "0",
      speed: "0",
      pitch: "0",
      format: "mp3",
      text: clippedText
    });

    const response = await fetch(NAVER_CLOVA_TTS_URL, {
      method: "POST",
      headers: this.buildNaverClovaHeaders(),
      body
    });

    if (!response.ok) {
      const detail = await this.parseApiError(response);
      throw new Error(`NAVER CLOVA Voice TTS failed: ${detail}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return {
      provider: "naver-clova-voice",
      mimeType: "audio/mpeg",
      audioContentBase64: toBase64Audio(audioBuffer),
      speaker,
      language
    };
  }

  async speakWithOpenAI({ text, languageCode }) {
    const clippedText = clampTtsText(text);

    if (!clippedText) {
      throw new Error("Text is required for speech synthesis.");
    }

    const config = this.getRuntimeConfig().openai;
    const language = normalizeTtsLanguage(languageCode);
    const voice = language === "ko" ? config.voiceKo : config.voiceEn;
    const response = await fetch(OPENAI_TTS_API_URL, {
      method: "POST",
      headers: this.buildOpenAIHeaders(),
      body: JSON.stringify({
        model: config.model,
        input: clippedText,
        voice,
        response_format: "mp3",
        instructions: buildOpenAiInstructions(languageCode)
      })
    });

    if (!response.ok) {
      const detail = await this.parseApiError(response);
      throw new Error(`OpenAI TTS failed: ${detail}`);
    }

    const audioBuffer = await response.arrayBuffer();
    return {
      provider: "openai-tts",
      mimeType: "audio/mpeg",
      audioContentBase64: toBase64Audio(audioBuffer),
      voiceId: voice,
      modelId: config.model,
      language
    };
  }

  async speakWithGemini({ text, languageCode }) {
    const clippedText = clampTtsText(text);

    if (!clippedText) {
      throw new Error("Text is required for speech synthesis.");
    }

    const config = this.getRuntimeConfig().gemini;
    const language = normalizeTtsLanguage(languageCode);
    const voiceName = language === "ko" ? config.voiceKo : config.voiceEn;
    const response = await fetch(
      `${GEMINI_API_URL}/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: "POST",
        headers: this.buildGeminiHeaders(),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: clippedText
                }
              ]
            }
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName
                }
              }
            }
          }
        })
      }
    );

    if (!response.ok) {
      const detail = await this.parseApiError(response);
      throw new Error(`Gemini TTS failed: ${detail}`);
    }

    const data = await response.json();
    const part = data?.candidates?.[0]?.content?.parts?.find(
      (item) => item?.inlineData?.data || item?.inline_data?.data
    );
    const inlineData = part?.inlineData || part?.inline_data;

    if (!inlineData?.data) {
      throw new Error("Gemini TTS did not return audio content.");
    }

    const sourceMimeType = String(inlineData.mimeType || inlineData.mime_type || "").trim();
    const sourceAudio = Buffer.from(inlineData.data, "base64");
    const normalizedMimeType = sourceMimeType.toLowerCase();
    let outputBuffer = sourceAudio;
    let mimeType = "audio/wav";

    if (normalizedMimeType.includes("mp3") || normalizedMimeType.includes("mpeg")) {
      mimeType = "audio/mpeg";
    } else if (!normalizedMimeType.includes("wav")) {
      outputBuffer = wrapPcm16ToWav(sourceAudio, {
        sampleRate: parseMimeParameter(sourceMimeType, "rate") || 24000,
        channels: parseMimeParameter(sourceMimeType, "channels") || 1
      });
    }

    return {
      provider: "gemini-tts",
      mimeType,
      audioContentBase64: outputBuffer.toString("base64"),
      voiceId: voiceName,
      modelId: config.model,
      language
    };
  }

  async speakWithGoogleCloud({ text, languageCode }) {
    const clippedText = clampTtsText(text);

    if (!clippedText) {
      throw new Error("Text is required for speech synthesis.");
    }

    const accessToken = await this.getGoogleAccessToken();
    const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        input: {
          text: clippedText
        },
        voice: buildGoogleVoiceConfig(languageCode),
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: /^ko/i.test(languageCode || "") ? 1 : 0.98,
          pitch: 0
        }
      })
    });

    if (!response.ok) {
      const detail = await this.parseApiError(response);
      throw new Error(`Google Cloud TTS failed: ${detail}`);
    }

    const data = await response.json();

    if (!data.audioContent) {
      throw new Error("Google Cloud TTS did not return audio content.");
    }

    return {
      provider: "google-cloud",
      mimeType: "audio/mpeg",
      audioContentBase64: data.audioContent
    };
  }

  async status() {
    const config = this.getRuntimeConfig();
    const elevenConfigured = Boolean(config.elevenlabs.apiKey);
    const cartesiaConfigured = Boolean(config.cartesia.apiKey);
    const naverConfigured = Boolean(config.naverClova.clientId && config.naverClova.clientSecret);
    const openaiConfigured = Boolean(config.openai.apiKey);
    const geminiConfigured = Boolean(config.gemini.apiKey);
    const googleConfigured = Boolean(config.google.credentialsPath);

    let message = "No cloud TTS key is configured. The app will use system speech synthesis as a fallback.";

    if (elevenConfigured && naverConfigured) {
      message = "ElevenLabs is ready for English replies and NAVER CLOVA Voice is ready for Korean replies.";
    } else if (naverConfigured && geminiConfigured) {
      message = "NAVER CLOVA Voice is ready for Korean replies and Gemini TTS is ready for natural multilingual speech.";
    } else if (geminiConfigured && openaiConfigured) {
      message = "Gemini TTS and OpenAI TTS are both ready as cloud voice engines.";
    } else if (geminiConfigured) {
      message = "Gemini TTS is configured for natural multilingual speech.";
    } else if (openaiConfigured) {
      message = "OpenAI TTS is configured for natural spoken replies.";
    } else if (elevenConfigured) {
      message = "ElevenLabs is configured as the primary English TTS provider.";
    } else if (cartesiaConfigured && naverConfigured) {
      message = "Cartesia Sonic is ready for English replies and NAVER CLOVA Voice is ready for Korean replies.";
    } else if (naverConfigured) {
      message = "NAVER CLOVA Voice is configured as the primary Korean TTS provider.";
    } else if (googleConfigured) {
      message = "Google Cloud TTS is available as a backup provider.";
    }

    return {
      availableProviders: ["elevenlabs", "openai", "gemini", "cartesia", "naver-clova", "google-cloud", "system", "off"],
      defaultProvider: this.getDefaultProvider(),
      configuredProviders: {
        elevenlabs: elevenConfigured,
        cartesia: cartesiaConfigured,
        naverClova: naverConfigured,
        openai: openaiConfigured,
        gemini: geminiConfigured,
        googleCloud: googleConfigured
      },
      preferredProviders: {
        en: config.providers.en,
        ko: config.providers.ko
      },
      message
    };
  }

  getProviderLabel() {
    const providers = [];

    if (this.hasElevenLabsCredentials()) {
      providers.push("elevenlabs");
    }

    if (this.hasCartesiaCredentials()) {
      providers.push("cartesia-sonic");
    }

    if (this.hasNaverClovaCredentials()) {
      providers.push("naver-clova");
    }

    if (this.hasGeminiCredentials()) {
      providers.push("gemini-tts");
    }

    if (this.hasOpenAICredentials()) {
      providers.push("openai-tts");
    }

    if (this.hasExplicitGoogleCredentials()) {
      providers.push("google-cloud");
    }

    return providers.length ? providers.join(" + ") : "system fallback";
  }

  async speakWithProvider(provider, { text, languageCode }) {
    if (provider === "off") {
      return {
        provider: "off",
        mimeType: "",
        audioContentBase64: ""
      };
    }

    if (provider === "system") {
      return {
        provider: "system",
        mimeType: "",
        audioContentBase64: ""
      };
    }

    if (provider === "elevenlabs") {
      return this.speakWithElevenLabs({
        text,
        languageCode
      });
    }

    if (provider === "cartesia") {
      return this.speakWithCartesia({
        text,
        languageCode
      });
    }

    if (provider === "naver-clova") {
      return this.speakWithNaverClova({
        text,
        languageCode
      });
    }

    if (provider === "openai") {
      return this.speakWithOpenAI({
        text,
        languageCode
      });
    }

    if (provider === "gemini") {
      return this.speakWithGemini({
        text,
        languageCode
      });
    }

    if (provider === "google-cloud") {
      return this.speakWithGoogleCloud({
        text,
        languageCode
      });
    }

    throw new Error(`Unsupported TTS provider: ${provider}`);
  }

  async synthesize({ text, language = "en", provider } = {}) {
    const languageCode = language === "ko" ? "ko-KR" : "en-US";
    const providerChain = this.getProviderChain(languageCode, provider);
    let lastError = null;

    for (const candidate of providerChain) {
      try {
        const result = await this.speakWithProvider(candidate, {
          text,
          languageCode
        });

        return {
          provider: result.provider,
          mimeType: result.mimeType,
          audioBase64: result.audioContentBase64 || ""
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      provider: "system",
      mimeType: "",
      audioBase64: "",
      error: lastError?.message || ""
    };
  }
}

module.exports = {
  TtsService
};
