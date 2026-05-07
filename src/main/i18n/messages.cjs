const catalog = require("../../shared/jarvis-messages.json");

const DEFAULT_LANGUAGE = "en";
const MESSAGES = catalog;

function normalizeLanguage(language = DEFAULT_LANGUAGE) {
  return String(language || "").trim().toLowerCase().startsWith("ko") ? "ko" : DEFAULT_LANGUAGE;
}

function getPathValue(target, key = "") {
  return String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), target);
}

function interpolate(template, params = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? ""));
}

function message(language, key, params = {}) {
  const lang = normalizeLanguage(language);
  const localized = getPathValue(MESSAGES[lang], key);
  const fallback = getPathValue(MESSAGES[DEFAULT_LANGUAGE], key);
  const resolved = localized ?? fallback;

  if (Array.isArray(resolved)) {
    return resolved.map((entry) => interpolate(entry, params));
  }

  return interpolate(resolved ?? key, params);
}

module.exports = {
  DEFAULT_LANGUAGE,
  MESSAGES,
  message,
  normalizeLanguage
};
