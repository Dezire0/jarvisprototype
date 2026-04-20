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
      architecture: "ARM64",
      hint: "Windows ARM64용 설치 마법사입니다.",
      recommended: true,
      sizeBytes: 0,
      version: config.version,
      isFallback: false,
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
      version: config.version,
      isFallback: false,
    });
  }

  if (config.linuxDownloadUrl) {
    downloads.push({
      platform: "Linux",
      label: "Linux AppImage",
      format: ".AppImage",
      href: config.linuxDownloadUrl,
      channel: "installer",
      architecture: "ARM64",
      hint: "바로 실행 가능한 포터블 Linux ARM64 패키지입니다.",
      recommended: true,
      sizeBytes: 0,
      version: config.version,
      isFallback: false,
    });
  }

  return downloads;
}

function buildPlatformSummary(downloads, currentVersion) {
  const platforms = ["macOS", "Windows", "Linux"];

  return platforms.map((platform) => {
    const entries = downloads.filter((item) => item.platform === platform && item.href);
    const primary =
      entries.find((item) => item.recommended) ||
      entries[0] ||
      null;

    if (primary) {
      const downloadVersion = String(primary.version || currentVersion).trim() || currentVersion;
      const isFallback = downloadVersion !== currentVersion;

      return {
        platform,
        status: "available",
        version: downloadVersion,
        isFallback,
        message: isFallback
          ? `${platform} 최신 빌드는 아직 없지만 v${downloadVersion} 설치 파일을 바로 받을 수 있습니다.`
          : `${platform}용 기본 다운로드를 지금 바로 시작할 수 있습니다.`,
      };
    }

    return {
      platform,
      status: "pending",
      version: "",
      isFallback: false,
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

function normalizeReleaseVersion(tagName = "") {
  return String(tagName || "").trim().replace(/^v/i, "");
}

function inferArchitectureLabel(filename = "", fallback = "") {
  const normalized = String(filename || "").toLowerCase();

  if (normalized.includes("mac-arm64")) {
    return "Apple Silicon";
  }

  if (normalized.includes("x64")) {
    return "x64";
  }

  if (normalized.includes("arm64")) {
    return "ARM64";
  }

  return fallback;
}

function compileAssetPatterns(patterns = []) {
  return patterns.map((pattern) => new RegExp(`^Jarvis-Desktop-[0-9]+(?:\\.[0-9]+)+-${pattern}$`, "i"));
}

async function fetchGithubReleases({ owner, repo }) {
  if (!owner || !repo) {
    return [];
  }

  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/releases`);
  url.searchParams.set("per_page", "20");

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "jarvis-install-site-sync",
  };
  const token =
    String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.JARVIS_GITHUB_TOKEN || "").trim();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GitHub releases fetch failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return Array.isArray(payload)
    ? payload.filter((release) => release && !release.draft && !release.prerelease)
    : [];
}

function findGithubReleaseAsset({ releases, preferredVersion, patterns }) {
  const matchers = compileAssetPatterns(patterns);
  const findInRelease = (release) => {
    const assets = Array.isArray(release?.assets)
      ? release.assets.filter((asset) => asset && asset.state === "uploaded")
      : [];

    for (const matcher of matchers) {
      const match = assets.find((asset) => matcher.test(String(asset.name || "")));
      if (match) {
        return match;
      }
    }

    return null;
  };

  const normalizedPreferredVersion = normalizeReleaseVersion(preferredVersion);

  if (!normalizedPreferredVersion) {
    return null;
  }

  const preferredRelease = releases.find(
    (release) => normalizeReleaseVersion(release.tag_name) === normalizedPreferredVersion,
  );
  const preferredAsset = findInRelease(preferredRelease);

  if (preferredAsset) {
    return {
      release: preferredRelease,
      asset: preferredAsset,
    };
  }

  for (const release of releases) {
    const fallbackAsset = findInRelease(release);

    if (fallbackAsset) {
      return {
        release,
        asset: fallbackAsset,
      };
    }
  }

  return null;
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

function buildDownloadRecord({
  platform,
  label,
  format,
  href,
  filename,
  version,
  hint,
  recommended,
  architecture,
  currentVersion,
}) {
  const normalizedVersion = String(version || currentVersion || "").trim();

  return {
    platform,
    label,
    format,
    href,
    channel: "installer",
    architecture: inferArchitectureLabel(filename, architecture),
    hint,
    recommended: Boolean(recommended),
    sizeBytes: 0,
    version: normalizedVersion,
    isFallback: Boolean(normalizedVersion && currentVersion && normalizedVersion !== currentVersion),
  };
}

function resolveEnvDownload(url, definition, currentVersion) {
  if (!url) {
    return null;
  }

  const filename = (() => {
    try {
      const parsed = new URL(url);
      return parsed.pathname.split("/").pop() || "";
    } catch (_error) {
      return "";
    }
  })();

  return buildDownloadRecord({
    ...definition,
    href: url,
    filename,
    version: currentVersion,
    currentVersion,
  });
}

function resolveLocalGithubDownload({ owner, repo, currentVersion, definition }) {
  const filename = findReleaseAssetFilename(currentVersion, definition.patterns);

  if (!owner || !repo || !filename) {
    return null;
  }

  return buildDownloadRecord({
    ...definition,
    href: buildGithubReleaseAssetUrl({
      owner,
      repo,
      version: currentVersion,
      filename,
    }),
    filename,
    version: currentVersion,
    currentVersion,
  });
}

function resolveGithubReleaseDownload({ owner, repo, currentVersion, releases, definition }) {
  const match = findGithubReleaseAsset({
    releases,
    preferredVersion: currentVersion,
    patterns: definition.patterns,
  });

  if (!match) {
    return null;
  }

  const assetUrl =
    String(match.asset.browser_download_url || match.asset.url || "").trim() ||
    buildGithubReleaseAssetUrl({
      owner,
      repo,
      version: normalizeReleaseVersion(match.release.tag_name),
      filename: match.asset.name,
    });

  if (!assetUrl) {
    return null;
  }

  return buildDownloadRecord({
    ...definition,
    href: assetUrl,
    filename: match.asset.name,
    version: normalizeReleaseVersion(match.release.tag_name),
    currentVersion,
  });
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
  let githubReleases = [];

  if (owner && repo) {
    try {
      githubReleases = await fetchGithubReleases({
        owner,
        repo,
      });
    } catch (error) {
      console.warn(`Could not fetch GitHub releases for install site sync: ${error.message}`);
    }
  }

  const platformDefinitions = [
    {
      platform: "Windows",
      label: "Windows Installer",
      format: ".exe",
      patterns: ["win-x64\\.exe", "win-arm64\\.exe"],
      architecture: "x64",
      hint: "Windows 설치 마법사입니다.",
      recommended: true,
      envUrl: envWindowsDownloadUrl,
    },
    {
      platform: "macOS",
      label: "macOS Installer",
      format: ".dmg",
      patterns: ["mac-arm64\\.dmg", "mac-x64\\.dmg"],
      architecture: "Apple Silicon",
      hint: "Applications 폴더로 이동해 설치하는 기본 macOS 패키지입니다.",
      recommended: true,
      envUrl: envMacDownloadUrl,
    },
    {
      platform: "Linux",
      label: "Linux AppImage",
      format: ".AppImage",
      patterns: ["linux-x64\\.AppImage", "linux-arm64\\.AppImage"],
      architecture: "x64",
      hint: "바로 실행 가능한 포터블 Linux 패키지입니다.",
      recommended: true,
      envUrl: envLinuxDownloadUrl,
    },
    {
      platform: "Linux",
      label: "Linux DEB",
      format: ".deb",
      patterns: ["linux-x64\\.deb", "linux-arm64\\.deb"],
      architecture: "x64",
      hint: "Debian/Ubuntu 계열에서 설치할 수 있는 Linux 패키지입니다.",
      recommended: false,
      envUrl: "",
    },
  ];

  const downloads = platformDefinitions
    .map((definition) => {
      return (
        resolveEnvDownload(definition.envUrl, definition, version) ||
        resolveGithubReleaseDownload({
          owner,
          repo,
          currentVersion: version,
          releases: githubReleases,
          definition,
        }) ||
        resolveLocalGithubDownload({
          owner,
          repo,
          currentVersion: version,
          definition,
        })
      );
    })
    .filter(Boolean);

  const primaryWindowsDownload =
    downloads.find((item) => item.platform === "Windows" && item.recommended) ||
    downloads.find((item) => item.platform === "Windows") ||
    null;
  const primaryMacDownload =
    downloads.find((item) => item.platform === "macOS" && item.recommended) ||
    downloads.find((item) => item.platform === "macOS") ||
    null;
  const primaryLinuxDownload =
    downloads.find((item) => item.platform === "Linux" && item.recommended) ||
    downloads.find((item) => item.platform === "Linux") ||
    null;

  const config = {
    brandName: "DexProject",
    productName: "Jarvis Desktop",
    siteMode: process.env.NEXT_PUBLIC_JARVIS_SITE_MODE || "download",
    version,
    githubOwner: owner,
    githubRepo: repo,
    windowsDownloadUrl: primaryWindowsDownload?.href || "",
    macDownloadUrl: primaryMacDownload?.href || "",
    linuxDownloadUrl: primaryLinuxDownload?.href || "",
    releaseNotesUrl,
    downloads,
    platforms: [],
  };

  if (!config.downloads.length) {
    config.downloads = buildLegacyDownloads(config);
  }

  config.platforms = buildPlatformSummary(config.downloads, version);

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
