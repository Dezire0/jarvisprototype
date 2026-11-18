const OPENAI_DEFAULT_ORIGIN = "https://api.openai.com";

function getOpenAIEndpointOrigin(value) {
  const url = String(value || "").trim() || OPENAI_DEFAULT_ORIGIN;
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  return ["https:", "http:"].includes(parsed.protocol) ? parsed.origin : null;
}

module.exports = { OPENAI_DEFAULT_ORIGIN, getOpenAIEndpointOrigin };
