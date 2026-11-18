const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: sleep } = require("node:timers/promises");
const {
  createDesktopSessionToken,
  desktopUiProof,
  isDesktopSessionToken,
  matchesDesktopToken
} = require("./desktop-session.cjs");

const HOST = "127.0.0.1";

function allocatePort(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(preferredPort, HOST, () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForDesktopUi(url, token, signal) {
  const deadline = Date.now() + 120000;
  const challenge = createDesktopSessionToken();
  const expectedProof = desktopUiProof(token, challenge);

  while (!signal.aborted && Date.now() < deadline) {
    try {
      const response = await fetch(url + "/api/chat?challenge=" + challenge, {
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(2500)])
      });
      if (response.status === 204 && matchesDesktopToken(expectedProof, response.headers.get("x-jarvis-ui-proof"))) {
        return;
      }
      await response.body?.cancel();
    } catch {
      // The child may still be starting or compiling the route.
    }
    if (!signal.aborted) await sleep(250, undefined, { signal });
  }

  throw new Error("The desktop UI did not establish its session.");
}

class DesktopUiServer {
  constructor({ app, sessionToken, transportUrl, resourcesPath = process.resourcesPath }) {
    if (!isDesktopSessionToken(sessionToken)) throw new Error("A desktop session token is required.");
    this.app = app;
    this.sessionToken = sessionToken;
    this.transportUrl = transportUrl;
    this.resourcesPath = resourcesPath;
    this.child = null;
    this.url = "";
  }

  getBundledAppRoot() {
    return path.join(this.resourcesPath, "desktop-ui", "templates", "cloud");
  }

  async start() {
    if (this.url) return this.url;

    const bundled = this.app.isPackaged;
    const uiRoot = bundled
      ? this.getBundledAppRoot()
      : path.resolve(__dirname, "..", "..", "Jarvis Ui", "templates", "cloud");
    const entry = bundled
      ? path.join(uiRoot, "server.js")
      : require.resolve("next/dist/bin/next", { paths: [uiRoot] });
    await fs.access(entry);

    const preferredPort = Number(process.env.JARVIS_UI_PORT || (bundled ? 0 : 3310));
    let port;
    try {
      port = await allocatePort(preferredPort);
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
      port = await allocatePort();
    }
    const targetUrl = "http://" + HOST + ":" + port;
    const args = bundled ? [entry] : [entry, "dev", "--webpack", "--hostname", HOST, "--port", String(port)];
    const child = spawn(process.execPath, args, {
      cwd: uiRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: bundled ? "production" : "development",
        HOSTNAME: HOST,
        PORT: String(port),
        NEXT_PUBLIC_JARVIS_SITE_MODE: "app",
        NEXT_TELEMETRY_DISABLED: "1",
        JARVIS_UI_ORIGIN: targetUrl,
        JARVIS_TRANSPORT_URL: this.transportUrl,
        JARVIS_DESKTOP_SESSION_TOKEN: this.sessionToken
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    this.child = child;
    const controller = new AbortController();
    child.stdout.on("data", (chunk) => process.stdout.write("[desktop-ui] " + chunk));
    child.stderr.on("data", (chunk) => process.stderr.write("[desktop-ui] " + chunk));

    const childEnded = new Promise((_resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => {
        if (this.child === child) {
          this.child = null;
          this.url = "";
        }
        reject(new Error("The desktop UI process exited."));
      });
    });

    try {
      await Promise.race([waitForDesktopUi(targetUrl, this.sessionToken, controller.signal), childEnded]);
      this.url = targetUrl;
      return this.url;
    } catch (error) {
      await this.stop();
      throw error;
    } finally {
      controller.abort();
    }
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.url = "";
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;

    await new Promise((resolve) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
}

module.exports = { DesktopUiServer };
