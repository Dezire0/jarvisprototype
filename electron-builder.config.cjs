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
    hardenedRuntime: Boolean(process.env.CSC_LINK),
    gatekeeperAssess: false,
    // CSC_LINK가 설정되지 않은 경우 ad-hoc 서명 사용 (서명 불일치로 인한 업데이트 실패 방지)
    identity: process.env.CSC_LINK ? undefined : null,
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
