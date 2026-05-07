const fs = require("node:fs");
const path = require("node:path");
const { homedir } = require("node:os");

const CONFIG_DIR = path.join(__dirname, "config");

let cachedConfig = null;

function readJsonConfig(name) {
  const filePath = path.join(CONFIG_DIR, name);
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function expandHome(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.replace(/\$HOME/g, homedir());
}

function deepExpandHome(value) {
  if (Array.isArray(value)) {
    return value.map(deepExpandHome);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, deepExpandHome(entry)])
    );
  }

  return expandHome(value);
}

function freezeJson(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeJson);
    return Object.freeze(value);
  }

  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeJson);
    return Object.freeze(value);
  }

  return value;
}

function validateArrayConfig(name, value, key) {
  if (!Array.isArray(value[key])) {
    throw new Error(`${name} must include an array field "${key}".`);
  }
}

function validateObjectConfig(name, value, key) {
  if (!value[key] || typeof value[key] !== "object" || Array.isArray(value[key])) {
    throw new Error(`${name} must include an object field "${key}".`);
  }
}

function loadAssistantConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  const apps = deepExpandHome(readJsonConfig("apps.json"));
  const webTargets = deepExpandHome(readJsonConfig("web-targets.json"));
  const keys = deepExpandHome(readJsonConfig("keys.json"));
  const finderLocations = deepExpandHome(readJsonConfig("finder-locations.json"));
  const openClawCapabilities = deepExpandHome(readJsonConfig("openclaw-capabilities.json"));

  validateObjectConfig("apps.json", apps, "aliases");
  validateArrayConfig("apps.json", apps, "directTargets");
  validateArrayConfig("apps.json", apps, "officialFallbacks");
  validateArrayConfig("web-targets.json", webTargets, "directTargets");
  validateArrayConfig("web-targets.json", webTargets, "aliases");
  validateObjectConfig("keys.json", keys, "keyCodes");
  validateObjectConfig("keys.json", keys, "modifiers");
  validateObjectConfig("finder-locations.json", finderLocations, "aliases");
  validateArrayConfig("openclaw-capabilities.json", openClawCapabilities, "supportedPlannerActions");

  cachedConfig = freezeJson({
    apps,
    webTargets,
    keys,
    finderLocations,
    openClawCapabilities
  });

  return cachedConfig;
}

function resetAssistantConfigCache() {
  cachedConfig = null;
}

module.exports = {
  loadAssistantConfig,
  resetAssistantConfigCache
};
