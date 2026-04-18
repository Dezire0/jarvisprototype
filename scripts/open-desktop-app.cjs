const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_APP_PATH = "/Applications/Jarvis Desktop.app";

function resolveAppPath() {
  const candidate = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_APP_PATH;

  if (!fs.existsSync(candidate)) {
    throw new Error(`Could not find app bundle at ${candidate}`);
  }

  return candidate;
}

function main() {
  const appPath = resolveAppPath();
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const result = spawnSync("open", ["-na", appPath], {
    stdio: "inherit",
    env: childEnv
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`open -na ${appPath} failed with exit code ${result.status}`);
  }

  console.log(`Opened ${appPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
