const { maxTextLength, providers } = require("./assistant/voice-output.json");

function workspaceVoiceProvider(provider) {
  return typeof provider === "string" && Object.hasOwn(providers, provider) ? provider : "system";
}

async function synthesizeWorkspaceVoice(tts, payload) {
  const { text, language, provider } = payload || {};
  if (typeof text !== "string" || !text.trim() || text.length > maxTextLength ||
      (language !== "ko" && language !== "en") || typeof provider !== "string" ||
      !Object.hasOwn(providers, provider)) return { status: "invalid" };

  if (provider !== workspaceVoiceProvider(tts.getRuntimeConfig().providers[language])) {
    return { status: "settings-changed" };
  }
  if (provider === "off" || provider === "system") return { status: provider };

  try {
    const result = await tts.speakWithProvider(provider, { text, languageCode: language === "ko" ? "ko-KR" : "en-US" });
    const { audioContentBase64, mimeType } = result;
    if (typeof audioContentBase64 !== "string" || !audioContentBase64 || audioContentBase64.length > 8 * 1024 * 1024 ||
        !["audio/mpeg", "audio/wav", "audio/mp3"].includes(mimeType)) return { status: "failed" };
    return { status: "audio", audioBase64: audioContentBase64, mimeType };
  } catch {
    return { status: "failed" };
  }
}

module.exports = { workspaceVoiceProvider, synthesizeWorkspaceVoice };
