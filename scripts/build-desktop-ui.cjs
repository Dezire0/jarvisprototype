const fs = require("node:fs/promises");
const fsSync = require("node:fs");
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

function resolveCorepackCommand() {
  const nodeBinDir = path.dirname(process.execPath);
  const candidates = process.platform === "win32"
    ? [
        path.join(nodeBinDir, "node.exe"),
        process.execPath
      ]
    : [
        process.execPath
      ];

  return candidates[0];
}

function getCorepackArgs() {
  const nodeBinDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeBinDir, "..", "node_modules", "corepack", "dist", "corepack.js"),
    path.join(nodeBinDir, "node_modules", "corepack", "dist", "corepack.js"),
    path.join(nodeBinDir, "corepack"),
    path.join(nodeBinDir, "corepack.js")
  ];

  const corepackPath = candidates.find((candidate) => fsSync.existsSync(candidate));

  if (!corepackPath) {
    throw new Error(`Unable to locate corepack entrypoint near ${process.execPath}`);
  }

  return [
    corepackPath,
    "pnpm"
  ];
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

async function copyPackageTree(sourcePath, targetPath) {
  if (await pathExists(targetPath)) {
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

async function materializeStandaloneNodeModules(sourceNodeModulesRoot, targetNodeModulesRoot) {
  const pnpmStoreRoot = path.join(sourceNodeModulesRoot, ".pnpm");

  if (!(await pathExists(pnpmStoreRoot))) {
    return;
  }

  const storeEntries = await fs.readdir(pnpmStoreRoot, {
    withFileTypes: true
  });

  for (const storeEntry of storeEntries) {
    if (!storeEntry.isDirectory()) {
      continue;
    }

    const storeNodeModulesRoot = path.join(pnpmStoreRoot, storeEntry.name, "node_modules");
    if (!(await pathExists(storeNodeModulesRoot))) {
      continue;
    }

    const packageEntries = await fs.readdir(storeNodeModulesRoot, {
      withFileTypes: true
    });

    for (const packageEntry of packageEntries) {
      const packageName = packageEntry.name;
      const sourcePath = path.join(storeNodeModulesRoot, packageName);
      const targetPath = path.join(targetNodeModulesRoot, packageName);

      if (packageName.startsWith("@")) {
        const scopedEntries = await fs.readdir(sourcePath, {
          withFileTypes: true
        });

        for (const scopedEntry of scopedEntries) {
          await copyPackageTree(
            path.join(sourcePath, scopedEntry.name),
            path.join(targetPath, scopedEntry.name)
          );
        }

        continue;
      }

      await copyPackageTree(sourcePath, targetPath);
    }
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
    resolveCorepackCommand(),
    [
      ...getCorepackArgs(),
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

  await materializeStandaloneNodeModules(standaloneNodeModulesRoot, standaloneNodeModulesRoot);
  await copyStandaloneRuntimeModules(standaloneNodeModulesRoot, packagedNodeModulesRoot);
  await materializeStandaloneNodeModules(standaloneNodeModulesRoot, packagedNodeModulesRoot);
  await copyIfPresent(staticRoot, path.join(packagedAppRoot, ".next", "static"));
  await copyIfPresent(publicRoot, path.join(packagedAppRoot, "public"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
