const fs = require("node:fs/promises");
const path = require("node:path");
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

class UpdaterService {
  constructor({ app }) {
    this.app = app;
    this.enabled = false;
    this.lastTrigger = "startup";
    this.pendingCheck = null;
    this.status = {
      state: "idle",
      message: "",
      version: app.getVersion(),
      availableVersion: "",
      downloadedVersion: "",
      progressPercent: 0,
      enabled: false
    };
  }

  async init() {
    if (!autoUpdater || !this.app.isPackaged) {
      this.updateStatus({
        state: "disabled",
        message: this.app.isPackaged ? "Updater dependency is unavailable." : "Auto updates are only enabled in packaged builds."
      });
      return;
    }

    const updateConfigPath = path.join(process.resourcesPath, "app-update.yml");

    if (!(await pathExists(updateConfigPath))) {
      this.updateStatus({
        state: "disabled",
        message: "No update feed is configured for this build."
      });
      return;
    }

    this.enabled = true;
    this.updateStatus({
      state: "idle",
      message: "Ready to check for updates."
    });

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
      this.updateStatus({
        state: "checking",
        message: "Checking for updates..."
      });
    });

    autoUpdater.on("update-available", (info) => {
      this.updateStatus({
        state: "available",
        message: `Downloading ${info.version}...`,
        availableVersion: info.version || ""
      });
    });

    autoUpdater.on("update-not-available", () => {
      this.updateStatus({
        state: "idle",
        message: "You are on the latest version.",
        progressPercent: 0
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
      this.updateStatus({
        state: "downloading",
        message: `Downloading update... ${Math.round(progress.percent || 0)}%`,
        progressPercent: Number(progress.percent || 0)
      });
    });

    autoUpdater.on("update-downloaded", async (info) => {
      this.updateStatus({
        state: "downloaded",
        message: `Version ${info.version || ""} is ready to install.`,
        downloadedVersion: info.version || "",
        progressPercent: 100
      });

      const result = await dialog.showMessageBox({
        type: "info",
        title: "Update Ready",
        message: "A new version of Jarvis Desktop has been downloaded.",
        detail: "Restart now to install the update, or choose Later to install it on the next quit.",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
        cancelId: 1
      }).catch(() => null);

      if (result?.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });

    autoUpdater.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);

      this.updateStatus({
        state: "error",
        message
      });

      if (this.lastTrigger === "manual") {
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

  getStatus() {
    return {
      ...this.status,
      version: this.app.getVersion(),
      enabled: this.enabled
    };
  }

  async checkForUpdates(trigger = "manual") {
    this.lastTrigger = trigger;

    if (!this.enabled || !autoUpdater) {
      return this.getStatus();
    }

    if (this.pendingCheck) {
      return this.pendingCheck;
    }

    this.pendingCheck = autoUpdater.checkForUpdates()
      .then(() => this.getStatus())
      .finally(() => {
        this.pendingCheck = null;
      });

    return this.pendingCheck;
  }
}

module.exports = {
  UpdaterService
};
