const fs = require("node:fs/promises");
const path = require("node:path");
const { homedir } = require("node:os");

const { loadAssistantConfig } = require("../config-loader.cjs");
const { normalizeAppToken } = require("./app-registry.cjs");

function normalizeFinderToken(value = "") {
  return normalizeAppToken(
    String(value)
      .replace(/\b(folder|directory|path)\b/gi, "")
      .replace(/폴더|디렉터리|경로/g, "")
  );
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function resolveFinderPath(target = "") {
  const requested = String(target).trim().replace(/^["']|["']$/g, "");
  const normalized = normalizeFinderToken(requested);
  const aliases = loadAssistantConfig().finderLocations.aliases || {};

  if (!requested) {
    return homedir();
  }

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  const expanded = requested.replace(/^~(?=$|\/)/, homedir());
  const directCandidate = path.isAbsolute(expanded)
    ? expanded
    : expanded.startsWith(".") || expanded.includes("/")
      ? path.resolve(process.cwd(), expanded)
      : "";

  if (directCandidate && (await pathExists(directCandidate))) {
    return directCandidate;
  }

  const fallbackCandidates = [
    path.join(process.cwd(), requested),
    path.join(homedir(), requested),
    path.join(homedir(), "Desktop", requested),
    path.join(homedir(), "Documents", requested),
    path.join(homedir(), "Downloads", requested)
  ];

  for (const candidate of fallbackCandidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return "";
}

module.exports = {
  normalizeFinderToken,
  pathExists,
  resolveFinderPath
};
