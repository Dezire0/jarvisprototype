const { spawn } = require("node:child_process");
const path = require("node:path");
const { loadProjectEnv } = require("../src/main/project-env.cjs");

const repoRoot = path.join(__dirname, "..");
const builderCli = path.join(repoRoot, "node_modules", "electron-builder", "cli.js");
const args = process.argv.slice(2);

loadProjectEnv({
  rootDir: repoRoot
});

const sanitizedEnv = {
  ...process.env
};

for (const key of [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "CSC_NAME",
  "APPLE_KEYCHAIN_PROFILE",
  "APPLE_API_KEY",
  "APPLE_API_ISSUER",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID"
]) {
  if (String(sanitizedEnv[key] || "").trim() === "") {
    delete sanitizedEnv[key];
  }
}

const child = spawn(process.execPath, [builderCli, ...args], {
  cwd: repoRoot,
  env: sanitizedEnv,
  stdio: "inherit"
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
