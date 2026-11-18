const { maxTextLength, providers } = require("./assistant/voice-output.json");

function workspaceVoiceProvider(provider) {
  return typeof provider === "string" && Object.hasOwn(providers, provider) ? provider : "system";
}

function workspaceAutoReadEngine(preference, configured) {
  const engine = workspaceVoiceProvider(configured);
  if (engine === "off" || typeof preference !== "string" || !Object.hasOwn(providers, preference)) return "off";
  return preference === "system" || preference === engine ? preference : "off";
}

async function synthesizeWorkspaceVoice(tts, payload, autoRead) {
  const { text, language, provider, automatic } = payload || {};
  if (typeof text !== "string" || !text.trim() || text.length > maxTextLength ||
      (language !== "ko" && language !== "en") || typeof provider !== "string" ||
      !Object.hasOwn(providers, provider)) return { status: "invalid" };

  const config = tts.getRuntimeConfig();
  const expected = automatic === true
    ? workspaceAutoReadEngine(autoRead?.[language], config.providers[language])
    : workspaceVoiceProvider(config.providers[language]);
  if (provider !== expected) {
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

module.exports = { workspaceVoiceProvider, workspaceAutoReadEngine, synthesizeWorkspaceVoice };
