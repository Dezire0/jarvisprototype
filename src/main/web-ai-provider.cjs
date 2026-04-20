const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");

/**
 * WebAIProvider creates a hidden browser window that loads ChatGPT,
 * allowing the application to use the user's web session instead of an API key.
 * This is highly experimental and subject to breakage if OpenAI changes their DOM.
 */
class WebAIProvider {
  constructor() {
    this.window = null;
    this.isReady = false;
    this.pendingResolvers = [];
  }

  /**
   * Initialize the hidden Web AI window.
   */
  init() {
    if (this.window) return;

    this.window = new BrowserWindow({
      width: 800,
      height: 600,
      show: false, // Hidden by default, can be shown for login
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "web-ai-preload.cjs"),
        partition: "persist:chatgpt" // Keep session isolated but persistent
      }
    });

    this.window.loadURL("https://chatgpt.com");

    this.window.webContents.on("did-finish-load", () => {
      this.isReady = true;
    });

    // Listen for responses scraped by the preload script
    ipcMain.on("web-ai-response", (event, responseText) => {
      if (this.pendingResolvers.length > 0) {
        const resolve = this.pendingResolvers.shift();
        resolve(responseText);
      }
    });
  }

  /**
   * Show the window so the user can log in manually.
   */
  showLoginWindow() {
    if (!this.window) this.init();
    this.window.show();
  }

  /**
   * Hide the window after login.
   */
  hideWindow() {
    if (this.window) this.window.hide();
  }

  /**
   * Send a prompt to the web session and wait for the response.
   * @param {string} prompt 
   * @returns {Promise<string>}
   */
  async chat(prompt) {
    if (!this.window) this.init();

    // Wait until the page is fully loaded
    while (!this.isReady) {
      await new Promise(r => setTimeout(r, 500));
    }

    return new Promise((resolve, reject) => {
      this.pendingResolvers.push(resolve);
      
      // Inject script to type into the textarea and click send
      this.window.webContents.send("web-ai-prompt", prompt);
      
      // Safety timeout
      setTimeout(() => {
        if (this.pendingResolvers.includes(resolve)) {
          this.pendingResolvers = this.pendingResolvers.filter(r => r !== resolve);
          reject(new Error("Web AI response timeout"));
        }
      }, 60000); // 60s timeout
    });
  }
}

module.exports = new WebAIProvider();
