const fs = require("node:fs/promises");
const path = require("node:path");
const { isLocalWorkspacePage } = require("./local-workspace-store.cjs");

const AVAILABLE_WITHOUT_COMPUTER_CONTROL = new Set([
  "popup:show",
  "extensions:list",
  "extensions:reload",
  "system:open-external",
  "ai:web-login",
  "ai:web-logout",
  "ai:web-status",
  "ai:ollama-models"
]);

const COMPUTER_CONTROL_OFF = "Computer control is off. Open Computer control settings to allow this action.";

function isTrustedDesktopFrame(event, window, desktopUrl, legacyUrl) {
  const contents = window?.webContents;
  const frame = event.senderFrame;
  return Boolean(contents && frame && event.sender === contents && frame === contents.mainFrame &&
    (frame.url === legacyUrl || isLocalWorkspacePage(frame.url, desktopUrl)));
}

function requiresComputerControl(tool) {
  return !AVAILABLE_WITHOUT_COMPUTER_CONTROL.has(tool);
}

class ComputerControl {
  #enabled = false;
  #revision = 0;
  #pending = Promise.resolve();

  constructor(directory) {
    this.filePath = path.join(directory, "computer-control.json");
  }

  get enabled() { return this.#enabled; }
  get revision() { return this.#revision; }

  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.#enabled = data?.version === 1 && data.enabled === true;
    } catch {
      // Missing or unreadable consent never grants permission.
      this.#enabled = false;
    }
  }

  async setEnabled(enabled) {
    if (typeof enabled !== "boolean") throw new Error("Choose whether to allow computer control.");
    const mutation = this.#pending.then(async () => {
      if (enabled === this.#enabled) return this.#enabled;
      const temporary = this.filePath + ".tmp";
      await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      await fs.writeFile(temporary, JSON.stringify({ version: 1, enabled }), { mode: 0o600 });
      await fs.rename(temporary, this.filePath);
      this.#enabled = enabled;
      this.#revision++;
      return this.#enabled;
    });
    this.#pending = mutation.catch(() => {});
    return mutation;
  }
}

module.exports = { ComputerControl, COMPUTER_CONTROL_OFF, isTrustedDesktopFrame, requiresComputerControl };
