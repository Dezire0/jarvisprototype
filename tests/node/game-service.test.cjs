const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");

const {
  GameService,
  parseEpicManifest,
  parseSteamLibraryFolders,
  parseSteamManifest,
  scoreGameMatch
} = require("../../src/main/game-service.cjs");

test("parseSteamManifest reads basic app metadata", () => {
  const manifest = parseSteamManifest(`
    "AppState"
    {
      "appid" "578080"
      "name" "PUBG: BATTLEGROUNDS"
      "StateFlags" "4"
      "installdir" "PUBG"
    }
  `);

  assert.deepEqual(manifest, {
    appId: "578080",
    name: "PUBG: BATTLEGROUNDS",
    installDir: "PUBG",
    stateFlags: "4"
  });
});

test("parseSteamLibraryFolders extracts steamapps directories", () => {
  const libraries = parseSteamLibraryFolders(`
    "libraryfolders"
    {
      "0"
      {
        "path" "/Users/test/Library/Application Support/Steam"
      }
      "1"
      {
        "path" "/Volumes/Games/SteamLibrary"
      }
    }
  `);

  assert.deepEqual(libraries, [
    "/Users/test/Library/Application Support/Steam/steamapps",
    "/Volumes/Games/SteamLibrary/steamapps"
  ]);
});

test("parseEpicManifest reads display name and install location", () => {
  const manifest = parseEpicManifest(JSON.stringify({
    DisplayName: "Fortnite",
    InstallLocation: "/Games/Fortnite",
    AppName: "Fortnite"
  }));

  assert.deepEqual(manifest, {
    id: "Fortnite",
    name: "Fortnite",
    installLocation: "/Games/Fortnite"
  });
});

test("scoreGameMatch prefers exact and prefix matches", () => {
  assert.ok(scoreGameMatch("pubg", "PUBG") > scoreGameMatch("pubg", "Fortnite"));
  assert.ok(scoreGameMatch("fort", "Fortnite") > 0);
});

test("installed library scans real manifests and folders without returning install paths", async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "jarvis-games-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const steam = path.join(root, "Steam");
  const epic = path.join(root, "EpicManifest");
  const secondary = path.join(root, "OtherLibrary");
  const steamApps = path.join(steam, "steamapps");
  const extraApps = path.join(secondary, "steamapps");
  const installedEpic = path.join(root, "EpicGame");
  await Promise.all([epic, installedEpic, path.join(steamApps, "common", "Astral"), path.join(extraApps, "common", "Ridge")]
    .map((location) => fs.mkdir(location, { recursive: true })));
  const steamRecord = (id, name, folder, flags = "4") =>
    `"appid" "${id}" "name" "${name}" "installdir" "${folder}" "StateFlags" "${flags}"`;
  const epicRecord = (name, installLocation, fields = {}) => JSON.stringify({
    DisplayName: name, InstallLocation: installLocation, AppName: name, ...fields,
  });
  await Promise.all([
    fs.writeFile(path.join(steamApps, "libraryfolders.vdf"), `"path" ${JSON.stringify(secondary)}`),
    fs.writeFile(path.join(steamApps, "appmanifest_10.acf"), steamRecord("10", "Astral", "Astral")),
    fs.writeFile(path.join(steamApps, "appmanifest_11.acf"), steamRecord("11", "Stale Steam record", "Missing")),
    fs.writeFile(path.join(steamApps, "appmanifest_12.acf"), steamRecord("12", "Unfinished Steam record", "Astral", "2")),
    fs.writeFile(path.join(steamApps, "appmanifest_13.acf"), steamRecord("15", "Inconsistent", "Astral")),
    fs.writeFile(path.join(extraApps, "appmanifest_20.acf"), steamRecord("20", "Ridge", "Ridge")),
    fs.writeFile(path.join(epic, "installed.item"), epicRecord("Canyon", installedEpic)),
    fs.writeFile(path.join(epic, "stale.item"), epicRecord("Stale Epic record", path.join(root, "Missing"))),
    fs.writeFile(path.join(epic, "unknown.item"), "{invalid JSON"),
  ]);
  const games = new GameService({ steamRoots: [steam], epicRoots: [epic] });
  assert.deepEqual(await games.listInstalledGames(), [
    { platform: "steam", status: "available", games: [{ id: "10", name: "Astral" }, { id: "20", name: "Ridge" }] },
    { platform: "epic", status: "partial", games: [{ id: "Canyon", name: "Canyon" }] },
  ]);

  const missing = new GameService({ steamRoots: [path.join(root, "Missing")], epicRoots: [] });
  assert.deepEqual(await missing.listInstalledGames(), [
    { platform: "steam", status: "missing", games: [] },
    { platform: "epic", status: "unsupported", games: [] },
  ]);
});

test("Steam search returns ranked bounded selections and keeps handoffs separate", async () => {
  const calls = [];
  const service = new GameService({
    openExternal: async (url) => calls.push(url),
    fetchSteam: async (url, options) => {
      assert.equal(url.origin, "https://store.steampowered.com");
      assert.equal(url.pathname, "/api/storesearch/");
      assert.equal(url.searchParams.get("term"), "Astral & Ridge");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => ({ items: [
        { id: 24, name: "Different game" },
        { id: 25, name: "Astral & Ridge" },
        { id: "25", name: "Duplicate" },
        { id: "25x", name: "Invalid" },
        null,
      ] }) };
    }
  });
  assert.deepEqual(await service.searchSteamStore("Astral & Ridge"), [
    { id: "25", name: "Astral & Ridge" }, { id: "24", name: "Different game" },
  ]);
  assert.deepEqual(calls, []);
  assert.deepEqual(await service.installSteamGame("25"), { destination: "steam-install" });
  await assert.rejects(service.installSteamGame("invalid"), { code: "GAMES_CHOOSE_RESULT" });
  assert.deepEqual(await service.openUpdates("steam"), { destination: "steam-downloads" });
  assert.deepEqual(await service.openUpdates("epic"), { destination: "epic-launcher" });
  assert.deepEqual(await service.openStore("epic", "Astral & Ridge"), { destination: "epic-store" });
  assert.deepEqual(calls.slice(0, 3), ["steam://install/25", "steam://open/downloads", "com.epicgames.launcher://"]);
  const storeUrl = new URL(calls[3]);
  assert.equal(storeUrl.origin, "https://store.epicgames.com");
  assert.equal(storeUrl.searchParams.get("q"), "Astral & Ridge");
});

test("store failure and missing launchers return specific errors without automatic fallbacks", async () => {
  const calls = [];
  const service = new GameService({
    fetchSteam: async () => ({ ok: false }),
    openExternal: async (url) => { calls.push(url); throw new Error("No handler"); }
  });
  await assert.rejects(service.searchSteamStore("Example"), { code: "GAMES_SEARCH" });
  assert.deepEqual(calls, []);
  await assert.rejects(service.installSteamGame("25"), { code: "GAMES_LAUNCHER_OPEN" });
  await assert.rejects(service.openUpdates("epic"), { code: "GAMES_LAUNCHER_OPEN" });
  await assert.rejects(service.openStore("unknown", "Example"), { code: "GAMES_PLATFORM" });
  assert.deepEqual(calls, ["steam://install/25", "com.epicgames.launcher://"]);
});

test("assistant routes leave game reads and launcher handoffs for the desktop panel", async () => {
  const { AssistantService } = require("../../src/main/assistant-service.cjs");
  const assistant = new AssistantService({ computerControl: { enabled: false } });
  assistant.handleModelConversation = () => assert.fail("Exact game commands must stay local");
  for (const command of ["installed games", "게임 설치", "epic store", "find game Example", "에픽에서 찾기 예시 게임"]) {
    const result = await assistant.handleInput(command);
    assert.deepEqual(result.actions, []);
    assert.equal(result.provider, "local");
    assert.match(result.reply, /Local tools|로컬 도구/);
  }
  for (const route of ["game_install", "game_update", "game_list"]) {
    const result = await assistant.handleGameRoute("Manage Steam", { route });
    assert.match(result.reply, /Open Games/);
    assert.deepEqual(result.actions, []);
  }
});
