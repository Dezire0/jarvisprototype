const path = require("node:path");
const packageJson = require("./package.json");
const { buildMacWakeSpeech } = require("./scripts/build-mac-wake-speech.cjs");
const signingName = String(process.env.CSC_NAME || "").trim();
const hasSigningIdentity = Boolean(String(process.env.CSC_LINK || "").trim() || (signingName && signingName !== "-"));

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

const publish = [
  {
    provider: "github",
    owner: "Dezire0",
    repo: "jarvisprototype",
    releaseType: "release",
    private: false
  }
];

module.exports = {
  appId: "ai.jarvis.desktop",
  productName: "Jarvis Desktop",
  afterSign: path.join(__dirname, "scripts", "notarize-macos.cjs"),
  beforePack: (context) => {
    if (context.electronPlatformName === "darwin") buildMacWakeSpeech();
  },
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
    extraResources: [{ from: "build/macos-wake-speech/jarvis-wake-speech", to: "wake-speech/jarvis-wake-speech" }],
    sign: async (options) => {
      const helper = path.join(options.app, "Contents", "Resources", "wake-speech", "jarvis-wake-speech");
      await require("@electron/osx-sign").signAsync({
        ...options,
        optionsForFile: (file) => {
          const original = options.optionsForFile?.(file);
          return file === helper ? {
            ...original,
            entitlements: path.join(__dirname, "resources", "macos", "entitlements.wake-speech.plist")
          } : original;
        }
      });
    },
    icon: path.join(__dirname, "resources", "icons", "icon.icns"),
    hardenedRuntime: hasSigningIdentity,
    gatekeeperAssess: false,
    // Sign local builds without requiring an Apple Developer ID.
    identity: hasSigningIdentity ? undefined : "-",
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
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Jarvis Desktop",
    uninstallDisplayName: "Jarvis Desktop"
  },
  linux: {
    icon: path.join(__dirname, "resources", "icons", "icon.png"),
    category: "Utility",
    target: ["AppImage", "deb"]
  },
  publish
};
