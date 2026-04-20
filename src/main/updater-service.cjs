const fs = require("node:fs/promises");
const fsStream = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { BrowserWindow, dialog } = require("electron");

let autoUpdater = null;

try {
  ({ autoUpdater } = require("electron-updater"));
} catch (_error) {
  autoUpdater = null;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function compareVersions(left, right) {
  const leftParts = normalizeVersion(left)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number(part) || 0);
  const rightParts = normalizeVersion(right)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number(part) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;

    if (leftValue > rightValue) {
      return 1;
    }

    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

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

function readPackageMetadata() {
  try {
    return require(path.join(__dirname, "..", "..", "package.json"));
  } catch (_error) {
    return {};
  }
}

function readGithubRepoFromPackage() {
  const pkg = readPackageMetadata();
  const repository = pkg.repository;

  if (!repository) {
    return null;
  }

  if (typeof repository === "string") {
    return parseGithubRepo(repository);
  }

  return parseGithubRepo(repository.url);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Jarvis-Desktop-Updater"
        }
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(`Release check failed with status ${response.statusCode}.`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(12_000, () => {
      request.destroy(new Error("Release check timed out."));
    });
    request.end();
  });
}

function chooseGithubAsset(assets = []) {
  const platform = process.platform;
  const architecture = process.arch;
  const candidates = Array.isArray(assets) ? assets : [];
  let bestAsset = null;
  let bestScore = -1;

  for (const asset of candidates) {
    const name = String(asset?.name || "").toLowerCase();
    let score = -1;

    if (platform === "darwin") {
      if (name.endsWith(".dmg")) {
        score = 90;
      } else if (name.endsWith(".zip")) {
        score = 75;
      }

      if (name.includes("mac-arm64") && architecture === "arm64") {
        score += 30;
      } else if (name.includes("mac-x64") && architecture === "x64") {
        score += 30;
      } else if (name.includes("-mac-")) {
        score += 12;
      }
    } else if (platform === "win32") {
      if (name.endsWith(".exe")) {
        score = 95;
      }

      if (name.includes("win-x64") && architecture === "x64") {
        score += 25;
      } else if (name.includes("win-arm64") && architecture === "arm64") {
        score += 25;
      }
    } else if (platform === "linux") {
      if (name.endsWith(".appimage")) {
        score = 92;
      } else if (name.endsWith(".deb")) {
        score = 82;
      }

      if (name.includes("linux-x64") && architecture === "x64") {
        score += 20;
      } else if (name.includes("linux-arm64") && architecture === "arm64") {
        score += 20;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestAsset = asset;
    }
  }

  return bestScore >= 0 ? bestAsset : null;
}

function getInstallerFallbackName(version) {
  const safeVersion = normalizeVersion(version) || "latest";
  const extension = process.platform === "darwin"
    ? ".dmg"
    : process.platform === "linux"
      ? ".AppImage"
      : ".exe";

  return `Jarvis-Desktop-${safeVersion}${extension}`;
}

function getDownloadFileName(downloadUrl, version) {
  try {
    const candidate = path.basename(new URL(downloadUrl).pathname);

    if (candidate && candidate !== "/" && candidate !== "." && candidate !== "..") {
      return candidate;
    }
  } catch (_error) {
    // Fall back to a safe default name below.
  }

  return getInstallerFallbackName(version);
}

async function downloadUrlToFile(downloadUrl, targetPath, onProgress = null, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error("Too many download redirects.");
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const response = await new Promise((resolve, reject) => {
    const request = https.request(
      downloadUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": "Jarvis-Desktop-Updater"
        }
      },
      (incoming) => {
        const statusCode = incoming.statusCode || 0;

        if (statusCode >= 300 && statusCode < 400 && incoming.headers.location) {
          const nextUrl = new URL(incoming.headers.location, downloadUrl).toString();
          incoming.resume();
          resolve({ redirectUrl: nextUrl });
          return;
        }

        if (statusCode >= 400) {
          incoming.resume();
          reject(new Error(`Download failed with status ${statusCode}.`));
          return;
        }

        resolve({
          stream: incoming,
          totalBytes: Number(incoming.headers["content-length"] || 0)
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(15_000, () => request.destroy(new Error("Download timed out.")));
    request.end();
  });

  if (response.redirectUrl) {
    return downloadUrlToFile(response.redirectUrl, targetPath, onProgress, redirectCount + 1);
  }

  let downloadedBytes = 0;
  const progressStream = new Transform({
    transform(chunk, _encoding, callback) {
      downloadedBytes += chunk.length;

      if (onProgress) {
        onProgress(downloadedBytes, response.totalBytes || 0);
      }

      callback(null, chunk);
    }
  });

  await pipeline(response.stream, progressStream, fsStream.createWriteStream(targetPath));
  return targetPath;
}

class UpdaterService {
  constructor({ app }) {
    this.app = app;
    this.enabled = false;
    this.nativeUpdaterEnabled = false;
    this.installerFallbackEnabled = false;
    this.fallbackConfig = null;
    this.lastTrigger = "startup";
    this.pendingCheck = null;
    this.status = {
      state: "idle",
      message: "",
      version: app.getVersion(),
      availableVersion: "",
      downloadedVersion: "",
      progressPercent: 0,
      remainingSeconds: 0,
      enabled: false,
      mode: "disabled",
      downloadUrl: "",
      downloadPath: "",
      releasePageUrl: ""
    };
  }

  async init() {
    this.fallbackConfig = this.readFallbackConfig();
    this.installerFallbackEnabled = Boolean(this.fallbackConfig);

    if (!this.app.isPackaged) {
      if (this.installerFallbackEnabled) {
        this.enabled = true;
        this.updateStatus({
          state: "idle",
          message: "Ready to check for new installer releases.",
          mode: "installer",
          releasePageUrl: this.fallbackConfig.releaseNotesUrl
        });
        return;
      }

      this.updateStatus({
        state: "disabled",
        message: "Auto updates are only enabled in packaged builds.",
        mode: "disabled"
      });
      return;
    }

    if (autoUpdater) {
      const updateConfigPath = path.join(process.resourcesPath, "app-update.yml");
      if (await pathExists(updateConfigPath)) {
        this.nativeUpdaterEnabled = true;
        this.enabled = true;
        this.installNativeUpdaterHandlers();
        this.updateStatus({
          state: "idle",
          message: "Ready to check for updates.",
          mode: "native",
          releasePageUrl: this.fallbackConfig?.releaseNotesUrl || ""
        });
        return;
      }
    }

    if (this.installerFallbackEnabled) {
      this.enabled = true;
      this.updateStatus({
        state: "idle",
        message: "Ready to check for new installer releases.",
        mode: "installer",
        releasePageUrl: this.fallbackConfig.releaseNotesUrl
      });
      return;
    }

    this.updateStatus({
      state: "disabled",
      message: autoUpdater
        ? "No update feed is configured for this build."
        : "Updater dependency is unavailable.",
      mode: "disabled"
    });
  }

  readFallbackConfig() {
    const envOwner = String(process.env.JARVIS_GITHUB_OWNER || "").trim();
    const envRepo = String(process.env.JARVIS_GITHUB_REPO || "").trim();
    const packageRepo = readGithubRepoFromPackage();
    const owner = envOwner || packageRepo?.owner || "";
    const repo = envRepo || packageRepo?.repo || "";

    if (!owner || !repo) {
      return null;
    }

    return {
      owner,
      repo,
      releaseApiUrl: `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
      releaseNotesUrl: `https://github.com/${owner}/${repo}/releases`
    };
  }

  installNativeUpdaterHandlers() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
      this.updateStatus({
        state: "checking",
        message: "Checking for updates...",
        mode: "native"
      });
    });

    autoUpdater.on("update-available", (info) => {
      this.updateStatus({
        state: "available",
        message: "New update is available.",
        availableVersion: info.version || "",
        progressPercent: 0,
        remainingSeconds: 0,
        mode: "native"
      });
    });

    autoUpdater.on("update-not-available", () => {
      this.updateStatus({
        state: "idle",
        message: "You are on the latest version.",
        progressPercent: 0,
        availableVersion: "",
        downloadedVersion: "",
        downloadUrl: "",
        mode: "native"
      });

      if (this.lastTrigger === "manual") {
        dialog.showMessageBox({
          type: "info",
          title: "Jarvis Desktop",
          message: "You are already on the latest version."
        }).catch(() => {});
      }
    });

    autoUpdater.on("download-progress", (progress) => {
      const percent = Number(progress.percent || 0);
      const etaSeconds = Number(progress.eta || 0);

      this.updateStatus({
        state: "downloading",
        message: "Downloading the latest update...",
        progressPercent: percent,
        remainingSeconds: etaSeconds,
        mode: "native"
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      this.updateStatus({
        state: "downloaded",
        message: "Update is ready to install.",
        downloadedVersion: info.version || "",
        progressPercent: 100,
        remainingSeconds: 0,
        mode: "native"
      });
    });

    autoUpdater.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);

      this.updateStatus({
        state: "error",
        message,
        mode: "native"
      });

      if (this.lastTrigger === "manual" && !this.installerFallbackEnabled) {
        dialog.showMessageBox({
          type: "error",
          title: "Update Error",
          message: "Jarvis Desktop could not complete the update check.",
          detail: message
        }).catch(() => {});
      }
    });
  }

  updateStatus(patch = {}) {
    this.status = {
      ...this.status,
      ...patch,
      version: this.app.getVersion(),
      enabled: this.enabled
    };

    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("assistant:update-status", this.status);
    }
  }

  async downloadInstallerAsset({ version, downloadUrl }) {
    if (!downloadUrl) {
      return {
        ok: false,
        message: "No downloadable installer asset was found."
      };
    }

    const targetPath = path.join(this.app.getPath("downloads"), getDownloadFileName(downloadUrl, version));

    this.updateStatus({
      state: "downloading",
      message: "Downloading the latest update...",
      availableVersion: version || "",
      downloadedVersion: "",
      progressPercent: 0,
      remainingSeconds: 0,
      downloadUrl,
      downloadPath: "",
      mode: "installer"
    });

    try {
      await downloadUrlToFile(downloadUrl, targetPath, (downloadedBytes, totalBytes) => {
        const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;

        this.updateStatus({
          state: "downloading",
          message: totalBytes > 0
            ? `Downloading the latest update... ${percent}%`
            : "Downloading the latest update...",
          availableVersion: version || "",
          downloadedVersion: "",
          progressPercent: percent,
          remainingSeconds: 0,
          downloadUrl,
          downloadPath: "",
          mode: "installer"
        });
      });

      this.updateStatus({
        state: "downloaded",
        message: "Update is ready to install.",
        availableVersion: version || "",
        downloadedVersion: version || "",
        progressPercent: 100,
        remainingSeconds: 0,
        downloadUrl,
        downloadPath: targetPath,
        mode: "installer"
      });

      return {
        ok: true,
        mode: "installer",
        targetPath
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.updateStatus({
        state: "error",
        message: `Could not download the update: ${message}`,
        downloadUrl,
        downloadPath: "",
        mode: "installer"
      });

      return {
        ok: false,
        message
      };
    }
  }

  getStatus() {
    return {
      ...this.status,
      version: this.app.getVersion(),
      enabled: this.enabled
    };
  }

  async openInstallerReleasePrompt({ version, asset }) {
    const downloadUrl = asset?.browser_download_url || "";
    const result = await dialog.showMessageBox({
      type: "info",
      title: "New update is available",
      message: `Jarvis Desktop ${version} is available.`,
      detail: asset?.name
        ? `Download ${asset.name} directly to your Downloads folder.`
        : "Download the installer directly to your Downloads folder.",
      buttons: ["Download now", "Later"],
      defaultId: 0,
      cancelId: 1
    }).catch(() => null);

    if (result?.response === 0) {
      const downloadResult = await this.downloadInstallerAsset({
        version,
        downloadUrl
      });

      if (!downloadResult.ok) {
        dialog.showMessageBox({
          type: "error",
          title: "Update Error",
          message: "Jarvis Desktop could not download the installer.",
          detail: downloadResult.message
        }).catch(() => {});
      }
    }
  }

  async checkInstallerRelease(trigger = "manual", nativeError = null) {
    if (!this.installerFallbackEnabled || !this.fallbackConfig) {
      return this.getStatus();
    }

    this.updateStatus({
      state: "checking",
      message: nativeError ? "Checking for new update..." : "Checking for new update...",
      mode: "installer",
      releasePageUrl: this.fallbackConfig.releaseNotesUrl
    });

    try {
      const release = await fetchJson(this.fallbackConfig.releaseApiUrl);
      const latestVersion = normalizeVersion(release.tag_name || release.name || "");

      if (!latestVersion) {
        throw new Error("The latest release does not have a usable version tag.");
      }

      if (compareVersions(latestVersion, this.app.getVersion()) <= 0) {
        this.updateStatus({
          state: "idle",
          message: "You are on the latest version.",
          availableVersion: "",
          downloadedVersion: "",
          progressPercent: 0,
          remainingSeconds: 0,
          downloadUrl: "",
          downloadPath: "",
          releasePageUrl: this.fallbackConfig.releaseNotesUrl,
          mode: "installer"
        });

        if (trigger === "manual") {
          dialog.showMessageBox({
            type: "info",
            title: "Jarvis Desktop",
            message: "You are already on the latest version."
          }).catch(() => {});
        }

        return this.getStatus();
      }

      const asset = chooseGithubAsset(release.assets);
      const downloadUrl = String(asset?.browser_download_url || "").trim();

      this.updateStatus({
        state: "available",
        message: "New update is available.",
        availableVersion: latestVersion,
        progressPercent: 0,
        remainingSeconds: 0,
        downloadUrl,
        downloadPath: "",
        releasePageUrl: this.fallbackConfig.releaseNotesUrl,
        mode: "installer"
      });

      if (asset && downloadUrl) {
        await this.openInstallerReleasePrompt({
          version: latestVersion,
          asset
        });
      } else if (trigger === "manual") {
        dialog.showMessageBox({
          type: "info",
          title: "New update is available",
          message: `Jarvis Desktop ${latestVersion} is available.`,
          detail: "No direct installer asset was found, so there is nothing to download here."
        }).catch(() => {});
      }

      return this.getStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.updateStatus({
        state: "error",
        message,
        mode: "installer",
        releasePageUrl: this.fallbackConfig.releaseNotesUrl
      });

      if (trigger === "manual") {
        dialog.showMessageBox({
          type: "error",
          title: "Update Error",
          message: "Jarvis Desktop could not reach the latest release.",
          detail: message
        }).catch(() => {});
      }

      return this.getStatus();
    }
  }

  async installUpdate() {
    if (this.nativeUpdaterEnabled && autoUpdater && this.status.state === "downloaded") {
      autoUpdater.quitAndInstall();
      return {
        ok: true,
        mode: "native"
      };
    }

    if (this.installerFallbackEnabled) {
      if (this.status.state === "downloaded" && this.status.downloadPath) {
        return {
          ok: true,
          mode: "installer",
          targetPath: this.status.downloadPath
        };
      }

      const downloadUrl = this.status.downloadUrl || "";

      if (downloadUrl) {
        return this.downloadInstallerAsset({
          version: this.status.availableVersion || this.status.downloadedVersion || this.status.version,
          downloadUrl
        });
      }
    }

    return {
      ok: false,
      message: "No downloaded update is available yet."
    };
  }

  async checkForUpdates(trigger = "manual") {
    this.lastTrigger = trigger;

    if (!this.enabled) {
      return this.getStatus();
    }

    if (this.pendingCheck) {
      return this.pendingCheck;
    }

    this.pendingCheck = (async () => {
      if (this.nativeUpdaterEnabled && autoUpdater) {
        try {
          await autoUpdater.checkForUpdates();
          return this.getStatus();
        } catch (error) {
          if (this.installerFallbackEnabled) {
            return this.checkInstallerRelease(trigger, error);
          }

          throw error;
        }
      }

      if (this.installerFallbackEnabled) {
        return this.checkInstallerRelease(trigger);
      }

      return this.getStatus();
    })().finally(() => {
      this.pendingCheck = null;
    });

    return this.pendingCheck;
  }
}

module.exports = {
  UpdaterService
};
