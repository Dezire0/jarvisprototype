const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { isLocalWorkspacePage } = require("./local-workspace-store.cjs");

const MAX_BYTES = 16 * 1024 * 1024;

function validateSnapshot(serialized) {
  if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > MAX_BYTES) {
    throw new Error("The conversation history exceeds the storage limit.");
  }
  const data = JSON.parse(serialized);
  if (data?.version !== 1 || !Array.isArray(data.threads) || !Array.isArray(data.sidebar?.projects) ||
      !data.sidebar.threadMetaById || typeof data.sidebar.threadMetaById !== "object" ||
      (data.savedMemory !== undefined && typeof data.savedMemory !== "boolean") ||
      (data.allowCloudFallback !== undefined && typeof data.allowCloudFallback !== "boolean") ||
      (data.profile !== undefined &&
        (typeof data.profile?.name !== "string" || data.profile.name.length > 80 ||
          !["auto", "ko", "en"].includes(data.profile.language)))) {
    throw new Error("Invalid conversation history.");
  }
}

class ChatHistoryStore {
  constructor(directory) {
    this.directory = path.join(directory, "chat-history");
    this.pending = Promise.resolve();
  }

  filePath(accountId) {
    if (typeof accountId !== "string" || !accountId.trim() || accountId.length > 256) {
      throw new Error("Invalid conversation profile.");
    }
    const key = createHash("sha256").update(accountId).digest("hex");
    return path.join(this.directory, key + ".json");
  }

  async read(accountId) {
    const file = this.filePath(accountId);
    await this.pending;
    try {
      if ((await fs.stat(file)).size > MAX_BYTES) throw new Error("The conversation history exceeds the storage limit.");
      const serialized = await fs.readFile(file, "utf8");
      validateSnapshot(serialized);
      return serialized;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async write(accountId, serialized) {
    const file = this.filePath(accountId);
    validateSnapshot(serialized);
    const write = this.pending.then(async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(file + ".tmp", serialized, { encoding: "utf8", mode: 0o600 });
      await fs.rename(file + ".tmp", file);
    });
    this.pending = write.catch(() => {});
    await write;
  }
}

function registerChatHistoryHandlers({ ipcMain, getWindow, getDesktopUiUrl, getUserDataDirectory, getActiveAccountId }) {
  let store;
  function trustedStore(event, accountId) {
    const contents = getWindow()?.webContents;
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame ||
        !isLocalWorkspacePage(event.senderFrame?.url, getDesktopUiUrl()) ||
        new URL(event.senderFrame.url).pathname !== "/") {
      throw new Error("Conversation history requires the desktop chat window.");
    }
    if (!accountId || accountId !== getActiveAccountId()) {
      throw new Error("Conversation history requires the active account.");
    }
    return store ||= new ChatHistoryStore(getUserDataDirectory());
  }

  ipcMain.handle("assistant:load-chat-history", (event, accountId) => trustedStore(event, accountId).read(accountId));
  ipcMain.handle("assistant:save-chat-history", (event, accountId, serialized) => trustedStore(event, accountId).write(accountId, serialized));
}

module.exports = { ChatHistoryStore, registerChatHistoryHandlers };
