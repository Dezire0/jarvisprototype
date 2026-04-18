const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_APP_PATH = "/Applications/Jarvis Desktop.app";

function run(command, args) {
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: childEnv
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function resolveAppPath() {
  const candidate = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_APP_PATH;

  if (!fs.existsSync(candidate)) {
    throw new Error(`Could not find app bundle at ${candidate}`);
  }

  return candidate;
}

function main() {
  const appPath = resolveAppPath();

  console.log(`Removing quarantine from: ${appPath}`);
  run("xattr", ["-dr", "com.apple.quarantine", appPath]);

  console.log(`Opening app: ${appPath}`);
  run("open", ["-na", appPath]);

  console.log("");
  console.log("Jarvis Desktop launch recovery completed.");
  console.log("If macOS still warns about the app, the permanent fix is Developer ID signing + notarization.");
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
