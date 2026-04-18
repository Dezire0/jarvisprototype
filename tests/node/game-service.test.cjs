const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
