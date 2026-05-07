const { loadAssistantConfig } = require("../config-loader.cjs");

function getTargetConfig() {
  const config = loadAssistantConfig();
  return {
    webAliases: new Set(config.webTargets.aliases || []),
    directWebTargets: config.webTargets.directTargets || [],
    directAppTargets: config.apps.directTargets || [],
    officialAppFallbacks: config.apps.officialFallbacks || []
  };
}

function normalizeEntityToken(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function textMentionsToken(text = "", token = "") {
  const normalizedText = String(text).toLowerCase();
  const normalizedToken = String(token).toLowerCase().trim();

  if (!normalizedText || !normalizedToken) {
    return false;
  }

  if (/^[a-z0-9 ]+$/i.test(normalizedToken)) {
    return new RegExp(`(^|[^a-z0-9])${normalizedToken.replace(/\s+/g, "\\s+")}([^a-z0-9]|$)`, "i").test(
      normalizedText
    );
  }

  return normalizedText.includes(normalizedToken);
}

function findDirectTargets(text = "", definitions = [], normalizePlanText) {
  const normalized = normalizePlanText(text);
  const found = [];
  const seen = new Set();

  for (const definition of definitions) {
    if (!definition.tokens.some((token) => textMentionsToken(normalized, token))) {
      continue;
    }

    const key = definition.url || definition.label;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    found.push({
      label: definition.label,
      url: definition.url || "",
      tokens: definition.tokens
    });
  }

  return found;
}

function findOfficialAppFallback(appName = "") {
  const normalized = normalizeEntityToken(appName);
  const { officialAppFallbacks } = getTargetConfig();

  if (!normalized) {
    return null;
  }

  return (
    officialAppFallbacks.find((entry) =>
      [entry.label, ...(entry.aliases || [])].some((alias) => normalizeEntityToken(alias) === normalized)
    ) ||
    officialAppFallbacks.find((entry) =>
      [entry.label, ...(entry.aliases || [])].some((alias) => {
        const token = normalizeEntityToken(alias);
        return token && (normalized.includes(token) || token.includes(normalized));
      })
    ) ||
    null
  );
}

module.exports = {
  findDirectTargets,
  findOfficialAppFallback,
  getTargetConfig,
  normalizeEntityToken,
  textMentionsToken
};
