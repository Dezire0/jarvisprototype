const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { loadProjectEnv } = require("../src/main/project-env.cjs");

const repoRoot = path.join(__dirname, "..");
const jarvisUiRoot = path.join(repoRoot, "Jarvis Ui");
const templateRoot = path.join(jarvisUiRoot, "templates", "cloud");
const outputRoot = path.join(repoRoot, "build", "desktop-ui");
const defaultApiUrl = "http://127.0.0.1:8010/assistant";

loadProjectEnv({
  rootDir: repoRoot
});

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: "inherit"
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

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function copyIfPresent(sourcePath, targetPath) {
  if (!(await pathExists(sourcePath))) {
    return;
  }

  await fs.mkdir(path.dirname(targetPath), {
    recursive: true
  });
  await fs.cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
    dereference: true
  });
}

async function materializeStandaloneNodeModules(outputNodeModulesRoot) {
  const pnpmVirtualStoreRoot = path.join(outputNodeModulesRoot, ".pnpm", "node_modules");

  if (!(await pathExists(pnpmVirtualStoreRoot))) {
    return;
  }

  const entries = await fs.readdir(pnpmVirtualStoreRoot, {
    withFileTypes: true
  });

  for (const entry of entries) {
    const sourcePath = path.join(pnpmVirtualStoreRoot, entry.name);
    const targetPath = path.join(outputNodeModulesRoot, entry.name);

    if (await pathExists(targetPath)) {
      continue;
    }

    await fs.cp(sourcePath, targetPath, {
      recursive: true,
      force: true,
      dereference: true
    });
  }
}

async function copyStandaloneRuntimeModules(sourceNodeModulesRoot, targetNodeModulesRoot) {
  if (!(await pathExists(sourceNodeModulesRoot))) {
    return;
  }

  await fs.mkdir(targetNodeModulesRoot, {
    recursive: true
  });

  const entries = await fs.readdir(sourceNodeModulesRoot, {
    withFileTypes: true
  });

  for (const entry of entries) {
    if (entry.name === ".pnpm") {
      continue;
    }

    const sourcePath = path.join(sourceNodeModulesRoot, entry.name);
    const targetPath = path.join(targetNodeModulesRoot, entry.name);

    if (await pathExists(targetPath)) {
      continue;
    }

    await fs.cp(sourcePath, targetPath, {
      recursive: true,
      force: true,
      dereference: true
    });
  }
}

async function main() {
  const buildEnv = {
    ...process.env,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || defaultApiUrl,
    NEXT_PUBLIC_JARVIS_SITE_MODE: "app",
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
    buildEnv
  );

  const standaloneRoot = path.join(templateRoot, ".next", "standalone");
  const staticRoot = path.join(templateRoot, ".next", "static");
  const publicRoot = path.join(templateRoot, "public");
  const packagedAppRoot = path.join(outputRoot, "templates", "cloud");

  if (!(await pathExists(standaloneRoot))) {
    throw new Error("Next standalone output was not produced. Check templates/cloud/next.config.ts.");
  }

  await fs.rm(outputRoot, {
    recursive: true,
    force: true
  });

  await fs.cp(standaloneRoot, outputRoot, {
    recursive: true,
    force: true,
    dereference: true
  });
  const standaloneNodeModulesRoot = path.join(outputRoot, "node_modules");
  const packagedNodeModulesRoot = path.join(packagedAppRoot, "node_modules");

  await materializeStandaloneNodeModules(standaloneNodeModulesRoot);
  await copyStandaloneRuntimeModules(standaloneNodeModulesRoot, packagedNodeModulesRoot);
  await copyIfPresent(staticRoot, path.join(packagedAppRoot, ".next", "static"));
  await copyIfPresent(publicRoot, path.join(packagedAppRoot, "public"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
