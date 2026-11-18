const fs = require("node:fs/promises");
const path = require("node:path");
const { homedir, platform } = require("node:os");

const GAME_ID = /^[1-9]\d{0,9}$/;
const MAX_MANIFEST_BYTES = 512 * 1024;
const STEAM_SEARCH = "https://store.steampowered.com/api/storesearch/";

function gameError(code) {
  return Object.assign(new Error(code), { code });
}

function normalizeName(name) {
  return typeof name === "string"
    ? name.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, 160)
    : "";
}

function requireQuery(gameName) {
  if (typeof gameName !== "string" || !gameName.trim() || gameName.trim().length > 120) {
    throw gameError("GAMES_QUERY");
  }
  return gameName.trim();
}

function isMissing(error) {
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

async function readManifest(location) {
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  const handle = await fs.open(location, O_RDONLY | (O_NOFOLLOW ?? 0) | (O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw gameError("GAMES_SCAN");
    const contents = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < contents.length) {
      const { bytesRead } = await handle.read(contents, offset, contents.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > stat.size) throw gameError("GAMES_SCAN");
    return contents.toString("utf8", 0, offset);
  } finally {
    await handle.close();
  }
}

async function isDirectory(location) {
  try {
    return (await fs.stat(location)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

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

  if (!GAME_ID.test(appId) || !name) {
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
    if (data.bIsIncompleteInstall === true) return null;
    const name = normalizeName(data.DisplayName || data.AppName || data.CatalogItemId);

    if (!name) {
      return null;
    }

    return {
      id: String(data.AppName || data.CatalogItemId || data.CatalogNamespace || data.MainGameCatalogNamespace || "").trim(),
      name,
      installLocation: String(data.InstallLocation || "").trim()
    };
  } catch (_error) {
    return null;
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
    path.join(home, ".local", "share", "Steam"),
    path.join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam")
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

function gameLibraryGuidance(language) {
  const reply = language === "ko"
    ? "로컬 도구에서 게임을 열어 설치 목록을 확인하거나 스토어와 다운로드 화면을 열어 주세요."
    : "Open Games from Local tools to check installed games or open a store or downloads.";
  return { reply, language, actions: [], provider: "local" };
}

class GameService {
  constructor({ openExternal, fetchSteam = fetch, steamRoots = getSteamRoots(), epicRoots = getEpicManifestRoots() } = {}) {
    this.openExternal = openExternal;
    this.fetchSteam = fetchSteam;
    this.steamRoots = steamRoots;
    this.epicRoots = epicRoots;
  }

  async steamDirectories(reportIssue) {
    const directories = [];
    for (const root of this.steamRoots) {
      const directory = path.join(root, "steamapps");
      directories.push(directory);
      try {
        const config = await readManifest(path.join(directory, "libraryfolders.vdf"));
        directories.push(...parseSteamLibraryFolders(config).filter((location) => path.isAbsolute(location)));
      } catch (error) {
        if (!isMissing(error)) reportIssue();
      }
    }
    return unique(directories);
  }

  async scanLibrary(provider) {
    const games = new Map();
    let readable = false;
    let partial = false;
    const reportIssue = () => { partial = true; };
    const steam = provider === "steam";
    const directories = steam ? await this.steamDirectories(reportIssue) : this.epicRoots;
    for (const directory of directories) {
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
        readable = true;
      } catch (error) {
        if (!isMissing(error)) reportIssue();
        continue;
      }
      for (const entry of entries) {
        const nameMatch = steam ? entry.name.match(/^appmanifest_(\d+)\.acf$/i) : entry.name.match(/\.(?:item|json)$/i);
        if (!nameMatch) continue;
        try {
          // Only regular records are read, including on platforms without O_NOFOLLOW.
          if (!entry.isFile()) {
            reportIssue();
            continue;
          }
          const contents = await readManifest(path.join(directory, entry.name));
          const manifest = steam ? parseSteamManifest(contents) : parseEpicManifest(contents);
          if (!manifest) {
            reportIssue();
            continue;
          }
          if (steam && (nameMatch[1] !== manifest.appId ||
              !/^[0-9]+$/.test(manifest.stateFlags) || !(Number(manifest.stateFlags) & 4) ||
              !manifest.installDir || manifest.installDir === "." || manifest.installDir === ".." ||
              /[\x00-\x1f\/\\:]/.test(manifest.installDir))) continue;

          const id = steam ? manifest.appId : manifest.id || manifest.name;
          const location = steam ? path.join(directory, "common", manifest.installDir) : manifest.installLocation;
          if (games.has(id) || !path.isAbsolute(location) || !(await isDirectory(location))) continue;
          const name = normalizeName(manifest.name);
          if (name) games.set(id, { id, name });
        } catch (error) {
          if (!isMissing(error)) reportIssue();
        }
      }
    }
    return {
      platform: provider,
      status: directories.length === 0 ? "unsupported" : partial ? "partial" : readable ? "available" : "missing",
      games: [...games.values()].sort((a, b) => a.name.localeCompare(b.name))
    };
  }

  async listInstalledGames() {
    return Promise.all(["steam", "epic"].map((provider) => this.scanLibrary(provider)));
  }

  async searchSteamStore(gameName) {
    const query = requireQuery(gameName);
    const url = new URL(STEAM_SEARCH);
    url.search = new URLSearchParams({ term: query, l: "english", cc: "US" }).toString();
    try {
      const response = await this.fetchSteam(url, { redirect: "error", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw gameError("GAMES_SEARCH");
      const data = await response.json();
      if (!Array.isArray(data?.items)) throw gameError("GAMES_SEARCH");
      const candidates = new Map();
      for (const item of data.items.slice(0, 100)) {
        const id = String(item?.id ?? item?.appid ?? "");
        const name = normalizeName(item?.name);
        if (GAME_ID.test(id) && name && !candidates.has(id)) candidates.set(id, { id, name });
      }
      return [...candidates.values()]
        .sort((a, b) => scoreGameMatch(query, b.name) - scoreGameMatch(query, a.name))
        .slice(0, 8);
    } catch {
      throw gameError("GAMES_SEARCH");
    }
  }

  async installSteamGame(id) {
    if (typeof id !== "string" || !GAME_ID.test(id)) throw gameError("GAMES_CHOOSE_RESULT");
    return this.openDestination("steam-install", "steam://install/" + id);
  }

  async openUpdates(provider) {
    if (provider === "steam") return this.openDestination("steam-downloads", "steam://open/downloads");
    if (provider === "epic") return this.openDestination("epic-launcher", "com.epicgames.launcher://");
    throw gameError("GAMES_PLATFORM");
  }

  async openStore(provider, gameName) {
    const query = requireQuery(gameName);
    if (provider === "steam") return this.openDestination("steam-store", buildSteamSearchUrl(query));
    if (provider === "epic") return this.openDestination("epic-store", buildEpicSearchUrl(query));
    throw gameError("GAMES_PLATFORM");
  }

  async openDestination(destination, target) {
    try {
      await this.openExternal(target);
      return { destination };
    } catch {
      throw gameError(destination.endsWith("-store") ? "GAMES_STORE_OPEN" : "GAMES_LAUNCHER_OPEN");
    }
  }
}

module.exports = {
  GameService,
  buildEpicSearchUrl,
  buildSteamSearchUrl,
  gameLibraryGuidance,
  parseEpicManifest,
  parseSteamLibraryFolders,
  parseSteamManifest,
  scoreGameMatch
};
