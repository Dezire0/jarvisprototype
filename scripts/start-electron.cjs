const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const electronBinary = require("electron");
const { loadProjectEnv } = require("../src/main/project-env.cjs");

loadProjectEnv({
  rootDir: path.join(__dirname, "..")
});

const desktopUiUrl = process.env.JARVIS_UI_URL || "http://127.0.0.1:3310";
const jarvisUiRoot = path.join(__dirname, "..", "Jarvis Ui");
const desktopUiMode = String(process.env.JARVIS_DESKTOP_UI_MODE || "next").trim().toLowerCase();

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });

    child.on("error", reject);
  });
}

async function main() {
  const assistantPort = Number(process.env.JARVIS_ASSISTANT_PORT) || await allocatePort();
  const transportApiUrl =
    process.env.JARVIS_TRANSPORT_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    `http://127.0.0.1:${assistantPort}/assistant`;
  const sharedEnv = {
    ...process.env,
    JARVIS_ASSISTANT_PORT: String(assistantPort),
    JARVIS_TRANSPORT_URL: transportApiUrl,
    NEXT_PUBLIC_API_URL: transportApiUrl,
    JARVIS_DESKTOP_UI_MODE: desktopUiMode || "next",
    NEXT_PUBLIC_JARVIS_SITE_MODE: "app",
    NEXT_TELEMETRY_DISABLED: "1"
  };

  const env = {
    ...sharedEnv
  };

  let uiServer = null;

  if (desktopUiMode === "next") {
    await runCommand(
      "corepack",
      [
        "pnpm",
        "--dir",
        jarvisUiRoot,
        "-r",
        "--filter",
        "assistant-ui-starter-cloud...",
        "build"
      ],
      sharedEnv
    );

    uiServer = spawn(
      "corepack",
      [
        "pnpm",
        "--dir",
        jarvisUiRoot,
        "--filter",
        "assistant-ui-starter-cloud",
        "exec",
        "next",
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        new URL(desktopUiUrl).port || "3310"
      ],
      {
        stdio: "inherit",
        env: sharedEnv
      }
    );

    let didExitEarly = false;

    uiServer.once("exit", (code) => {
      didExitEarly = true;

      if (code && code !== 0) {
        process.exit(code);
      }
    });

    try {
      await waitForUrl(desktopUiUrl);
    } catch (error) {
      if (!didExitEarly) {
        uiServer.kill("SIGTERM");
      }

      throw error;
    }

    env.JARVIS_UI_URL = desktopUiUrl;
  } else {
    delete env.JARVIS_UI_URL;
  }

  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronBinary, ["."], {
    stdio: "inherit",
    env
  });

  const shutdown = () => {
    if (uiServer && !uiServer.killed) {
      uiServer.kill("SIGTERM");
    }
  };

  child.on("exit", (code) => {
    shutdown();
    process.exit(code ?? 0);
  });

  process.on("SIGINT", () => {
    shutdown();
    child.kill("SIGTERM");
  });

  process.on("SIGTERM", () => {
    shutdown();
    child.kill("SIGTERM");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
