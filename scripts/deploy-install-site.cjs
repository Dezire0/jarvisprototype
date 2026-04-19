const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const siteRoot = path.join(repoRoot, "site", "install-web");
const syncScript = path.join(repoRoot, "scripts", "sync-install-site-config.cjs");
const wranglerBin = path.join(siteRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const wranglerLogDir = path.join(siteRoot, ".wrangler", "logs");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: siteRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: wranglerLogDir,
      ...options.env,
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
}

if (!fs.existsSync(wranglerBin)) {
  throw new Error(
    "Wrangler is not installed in site/install-web. Run npm install in that folder first.",
  );
}

fs.mkdirSync(wranglerLogDir, {
  recursive: true,
});

const projectName = process.env.CF_PAGES_PROJECT_NAME || "dexproject";
const branch =
  process.env.CF_PAGES_BRANCH ||
  process.env.GITHUB_REF_NAME ||
  git(["rev-parse", "--abbrev-ref", "HEAD"]) ||
  "main";
const commitHash =
  process.env.CF_PAGES_COMMIT_HASH ||
  process.env.GITHUB_SHA ||
  git(["rev-parse", "HEAD"]);
const commitMessage =
  process.env.CF_PAGES_COMMIT_MESSAGE ||
  process.env.GITHUB_HEAD_COMMIT_MESSAGE ||
  (commitHash ? git(["show", "-s", "--format=%B", commitHash]) : "") ||
  "Install site deploy";
const commitDirty = normalizeBoolean(
  process.env.CF_PAGES_COMMIT_DIRTY,
  Boolean(git(["status", "--porcelain"])),
);

run(process.execPath, [syncScript]);

const args = [
  "pages",
  "deploy",
  "public",
  "--project-name",
  projectName,
  "--branch",
  branch,
  "--commit-dirty",
  String(commitDirty),
];

if (commitHash) {
  args.push("--commit-hash", commitHash);
}

if (commitMessage) {
  args.push("--commit-message", commitMessage);
}

run(process.execPath, [wranglerBin, ...args]);
