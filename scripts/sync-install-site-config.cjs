const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { loadProjectEnv } = require("../src/main/project-env.cjs");

const repoRoot = path.join(__dirname, "..");
const packagePath = path.join(repoRoot, "package.json");
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

  if (owner && repo) {
    return { owner, repo };
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
      downloadCount: 0,
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
      downloadCount: 0,
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
      downloadCount: 0,
    });
  }

  return downloads;
}

function buildDownloadFromAsset(asset) {
  const name = String(asset.name || "").trim();

  if (
    !name ||
    name.endsWith(".blockmap") ||
    name.endsWith(".yml") ||
    name.endsWith(".yaml")
  ) {
    return null;
  }

  let platform = "";
  if (/-(mac)-/i.test(name)) {
    platform = "macOS";
  } else if (/-(win)-/i.test(name)) {
    platform = "Windows";
  } else if (/-(linux)-/i.test(name)) {
    platform = "Linux";
  } else {
    return null;
  }

  const format = path.extname(name) || "";
  const lowerName = name.toLowerCase();
  const architecture = lowerName.includes("arm64")
    ? "arm64"
    : lowerName.includes("x64")
      ? "x64"
      : platform === "macOS"
        ? "Apple Silicon"
        : "default";

  let label = `${platform} Download`;
  let channel = "installer";
  let hint = "최신 공개 배포 자산입니다.";
  let recommended = false;

  if (platform === "macOS" && format === ".dmg") {
    label = "macOS Installer";
    hint = "Applications 폴더로 이동해 설치하는 기본 macOS 패키지입니다.";
    recommended = true;
  } else if (platform === "macOS" && format === ".zip") {
    label = "macOS Archive";
    channel = "archive";
    hint = "수동 배포나 보관용 zip 아카이브입니다.";
  } else if (platform === "Windows" && format === ".exe") {
    label = "Windows Installer";
    hint = "NSIS 기반 Windows 설치 마법사입니다.";
    recommended = true;
  } else if (platform === "Linux" && format === ".AppImage") {
    label = "Linux AppImage";
    hint = "대부분의 배포판에서 바로 실행 가능한 휴대용 빌드입니다.";
    recommended = true;
  } else if (platform === "Linux" && format === ".deb") {
    label = "Linux .deb Package";
    channel = "package";
    hint = "Debian/Ubuntu 계열용 패키지입니다.";
  } else {
    channel = "package";
    hint = `${platform}용 ${format || "package"} 배포 자산입니다.`;
  }

  return {
    platform,
    label,
    format,
    href: String(asset.url || "").trim(),
    channel,
    architecture,
    hint,
    recommended,
    sizeBytes: Number(asset.size || 0),
    downloadCount: Number(asset.downloadCount || 0),
  };
}

function readGithubRelease(config) {
  if (!commandExists("gh") || !config.githubOwner || !config.githubRepo) {
    return null;
  }

  try {
    const tagName = `v${config.version}`;
    const output = execFileSync(
      "gh",
      [
        "release",
        "view",
        tagName,
        "-R",
        `${config.githubOwner}/${config.githubRepo}`,
        "--json",
        "tagName,assets,url",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const parsed = JSON.parse(output);
    const downloads = Array.isArray(parsed.assets)
      ? parsed.assets.map(buildDownloadFromAsset).filter(Boolean)
      : [];

    return {
      releaseNotesUrl: String(parsed.url || "").trim(),
      downloads,
    };
  } catch (_error) {
    return null;
  }
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

async function main() {
  const version = readPackageVersion();
  const githubRepo = readGithubRepo();
  const releaseNotesUrl = String(process.env.NEXT_PUBLIC_JARVIS_RELEASE_NOTES_URL || "").trim();
  const config = {
    brandName: "DexProject",
    productName: "Jarvis Desktop",
    siteMode: process.env.NEXT_PUBLIC_JARVIS_SITE_MODE || "download",
    version,
    githubOwner: githubRepo?.owner || "",
    githubRepo: githubRepo?.repo || "",
    windowsDownloadUrl: String(process.env.NEXT_PUBLIC_JARVIS_WINDOWS_DOWNLOAD_URL || "").trim(),
    macDownloadUrl: String(process.env.NEXT_PUBLIC_JARVIS_MAC_DOWNLOAD_URL || "").trim(),
    linuxDownloadUrl: String(process.env.NEXT_PUBLIC_JARVIS_LINUX_DOWNLOAD_URL || "").trim(),
    releaseNotesUrl,
    downloads: [],
    platforms: [],
    generatedAt: new Date().toISOString(),
  };

  const githubRelease = readGithubRelease(config);
  config.downloads =
    githubRelease?.downloads?.length > 0
      ? githubRelease.downloads
      : buildLegacyDownloads(config);

  if (githubRelease?.releaseNotesUrl) {
    config.releaseNotesUrl = githubRelease.releaseNotesUrl;
  }

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
