const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_WORKSPACE_BYTES = 1024 * 1024;

class LocalWorkspaceStore {
  constructor(userDataDirectory) {
    this.filePath = path.join(userDataDirectory, "local-workspace.json");
    this.pendingWrite = Promise.resolve();
  }

  async read() {
    await this.pendingWrite;
    try {
      return await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async write(serialized) {
    if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > MAX_WORKSPACE_BYTES) {
      throw new Error("Invalid workspace data size.");
    }
    const data = JSON.parse(serialized);
    if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.notes) || !data.timer || typeof data.timer !== "object") {
      throw new Error("Invalid workspace data.");
    }

    const write = this.pendingWrite.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = this.filePath + ".tmp";
      await fs.writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporaryPath, this.filePath);
    });
    this.pendingWrite = write.catch(() => {});
    await write;
  }
}

function isLocalWorkspacePage(frameUrl, applicationUrl) {
  if (!applicationUrl) return false;
  try {
    const source = new URL(frameUrl);
    const expectedOrigin = new URL(applicationUrl).origin;
    return source.origin === expectedOrigin &&
      (source.protocol === "http:" || source.protocol === "https:") &&
      ["127.0.0.1", "localhost", "[::1]"].includes(source.hostname) &&
      source.pathname === "/tools";
  } catch {
    return false;
  }
}

function registerLocalWorkspaceHandlers({ ipcMain, getWindow, getDesktopUiUrl, getUserDataDirectory }) {
  let store;
  function trustedStore(event) {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !isLocalWorkspacePage(event.senderFrame.url, getDesktopUiUrl())
    ) {
      throw new Error("The workspace is only available in the desktop tools window.");
    }
    store ||= new LocalWorkspaceStore(getUserDataDirectory());
    return store;
  }

  ipcMain.handle("assistant:load-local-workspace", (event) => trustedStore(event).read());
  ipcMain.handle("assistant:save-local-workspace", (event, serialized) => trustedStore(event).write(serialized));
}

module.exports = { LocalWorkspaceStore, isLocalWorkspacePage, registerLocalWorkspaceHandlers };
