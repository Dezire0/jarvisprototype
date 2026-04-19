const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return "";
}

function getLanguageHint(language = "") {
  const normalized = String(language || "").trim().toLowerCase();

  if (normalized.startsWith("ko")) {
    return "ko";
  }

  if (normalized.startsWith("en")) {
    return "en";
  }

  return "";
}

async function extractErrorDetail(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || `status ${response.status}`;
  } catch (_error) {
    return `status ${response.status}`;
  }
}

class SttService {
  constructor({ settingsStore }) {
    this.settingsStore = settingsStore;
  }

  getProviderChain() {
    const settings = this.settingsStore?.getTtsSettings?.() || {};
    const openaiKey = pickFirstNonEmpty(settings.openai?.apiKey, process.env.OPENAI_API_KEY);
    const groqKey = pickFirstNonEmpty(process.env.GROQ_API_KEY);
    const chain = [];

    if (openaiKey) {
      chain.push({
        name: "openai",
        apiKey: openaiKey,
        model: pickFirstNonEmpty(process.env.OPENAI_STT_MODEL, "gpt-4o-mini-transcribe"),
        url: OPENAI_TRANSCRIPTION_URL
      });
    }

    if (groqKey) {
      chain.push({
        name: "groq",
        apiKey: groqKey,
        model: pickFirstNonEmpty(process.env.GROQ_STT_MODEL, "whisper-large-v3-turbo"),
        url: GROQ_TRANSCRIPTION_URL
      });
    }

    return chain;
  }

  getStatus() {
    const providers = this.getProviderChain();

    return {
      available: providers.length > 0,
      providers: providers.map((provider) => provider.name),
      label: providers.length
        ? `cloud-stt:${providers.map((provider) => provider.name).join("+")}`
        : "web-speech-only"
    };
  }

  async transcribe({ audioBase64, mimeType = "audio/webm", language = "" } = {}) {
    const audio = String(audioBase64 || "").trim();

    if (!audio) {
      throw new Error("No audio payload was provided for transcription.");
    }

    const providers = this.getProviderChain();
    if (!providers.length) {
      throw new Error("Cloud speech-to-text is not configured. Set OPENAI_API_KEY or GROQ_API_KEY.");
    }

    const buffer = Buffer.from(audio, "base64");
    const extension = mimeType.includes("wav")
      ? "wav"
      : mimeType.includes("mp4")
        ? "mp4"
        : mimeType.includes("mpeg")
          ? "mp3"
          : "webm";
    const languageHint = getLanguageHint(language);
    let lastError = null;

    for (const provider of providers) {
      try {
        const form = new FormData();
        const blob = new Blob([buffer], { type: mimeType || "audio/webm" });
        form.append("file", blob, `jarvis-input.${extension}`);
        form.append("model", provider.model);
        if (languageHint) {
          form.append("language", languageHint);
        }

        const response = await fetch(provider.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`
          },
          body: form
        });

        if (!response.ok) {
          throw new Error(`${provider.name} transcription failed: ${await extractErrorDetail(response)}`);
        }

        const data = await response.json();
        const text = String(data?.text || "").trim();

        if (!text) {
          throw new Error(`${provider.name} transcription returned an empty transcript.`);
        }

        return {
          provider: provider.name,
          text
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Speech transcription failed.");
  }
}

module.exports = {
  SttService
};
