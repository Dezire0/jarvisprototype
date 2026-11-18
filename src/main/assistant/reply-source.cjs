const replyProviderLabels = {
  ollama: { ko: "Ollama", en: "Ollama" },
  gemini: { ko: "Gemini API", en: "Gemini API" },
  groq: { ko: "Groq API", en: "Groq API" },
  "openai-compatible": { ko: "OpenAI 호환 API", en: "OpenAI-compatible API" },
  "gemini-cli": { ko: "Gemini CLI", en: "Gemini CLI" },
  "openai-cli": { ko: "Codex CLI", en: "Codex CLI" },
  anthropic: { ko: "Anthropic API", en: "Anthropic API" },
  "claude-code": { ko: "Claude Code", en: "Claude Code" },
  "jarvis-cloud": { ko: "Jarvis Cloud", en: "Jarvis Cloud" },
};

/** @typedef {{ provider: keyof typeof replyProviderLabels, model?: string }} ReplySource */

/** @param {unknown} value @returns {ReplySource | undefined} */
function normalizeReplySource(value) {
  if (!value || typeof value !== "object" || !("provider" in value) ||
      typeof value.provider !== "string" || !Object.hasOwn(replyProviderLabels, value.provider)) return undefined;
  const provider = /** @type {ReplySource["provider"]} */ (value.provider);
  const model = "model" in value && typeof value.model === "string" ? value.model : "";
  const identifier = /^[a-z\d][a-z\d._:+-]*(?:\/[a-z\d][a-z\d._:+-]*)*$/i;
  return model.length <= 100 && model.trim() === model && identifier.test(model)
    ? { provider, model }
    : { provider };
}

/** @param {unknown} value @param {boolean} korean */
function formatReplySource(value, korean) {
  const source = normalizeReplySource(value);
  if (!source) return "";
  return [replyProviderLabels[source.provider][korean ? "ko" : "en"], source.model].filter(Boolean).join(" · ");
}

module.exports = { normalizeReplySource, formatReplySource };
