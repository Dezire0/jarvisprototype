const path = require("node:path");
const packageJson = require("./package.json");

const publishProvider = String(process.env.JARVIS_UPDATER_PROVIDER || "").trim().toLowerCase();
const publishChannel = String(process.env.JARVIS_UPDATE_CHANNEL || "latest").trim() || "latest";

function parseGithubRepo(candidate) {
  const normalized = String(candidate || "").trim();
  if (!normalized) {
    return null;
  }

  let match = normalized.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (match) {
    return {
      owner: match[1],
      repo: match[2]
    };
  }

  match = normalized.match(/^([^/]+)\/([^/.]+)$/);
  if (match) {
    return {
      owner: match[1],
      repo: match[2]
    };
  }

  return null;
}

function getDefaultGithubRepo() {
  const repository = packageJson.repository;
  if (!repository) {
    return null;
  }

  if (typeof repository === "string") {
    return parseGithubRepo(repository);
  }

  return parseGithubRepo(repository.url);
}

function buildPublishConfig() {
  if (publishProvider === "generic") {
    const baseUrl = String(process.env.JARVIS_UPDATE_BASE_URL || "").trim();

    if (!baseUrl) {
      return [];
    }

    return [
      {
        provider: "generic",
        url: baseUrl,
        channel: publishChannel
      }
    ];
  }

  if (publishProvider === "github") {
    const owner = String(process.env.JARVIS_GITHUB_OWNER || "").trim();
    const repo = String(process.env.JARVIS_GITHUB_REPO || "").trim();
    const fallbackRepo = getDefaultGithubRepo();

    if ((!owner || !repo) && !fallbackRepo) {
      return [];
    }

    return [
      {
        provider: "github",
        owner: owner || fallbackRepo.owner,
        repo: repo || fallbackRepo.repo,
        releaseType: String(process.env.JARVIS_GITHUB_RELEASE_TYPE || "release").trim() || "release",
        private: process.env.JARVIS_GITHUB_PRIVATE === "1"
      }
    ];
  }

  if (!publishProvider) {
    const fallbackRepo = getDefaultGithubRepo();
    if (fallbackRepo) {
      return [
        {
          provider: "github",
          owner: fallbackRepo.owner,
          repo: fallbackRepo.repo,
          releaseType: "release",
          private: false
        }
      ];
    }
  }

  return [];
}

const publish = buildPublishConfig();

module.exports = {
  appId: "ai.jarvis.desktop",
  productName: "Jarvis Desktop",
  afterSign: path.join(__dirname, "scripts", "notarize-macos.cjs"),
  directories: {
    output: "release"
  },
  artifactName: "Jarvis-Desktop-${version}-${os}-${arch}.${ext}",
  files: [
    "src/**/*",
    "package.json",
    "README.md",
    "!Jarvis Ui{,/**}",
    "!build{,/**}",
    "!dist{,/**}",
    "!release{,/**}",
    "!tests{,/**}",
    "!docs{,/**}",
    "!claw-code-main*{,/**}",
    "!tmp-browser-profile{,/**}",
    "!secret{,/**}"
  ],
  extraResources: [
    {
      from: "build/desktop-ui",
      to: "desktop-ui",
      filter: ["**/*"]
    }
  ],
  mac: {
    icon: path.join(__dirname, "resources", "icons", "icon.icns"),
    hardenedRuntime: true,
    gatekeeperAssess: false,
    category: "public.app-category.productivity",
    entitlements: path.join(__dirname, "resources", "macos", "entitlements.mac.plist"),
    entitlementsInherit: path.join(__dirname, "resources", "macos", "entitlements.mac.inherit.plist"),
    extendInfo: {
      NSMicrophoneUsageDescription: "Jarvis Desktop uses the microphone for voice input and assistant conversations.",
      NSSpeechRecognitionUsageDescription: "Jarvis Desktop uses speech recognition to understand spoken commands.",
      NSAppleEventsUsageDescription: "Jarvis Desktop uses Apple Events to open and control apps on your Mac."
    },
    target: ["dmg", "zip"]
  },
  win: {
    icon: path.join(__dirname, "resources", "icons", "icon.ico"),
    target: ["nsis"]
  },
  linux: {
    icon: path.join(__dirname, "resources", "icons", "icon.png"),
    category: "Utility",
    target: ["AppImage", "deb"]
  },
  publish
};
