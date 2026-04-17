const path = require("node:path");

const publishProvider = String(process.env.JARVIS_UPDATER_PROVIDER || "").trim().toLowerCase();
const publishChannel = String(process.env.JARVIS_UPDATE_CHANNEL || "latest").trim() || "latest";

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

    if (!owner || !repo) {
      return [];
    }

    return [
      {
        provider: "github",
        owner,
        repo,
        releaseType: String(process.env.JARVIS_GITHUB_RELEASE_TYPE || "release").trim() || "release",
        private: process.env.JARVIS_GITHUB_PRIVATE === "1"
      }
    ];
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
    target: ["nsis"]
  },
  linux: {
    category: "Utility",
    target: ["AppImage", "deb"]
  },
  publish
};
