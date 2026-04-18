const fs = require("node:fs/promises");
const path = require("node:path");
const { homedir, platform } = require("node:os");

function normalizeGameToken(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function buildEpicSearchUrl(gameName = "") {
  return `https://store.epicgames.com/en-US/browse?q=${encodeURIComponent(String(gameName).trim())}&sortBy=relevancy&sortDir=DESC&count=40`;
}

function buildSteamSearchUrl(gameName = "") {
  return `https://store.steampowered.com/search/?term=${encodeURIComponent(String(gameName).trim())}`;
}

function scoreGameMatch(query = "", candidate = "") {
  const normalizedQuery = normalizeGameToken(query);
  const normalizedCandidate = normalizeGameToken(candidate);

  if (!normalizedQuery || !normalizedCandidate) {
    return 0;
  }

  if (normalizedQuery === normalizedCandidate) {
    return 1_000;
  }

  let score = 0;

  if (normalizedCandidate.startsWith(normalizedQuery)) {
    score += 400;
  }

  if (normalizedCandidate.includes(normalizedQuery)) {
    score += 250;
  }

  const queryTokens = normalizedQuery.split(" ");

  for (const token of queryTokens) {
    if (token && normalizedCandidate.includes(token)) {
      score += 60;
    }
  }

  return score;
}

function parseSteamManifest(content = "") {
  const appId = String(content.match(/"appid"\s+"([^"]+)"/i)?.[1] || "").trim();
  const name = String(content.match(/"name"\s+"([^"]+)"/i)?.[1] || "").trim();
  const installDir = String(content.match(/"installdir"\s+"([^"]+)"/i)?.[1] || "").trim();
  const stateFlags = String(content.match(/"StateFlags"\s+"([^"]+)"/i)?.[1] || "").trim();

  if (!appId || !name) {
    return null;
  }

  return {
    appId,
    name,
    installDir,
    stateFlags
  };
}

function parseSteamLibraryFolders(content = "") {
  const matches = content.matchAll(/"path"\s+"([^"]+)"/gi);
  const libraries = [];

  for (const match of matches) {
    const rawPath = String(match[1] || "").replace(/\\\\/g, "\\").trim();

    if (!rawPath) {
      continue;
    }

    libraries.push(path.join(rawPath, "steamapps"));
  }

  return unique(libraries);
}

function parseEpicManifest(raw = "") {
  try {
    const data = JSON.parse(raw);
    const name = String(data.DisplayName || data.AppName || data.CatalogItemId || "").trim();

    if (!name) {
      return null;
    }

    return {
      id: String(data.CatalogNamespace || data.MainGameCatalogNamespace || data.AppName || "").trim(),
      name,
      installLocation: String(data.InstallLocation || "").trim()
    };
  } catch (_error) {
    return null;
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function getSteamRoots() {
  const home = homedir();
  const currentPlatform = platform();

  if (currentPlatform === "darwin") {
    return [
      path.join(home, "Library", "Application Support", "Steam")
    ];
  }

  if (currentPlatform === "win32") {
    return [
      path.join("C:", "Program Files (x86)", "Steam"),
      path.join("C:", "Program Files", "Steam")
    ];
  }

  return [
    path.join(home, ".steam", "steam"),
    path.join(home, ".local", "share", "Steam")
  ];
}

function getEpicManifestRoots() {
  const home = homedir();
  const currentPlatform = platform();

  if (currentPlatform === "darwin") {
    return [
      path.join(home, "Library", "Application Support", "Epic", "EpicGamesLauncher", "Data", "Manifests")
    ];
  }

  if (currentPlatform === "win32") {
    return [
      path.join("C:", "ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests")
    ];
  }

  return [];
}

class GameService {
  constructor({ automation } = {}) {
    this.automation = automation || null;
  }

  async getSteamLibraryDirs() {
    const steamRoots = getSteamRoots();
    const discovered = [];

    for (const steamRoot of steamRoots) {
      const steamAppsPath = path.join(steamRoot, "steamapps");

      if (await pathExists(steamAppsPath)) {
        discovered.push(steamAppsPath);
      }

      const libraryFilePath = path.join(steamAppsPath, "libraryfolders.vdf");

      if (await pathExists(libraryFilePath)) {
        const content = await fs.readFile(libraryFilePath, "utf8");
        discovered.push(...parseSteamLibraryFolders(content));
      }
    }

    return unique(discovered);
  }

  async listSteamGames() {
    const libraries = await this.getSteamLibraryDirs();
    const games = [];
    const seen = new Set();

    for (const libraryPath of libraries) {
      if (!(await pathExists(libraryPath))) {
        continue;
      }

      const entries = await fs.readdir(libraryPath);

      for (const entry of entries) {
        if (!/^appmanifest_\d+\.acf$/i.test(entry)) {
          continue;
        }

        const manifest = parseSteamManifest(await fs.readFile(path.join(libraryPath, entry), "utf8"));

        if (!manifest || seen.has(manifest.appId)) {
          continue;
        }

        seen.add(manifest.appId);
        games.push({
          ...manifest,
          platform: "steam",
          libraryPath
        });
      }
    }

    return games.sort((left, right) => left.name.localeCompare(right.name));
  }

  async listEpicGames() {
    const roots = getEpicManifestRoots();
    const games = [];
    const seen = new Set();

    for (const manifestRoot of roots) {
      if (!(await pathExists(manifestRoot))) {
        continue;
      }

      const entries = await fs.readdir(manifestRoot);

      for (const entry of entries) {
        if (!/\.(item|json)$/i.test(entry)) {
          continue;
        }

        const manifest = parseEpicManifest(await fs.readFile(path.join(manifestRoot, entry), "utf8"));

        if (!manifest || seen.has(manifest.name)) {
          continue;
        }

        seen.add(manifest.name);
        games.push({
          ...manifest,
          platform: "epic"
        });
      }
    }

    return games.sort((left, right) => left.name.localeCompare(right.name));
  }

  pickInstalledGame(games = [], gameName = "") {
    const sorted = [...games]
      .map((game) => ({
        ...game,
        score: scoreGameMatch(gameName, game.name)
      }))
      .sort((left, right) => right.score - left.score);

    return sorted.find((game) => game.score > 0) || null;
  }

  async searchSteamStore(gameName = "") {
    const query = String(gameName).trim();

    if (!query) {
      return [];
    }

    const response = await fetch(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`
    );

    if (!response.ok) {
      throw new Error(`Steam store search failed with status ${response.status}.`);
    }

    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];

    return items
      .map((item) => ({
        appId: String(item.id || item.appid || "").trim(),
        name: String(item.name || "").trim()
      }))
      .filter((item) => item.appId && item.name)
      .sort((left, right) => scoreGameMatch(query, right.name) - scoreGameMatch(query, left.name));
  }

  async openLauncher(appName) {
    if (!this.automation || typeof this.automation.execute !== "function") {
      return {
        opened: false
      };
    }

    try {
      const data = await this.automation.execute({
        type: "open_app",
        target: appName
      });
      return {
        opened: true,
        appName: data.resolvedTarget || data.appName || appName
      };
    } catch (_error) {
      return {
        opened: false,
        appName
      };
    }
  }

  async openUrl(target) {
    if (!this.automation || typeof this.automation.execute !== "function") {
      throw new Error("Desktop automation is not available.");
    }

    return this.automation.execute({
      type: "open_url",
      target
    });
  }

  async installGame({ gameName, platform = "both" } = {}) {
    const normalizedPlatform = platform === "steam" || platform === "epic" ? platform : "both";
    const query = String(gameName || "").trim();

    if (!query) {
      throw new Error("A game name is required.");
    }

    if (normalizedPlatform !== "epic") {
      const storeResults = await this.searchSteamStore(query).catch(() => []);
      const best = storeResults[0];

      if (best) {
        const launcher = await this.openLauncher("Steam");
        const installUrl = `steam://install/${best.appId}`;
        let openedInstallUrl = true;

        try {
          await this.openUrl(installUrl);
        } catch (_error) {
          openedInstallUrl = false;
          await this.openUrl(buildSteamSearchUrl(best.name));
        }

        return {
          action: "install",
          platform: "steam",
          query,
          gameName: best.name,
          appId: best.appId,
          installUrl,
          launcherOpened: launcher.opened,
          openedInstallUrl,
          searchResults: storeResults.slice(0, 5)
        };
      }
    }

    const epicSearchUrl = buildEpicSearchUrl(query);
    const launcher = await this.openLauncher("Epic Games Launcher");
    await this.openUrl(epicSearchUrl);

    return {
      action: "install",
      platform: "epic",
      query,
      gameName: query,
      searchUrl: epicSearchUrl,
      launcherOpened: launcher.opened
    };
  }

  async updateGame({ gameName = "", platform = "both" } = {}) {
    const normalizedPlatform = platform === "steam" || platform === "epic" ? platform : "both";
    const query = String(gameName || "").trim();

    if (normalizedPlatform !== "epic") {
      const launcher = await this.openLauncher("Steam");
      const installedGames = await this.listSteamGames();
      const matchedGame = query ? this.pickInstalledGame(installedGames, query) : null;
      const targetUrl = matchedGame
        ? `steam://update/${matchedGame.appId}`
        : "steam://open/downloads";
      let openedTargetUrl = true;

      try {
        await this.openUrl(targetUrl);
      } catch (_error) {
        openedTargetUrl = false;
        await this.openUrl(query ? buildSteamSearchUrl(query) : "https://store.steampowered.com/");
      }

      return {
        action: "update",
        platform: "steam",
        query,
        gameName: matchedGame?.name || query,
        appId: matchedGame?.appId || "",
        targetUrl,
        openedTargetUrl,
        launcherOpened: launcher.opened
      };
    }

    const launcher = await this.openLauncher("Epic Games Launcher");
    const searchUrl = query ? buildEpicSearchUrl(query) : "https://store.epicgames.com/en-US/";
    await this.openUrl(searchUrl);

    return {
      action: "update",
      platform: "epic",
      query,
      gameName: query,
      searchUrl,
      launcherOpened: launcher.opened
    };
  }

  async listInstalledGames({ platform = "both" } = {}) {
    const normalizedPlatform = platform === "steam" || platform === "epic" ? platform : "both";
    const steamGames = normalizedPlatform === "epic" ? [] : await this.listSteamGames();
    const epicGames = normalizedPlatform === "steam" ? [] : await this.listEpicGames();

    return {
      action: "list",
      platform: normalizedPlatform,
      steamGames,
      epicGames,
      totalCount: steamGames.length + epicGames.length
    };
  }
}

module.exports = {
  GameService,
  buildEpicSearchUrl,
  buildSteamSearchUrl,
  parseEpicManifest,
  parseSteamLibraryFolders,
  parseSteamManifest,
  scoreGameMatch
};
