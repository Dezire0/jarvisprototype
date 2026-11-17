const path = require("node:path");
const { spawn } = require("node:child_process");
const electronBinary = require("electron");
const { loadProjectEnv } = require("../src/main/project-env.cjs");

loadProjectEnv({ rootDir: path.join(__dirname, "..") });

const desktopUiMode = String(process.env.JARVIS_DESKTOP_UI_MODE || "next").trim().toLowerCase();
const jarvisUiRoot = path.join(__dirname, "..", "Jarvis Ui");

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(command + " dependencies build failed with exit code " + code));
    });
  });
}

async function main() {
  const env = { ...process.env, JARVIS_DESKTOP_UI_MODE: desktopUiMode };
  delete env.ELECTRON_RUN_AS_NODE;

  if (desktopUiMode === "next") {
    await runCommand(
      "corepack",
      ["pnpm", "--dir", jarvisUiRoot, "-r", "--filter", "assistant-ui-starter-cloud^...", "build"],
      env
    );
  }

  const child = spawn(electronBinary, ["."], { stdio: "inherit", env });
  child.once("exit", (code) => process.exit(code ?? 0));
  child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
