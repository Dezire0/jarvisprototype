const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitForUrl(url, timeoutMs = 120000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        method: "GET"
      });

      if (response.ok) {
        return;
      }

      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await wait(1000);
  }

  throw lastError || new Error(`Timed out waiting for ${url}`);
}

class DesktopUiServer {
  constructor({ app }) {
    this.app = app;
    this.child = null;
    this.url = String(process.env.JARVIS_UI_URL || "").trim();
  }

  getBundledUiRoot() {
    return path.join(process.resourcesPath, "desktop-ui");
  }

  getBundledAppRoot() {
    return path.join(this.getBundledUiRoot(), "templates", "cloud");
  }

  async canStartBundledServer() {
    if (!this.app.isPackaged || this.url) {
      return false;
    }

    return pathExists(path.join(this.getBundledAppRoot(), "server.js"));
  }

  getUrl() {
    return this.url;
  }

  async start() {
    if (this.url) {
      return this.url;
    }

    if (!(await this.canStartBundledServer())) {
      return "";
    }

    const uiRoot = this.getBundledAppRoot();
    const serverEntry = path.join(uiRoot, "server.js");
    const port = Number(process.env.JARVIS_UI_PORT) || await allocatePort();
    const host = "127.0.0.1";
    const targetUrl = `http://${host}:${port}`;

    this.child = spawn(process.execPath, [serverEntry], {
      cwd: uiRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        HOSTNAME: host,
        PORT: String(port),
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8010/assistant"
      },
      stdio: "pipe"
    });

    this.child.stdout.on("data", (chunk) => {
      process.stdout.write(`[desktop-ui] ${chunk}`);
    });
    this.child.stderr.on("data", (chunk) => {
      process.stderr.write(`[desktop-ui] ${chunk}`);
    });
    this.child.once("exit", () => {
      this.child = null;
      this.url = "";
    });

    try {
      await waitForUrl(targetUrl);
      this.url = targetUrl;
      return this.url;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    if (!this.child) {
      return;
    }

    const child = this.child;
    this.child = null;
    this.url = "";

    await new Promise((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5000);
    });
  }
}

module.exports = {
  DesktopUiServer
};
