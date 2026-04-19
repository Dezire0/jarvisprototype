const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_SOURCE_APP = path.join(
  __dirname,
  "..",
  "release",
  "mac-arm64",
  "Jarvis Desktop.app"
);
const DEFAULT_TARGET_APP = "/Applications/Jarvis Desktop.app";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function readCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error || result.status !== 0) {
    return "";
  }

  return String(result.stdout || "").trim();
}

function resolveAppPath(candidate, fallback) {
  return candidate ? path.resolve(candidate) : fallback;
}

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} not found: ${targetPath}`);
  }
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join("") + "-" + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

function backupInstalledApp(targetApp) {
  if (!fs.existsSync(targetApp)) {
    return "";
  }

  const backupRoot = path.join(os.homedir(), "Desktop", "Jarvis Desktop Backups");
  fs.mkdirSync(backupRoot, {
    recursive: true
  });

  const backupPath = path.join(backupRoot, `Jarvis Desktop ${timestamp()}.app`);
  run("mv", [targetApp, backupPath]);
  return backupPath;
}

function readAppVersion(appPath) {
  const infoPath = path.join(appPath, "Contents", "Info");
  return readCommand("defaults", [infoPath, "CFBundleShortVersionString"]);
}

function main() {
  const sourceApp = resolveAppPath(process.argv[2], DEFAULT_SOURCE_APP);
  const targetApp = resolveAppPath(process.argv[3], DEFAULT_TARGET_APP);

  ensureExists(sourceApp, "Source app");

  console.log(`Source: ${sourceApp}`);
  console.log(`Target: ${targetApp}`);

  const previousVersion = fs.existsSync(targetApp) ? readAppVersion(targetApp) : "";
  if (previousVersion) {
    console.log(`Installed version before replace: ${previousVersion}`);
  }

  const backupPath = backupInstalledApp(targetApp);
  if (backupPath) {
    console.log(`Backed up previous app to: ${backupPath}`);
  }

  run("ditto", [sourceApp, targetApp]);
  run("xattr", ["-dr", "com.apple.quarantine", targetApp]);

  const nextVersion = readAppVersion(targetApp);
  if (nextVersion) {
    console.log(`Installed version after replace: ${nextVersion}`);
  }

  run("open", ["-na", targetApp]);
  console.log("Jarvis Desktop replacement install completed.");
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
