const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const { loadAssistantConfig } = require("../config-loader.cjs");

const execFileAsync = promisify(execFile);

let macAppCatalogPromise = null;

function getAppConfig() {
  return loadAssistantConfig().apps;
}

function normalizeAppToken(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\.app$/i, "")
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function splitSearchTokens(value = "") {
  return String(value)
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/g)
    .filter(Boolean);
}

function buildInitialism(value = "") {
  return splitSearchTokens(value)
    .map((token) => token[0] || "")
    .join("");
}

function normalizeSingleLineText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function buildAppEntry(appPath) {
  return {
    name: path.basename(appPath, ".app"),
    path: appPath
  };
}

async function walkAppBundles(directory, depth = 2) {
  if (depth < 0) {
    return [];
  }

  let entries = [];

  try {
    entries = await fs.readdir(directory, {
      withFileTypes: true
    });
  } catch (_error) {
    return [];
  }

  const bundles = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.name.endsWith(".app")) {
      bundles.push({
        name: entry.name.replace(/\.app$/i, ""),
        path: fullPath
      });
      continue;
    }

    if (depth > 0 && !entry.name.startsWith(".")) {
      bundles.push(...(await walkAppBundles(fullPath, depth - 1)));
    }
  }

  return bundles;
}

async function querySpotlightApps() {
  try {
    const { stdout } = await execFileAsync("mdfind", ['kMDItemContentType == "com.apple.application-bundle"']);
    return stdout
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".app"))
      .map(buildAppEntry);
  } catch (_error) {
    return [];
  }
}

async function buildMacAppCatalog() {
  const allBundles = [];
  const { searchDirs = [] } = getAppConfig();

  for (const directory of searchDirs) {
    allBundles.push(...(await walkAppBundles(directory, 2)));
  }

  allBundles.push(...(await querySpotlightApps()));

  const seen = new Set();
  return allBundles
    .filter((bundle) => {
      const normalizedPath = bundle.path.toLowerCase();
      if (!bundle.name || !bundle.path || seen.has(normalizedPath)) {
        return false;
      }

      seen.add(normalizedPath);
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function getMacAppCatalog({ forceRefresh = false } = {}) {
  if (forceRefresh) {
    macAppCatalogPromise = null;
  }

  if (!macAppCatalogPromise) {
    macAppCatalogPromise = buildMacAppCatalog();
  }

  return macAppCatalogPromise;
}

function scoreAppMatch(query, bundle) {
  const requestedTarget = String(query).trim();
  const normalizedQuery = normalizeAppToken(requestedTarget);

  if (!requestedTarget || !normalizedQuery) {
    return 0;
  }

  const normalizedName = normalizeAppToken(bundle.name);
  const queryWords = splitSearchTokens(requestedTarget);
  const nameWords = splitSearchTokens(bundle.name);
  const initialism = buildInitialism(bundle.name);
  let score = 0;

  if (normalizedName === normalizedQuery) {
    score = 120;
  } else if (bundle.name.toLowerCase() === requestedTarget.toLowerCase()) {
    score = 115;
  } else if (initialism && initialism === normalizedQuery) {
    score = 108;
  } else if (normalizedName.startsWith(normalizedQuery)) {
    score = 104;
  } else if (normalizedName.includes(normalizedQuery)) {
    score = 96;
  } else if (normalizedQuery.includes(normalizedName)) {
    score = 92;
  }

  if (queryWords.length && queryWords.every((word) => nameWords.some((candidate) => candidate.includes(word) || word.includes(candidate)))) {
    score = Math.max(score, 90 + Math.min(queryWords.length, 4));
  }

  return score;
}

async function searchMacApps(query, { limit = 20 } = {}) {
  const catalog = await getMacAppCatalog();

  if (!String(query).trim()) {
    return catalog.slice(0, limit);
  }

  return catalog
    .map((bundle) => ({
      ...bundle,
      score: scoreAppMatch(query, bundle)
    }))
    .filter((bundle) => bundle.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit);
}

async function listInstalledAppsMac({ query = "", limit = 200, forceRefresh = false } = {}) {
  const catalog = await getMacAppCatalog({
    forceRefresh
  });
  const apps = query ? await searchMacApps(query, { limit }) : catalog.slice(0, limit);

  return {
    query,
    totalCount: catalog.length,
    resultCount: apps.length,
    apps: apps.map((app) => ({
      name: app.name,
      path: app.path
    }))
  };
}

async function resolveMacAppTarget(appName = "", { allowDirect = true } = {}) {
  const requestedTarget = String(appName).trim();
  const normalized = normalizeAppToken(requestedTarget);
  const { aliases = {} } = getAppConfig();

  if (!requestedTarget) {
    throw new Error("An app name is required.");
  }

  const aliasedName = aliases[normalized];
  const matchedApp = (await searchMacApps(aliasedName || requestedTarget, { limit: 1 }))[0];

  if (matchedApp) {
    return {
      requestedTarget,
      resolvedTarget: matchedApp.name,
      openPath: matchedApp.path,
      strategy: aliasedName ? "alias-catalog" : "catalog-search"
    };
  }

  if (!allowDirect) {
    return null;
  }

  return {
    requestedTarget,
    resolvedTarget: aliasedName || requestedTarget,
    openPath: "",
    strategy: aliasedName ? "alias-direct" : "direct"
  };
}

module.exports = {
  buildAppEntry,
  buildInitialism,
  getMacAppCatalog,
  listInstalledAppsMac,
  normalizeAppToken,
  normalizeSingleLineText,
  resolveMacAppTarget,
  scoreAppMatch,
  searchMacApps,
  splitSearchTokens
};
