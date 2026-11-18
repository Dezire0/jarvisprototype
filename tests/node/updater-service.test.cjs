const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");

const {
  UpdaterService,
  chooseGithubAsset,
  chooseNewestReleaseWithAsset,
  compareVersions,
  normalizeVersion,
  parseGithubRepo
} = require("../../src/main/updater-service.cjs");

function makeApp(overrides = {}) {
  return {
    getVersion() {
      return overrides.version || "1.8.4";
    },
    getPath(name) {
      if (name === "downloads") {
        return "/tmp";
      }

      return "/tmp";
    },
    isPackaged: overrides.isPackaged ?? true,
    quit() {}
  };
}

function platformAssetName(version) {
  if (process.platform === "darwin") {
    return `Jarvis-Desktop-${version}-mac-${process.arch}.dmg`;
  }

  if (process.platform === "win32") {
    return `Jarvis-Desktop-${version}-win-${process.arch}.exe`;
  }

  return `Jarvis-Desktop-${version}-linux-${process.arch}.AppImage`;
}

function platformAsset(version) {
  const name = platformAssetName(version);
  return {
    name,
    browser_download_url: `https://example.com/releases/${name}`
  };
}

test("normalizeVersion removes leading v prefixes", () => {
  assert.equal(normalizeVersion("v1.8.5"), "1.8.5");
  assert.equal(normalizeVersion("  V2.0.0 "), "2.0.0");
});

test("compareVersions handles semver-like numeric tags", () => {
  assert.equal(compareVersions("v1.8.5", "1.8.4"), 1);
  assert.equal(compareVersions("1.8.4", "v1.8.5"), -1);
  assert.equal(compareVersions("1.8.4", "1.8.4"), 0);
});

test("parseGithubRepo supports repository URLs and owner slash repo shorthand", () => {
  assert.deepEqual(parseGithubRepo("https://github.com/Dezire0/jarvisprototype.git"), {
    owner: "Dezire0",
    repo: "jarvisprototype"
  });

  assert.deepEqual(parseGithubRepo("Dezire0/jarvisprototype"), {
    owner: "Dezire0",
    repo: "jarvisprototype"
  });
});

test("chooseGithubAsset prefers the current platform installer artifact", () => {
  const version = "1.8.5";
  const preferred = platformAsset(version);
  const candidates = [
    {
      name: `Jarvis-Desktop-${version}-source.zip`,
      browser_download_url: "https://example.com/source.zip"
    },
    preferred
  ];

  assert.deepEqual(chooseGithubAsset(candidates), preferred);
});

test("chooseNewestReleaseWithAsset ignores draft and older releases by version comparison", () => {
  const currentVersion = "1.8.4";
  const releases = [
    {
      tag_name: "v1.8.4",
      assets: [platformAsset("1.8.4")]
    },
    {
      tag_name: "v1.8.6",
      assets: []
    },
    {
      tag_name: "v1.8.5",
      html_url: "https://github.com/Dezire0/jarvisprototype/releases/tag/v1.8.5",
      assets: [platformAsset("1.8.5")]
    }
  ];

  const match = chooseNewestReleaseWithAsset(releases, currentVersion);

  assert.equal(match.version, "1.8.5");
  assert.equal(match.asset.name, platformAssetName("1.8.5"));
});

test("UpdaterService enables GitHub installer fallback for packaged apps when repository metadata exists", async () => {
  const service = new UpdaterService({
    app: makeApp({ isPackaged: true, version: "1.8.4" })
  });

  await service.init();
  const status = service.getStatus();

  assert.equal(status.enabled, true);
  assert.equal(status.mode, "installer");
  assert.match(status.releasePageUrl, /github\.com\/Dezire0\/jarvisprototype\/releases/);
});

test("a manual update opens only the configured releases page and never downloads or quits", async () => {
  const opened = [];
  const app = makeApp();
  app.quit = () => assert.fail("A manual update must leave the app open.");
  const service = new UpdaterService({ app, openReleasePage: async (url) => { opened.push(url); } });
  await service.init();
  service.status.manualInstall = true;
  service.downloadInstallerAsset = () => assert.fail("Manual installation does not download in Jarvis.");
  assert.deepEqual(await service.installUpdate(), { ok: false });
  Object.assign(service.status, {
    state: "available",
    downloadUrl: "https://example.invalid/installer.dmg",
    releasePageUrl: "https://example.invalid/releases",
  });
  const targetUrl = service.fallbackConfig.releaseNotesUrl;
  assert.deepEqual(await service.installUpdate(), { ok: true, mode: "installer", targetUrl });
  assert.deepEqual(opened, [targetUrl]);
  service.status.state = "downloaded";
  service.status.downloadPath = "/tmp/legacy-download.dmg";
  service.openReleasePage = async () => { throw new Error("Shell failure"); };
  assert.deepEqual(await service.installUpdate(), { ok: false, mode: "installer", message: "Could not open the release page." });
});

test("native updates preserve signature verification and restart only on request", async () => {
  const native = new EventEmitter();
  const verifySignature = () => {};
  native.verifyUpdateCodeSignature = verifySignature;
  let restarts = 0;
  native.quitAndInstall = () => { restarts++; };
  const filename = require.resolve("../../src/main/updater-service.cjs");
  const original = require.cache[filename];
  const load = Module._load;
  let NativeUpdaterService;
  try {
    delete require.cache[filename];
    Module._load = function (request, parent, ...args) {
      if (request === "electron-updater" && parent?.filename === filename) return { autoUpdater: native };
      return load.call(this, request, parent, ...args);
    };
    NativeUpdaterService = require(filename).UpdaterService;
  } finally {
    Module._load = load;
    require.cache[filename] = original;
  }
  const service = new NativeUpdaterService({ app: makeApp() });
  service.nativeUpdaterEnabled = true;
  service.status.manualInstall = false;
  service.installNativeUpdaterHandlers();
  assert.equal(native.autoInstallOnAppQuit, false);
  assert.equal(native.verifyUpdateCodeSignature, verifySignature);
  assert.equal((await service.installUpdate()).ok, false);
  native.emit("update-downloaded", { version: "1.9.1" });
  assert.equal(restarts, 0);
  assert.deepEqual(await service.installUpdate(), { ok: true, mode: "native" });
  assert.equal(restarts, 1);
});
