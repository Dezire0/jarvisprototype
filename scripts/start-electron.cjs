const path = require("node:path");
const { spawn } = require("node:child_process");
const electronBinary = require("electron");

const desktopUiUrl = process.env.JARVIS_UI_URL || "http://127.0.0.1:3310";
const transportApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8010/assistant";
const jarvisUiRoot = path.join(__dirname, "..", "Jarvis Ui");

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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
  const sharedEnv = {
    ...process.env,
    NEXT_PUBLIC_API_URL: transportApiUrl,
    NEXT_TELEMETRY_DISABLED: "1"
  };

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

  const uiServer = spawn(
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

  const env = {
    ...sharedEnv,
    JARVIS_UI_URL: desktopUiUrl
  };

  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronBinary, ["."], {
    stdio: "inherit",
    env
  });

  const shutdown = () => {
    if (!uiServer.killed) {
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
