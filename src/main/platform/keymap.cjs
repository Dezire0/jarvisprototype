const { loadAssistantConfig } = require("../config-loader.cjs");

function getKeyConfig() {
  return loadAssistantConfig().keys;
}

function normalizeKeyToken(value = "") {
  return String(value).trim().toLowerCase();
}

function normalizeMenuPath(menuPath) {
  if (Array.isArray(menuPath)) {
    return menuPath.map((part) => String(part).trim()).filter(Boolean);
  }

  return String(menuPath)
    .split(/>|\/|→|›/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildUsingClause(modifiers = []) {
  const { modifiers: modifierMap = {} } = getKeyConfig();
  const normalized = [...new Set(
    (modifiers || [])
      .map((modifier) => modifierMap[String(modifier).toLowerCase()])
      .filter(Boolean)
  )];

  return normalized.length ? ` using {${normalized.join(", ")}}` : "";
}

function getAppleKeyCode(value = "") {
  const { keyCodes = {} } = getKeyConfig();
  return keyCodes[normalizeKeyToken(value)];
}

module.exports = {
  buildUsingClause,
  getAppleKeyCode,
  normalizeKeyToken,
  normalizeMenuPath
};
