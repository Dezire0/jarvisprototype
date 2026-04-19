const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { loadProjectEnv } = require("../src/main/project-env.cjs");

const repoRoot = path.join(__dirname, "..");
const packagePath = path.join(repoRoot, "package.json");
const releaseDir = path.join(repoRoot, "release");
const targetPath = path.join(
  repoRoot,
  "site",
  "install-web",
  "public",
  "config.js",
);

loadProjectEnv({
  rootDir: repoRoot,
});

function commandExists(command) {
  try {
    execFileSync("which", [command], {
      stdio: "ignore",
    });
    return true;
  } catch (_error) {
    return false;
  }
}

function readPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return String(pkg.version || "").trim() || "0.1.0";
  } catch (_error) {
    return "0.1.0";
  }
}

function readPackageJson() {
  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch (_error) {
    return {};
  }
}

function parseGithubRemote(remoteUrl = "") {
  const normalized = String(remoteUrl).trim();

  let match = normalized.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (match) {
    return {
      owner: match[1],
      repo: match[2],
    };
  }

  match = normalized.match(/^([^/]+)\/([^/.]+)$/);
  if (match) {
    return {
      owner: match[1],
      repo: match[2],
    };
  }

  return null;
}

function readGithubRepo() {
  const owner = String(process.env.JARVIS_GITHUB_OWNER || "").trim();
  const repo = String(process.env.JARVIS_GITHUB_REPO || "").trim();
  const pkg = readPackageJson();

  if (owner && repo) {
    return { owner, repo };
  }

  const packageRepository =
    typeof pkg.repository === "string"
      ? pkg.repository
      : pkg.repository?.url;

  if (packageRepository) {
    const parsedRepository = parseGithubRemote(packageRepository);
    if (parsedRepository) {
      return parsedRepository;
    }
  }

  if (!commandExists("git")) {
    return null;
  }

  try {
    const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return parseGithubRemote(remoteUrl);
  } catch (_error) {
    return null;
  }
}

function buildLegacyDownloads(config) {
  const downloads = [];

  if (config.windowsDownloadUrl) {
    downloads.push({
      platform: "Windows",
      label: "Windows Installer",
      format: ".exe",
      href: config.windowsDownloadUrl,
      channel: "installer",
      architecture: "x64",
      hint: "Windows용 설치 마법사입니다.",
      recommended: true,
      sizeBytes: 0,
    });
  }

  if (config.macDownloadUrl) {
    downloads.push({
      platform: "macOS",
      label: "macOS Installer",
      format: ".dmg",
      href: config.macDownloadUrl,
      channel: "installer",
      architecture: "Apple Silicon",
      hint: "Applications 폴더로 이동해 설치하는 기본 macOS 패키지입니다.",
      recommended: true,
      sizeBytes: 0,
    });
  }

  if (config.linuxDownloadUrl) {
    downloads.push({
      platform: "Linux",
      label: "Linux AppImage",
      format: ".AppImage",
      href: config.linuxDownloadUrl,
      channel: "installer",
      architecture: "x64",
      hint: "바로 실행 가능한 포터블 Linux 패키지입니다.",
      recommended: true,
      sizeBytes: 0,
    });
  }

  return downloads;
}

function buildPlatformSummary(downloads) {
  const platforms = ["macOS", "Windows", "Linux"];

  return platforms.map((platform) => {
    const entries = downloads.filter((item) => item.platform === platform);
    if (entries.length > 0) {
      return {
        platform,
        status: "available",
        message: `${platform}용 기본 다운로드를 지금 바로 시작할 수 있습니다.`,
      };
    }

    return {
      platform,
      status: "pending",
      message: `${platform} 버전은 준비 중입니다. 공개되면 이 페이지에서 바로 시작할 수 있습니다.`,
    };
  });
}

function buildGithubReleaseAssetUrl({ owner, repo, version, filename }) {
  if (!owner || !repo || !version || !filename) {
    return "";
  }

  return `https://github.com/${owner}/${repo}/releases/download/v${version}/${filename}`;
}

function findReleaseAssetFilename(version, patterns) {
  if (!fs.existsSync(releaseDir)) {
    return "";
  }

  const escapedVersion = String(version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  try {
    const entries = fs.readdirSync(releaseDir, {
      withFileTypes: true,
    });

    for (const pattern of patterns) {
      const regex = new RegExp(
        `^Jarvis-Desktop-${escapedVersion}-${pattern}$`,
        "i",
      );
      const match = entries.find(
        (entry) => entry.isFile() && regex.test(entry.name),
      );

      if (match) {
        return match.name;
      }
    }
  } catch (_error) {
    return "";
  }

  return "";
}

async function main() {
  const version = readPackageVersion();
  const githubRepo = readGithubRepo();
  const releaseNotesUrl = String(process.env.NEXT_PUBLIC_JARVIS_RELEASE_NOTES_URL || "").trim();
  const envWindowsDownloadUrl = String(
    process.env.NEXT_PUBLIC_JARVIS_WINDOWS_DOWNLOAD_URL || "",
  ).trim();
  const envMacDownloadUrl = String(
    process.env.NEXT_PUBLIC_JARVIS_MAC_DOWNLOAD_URL || "",
  ).trim();
  const envLinuxDownloadUrl = String(
    process.env.NEXT_PUBLIC_JARVIS_LINUX_DOWNLOAD_URL || "",
  ).trim();
  const owner = githubRepo?.owner || "";
  const repo = githubRepo?.repo || "";
  const macAssetFilename =
    findReleaseAssetFilename(version, ["mac-arm64\\.dmg"]) ||
    `Jarvis-Desktop-${version}-mac-arm64.dmg`;
  const windowsAssetFilename =
    findReleaseAssetFilename(version, ["win-arm64\\.exe", "win-x64\\.exe"]);
  const linuxAssetFilename =
    findReleaseAssetFilename(version, ["linux-arm64\\.AppImage", "linux-x64\\.AppImage"]);
  const normalizedMacDownloadUrl =
    envMacDownloadUrl ||
    buildGithubReleaseAssetUrl({
      owner,
      repo,
      version,
      filename: macAssetFilename,
    });
  const normalizedWindowsDownloadUrl =
    envWindowsDownloadUrl ||
    buildGithubReleaseAssetUrl({
      owner,
      repo,
      version,
      filename: windowsAssetFilename,
    });
  const normalizedLinuxDownloadUrl =
    envLinuxDownloadUrl ||
    buildGithubReleaseAssetUrl({
      owner,
      repo,
      version,
      filename: linuxAssetFilename,
    });
  const config = {
    brandName: "DexProject",
    productName: "Jarvis Desktop",
    siteMode: process.env.NEXT_PUBLIC_JARVIS_SITE_MODE || "download",
    version,
    githubOwner: owner,
    githubRepo: repo,
    windowsDownloadUrl: normalizedWindowsDownloadUrl,
    macDownloadUrl: normalizedMacDownloadUrl,
    linuxDownloadUrl: normalizedLinuxDownloadUrl,
    releaseNotesUrl,
    downloads: [],
    platforms: [],
  };

  config.downloads = buildLegacyDownloads(config);
  config.platforms = buildPlatformSummary(config.downloads);

  const content = `window.JARVIS_INSTALL_CONFIG = ${JSON.stringify(config, null, 2)};\n`;

  await fsp.mkdir(path.dirname(targetPath), {
    recursive: true,
  });
  await fsp.writeFile(targetPath, content, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        target: path.relative(repoRoot, targetPath),
        config,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
