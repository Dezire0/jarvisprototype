const fs = require("node:fs/promises");
const path = require("node:path");
const { notarize } = require("@electron/notarize");
const { loadProjectEnv } = require("../src/main/project-env.cjs");

loadProjectEnv({
  rootDir: path.join(__dirname, "..")
});

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function isEnabled(name) {
  return /^(1|true|yes)$/i.test(readEnv(name));
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function resolveAuthOptions() {
  const keychainProfile = readEnv("APPLE_KEYCHAIN_PROFILE");
  if (keychainProfile) {
    return {
      keychainProfile
    };
  }

  const appleApiKey = readEnv("APPLE_API_KEY");
  if (appleApiKey) {
    const resolvedKeyPath = path.resolve(appleApiKey);
    if (!(await pathExists(resolvedKeyPath))) {
      throw new Error(`APPLE_API_KEY does not exist: ${resolvedKeyPath}`);
    }

    const appleApiIssuer = readEnv("APPLE_API_ISSUER");
    return appleApiIssuer
      ? { appleApiKey: resolvedKeyPath, appleApiIssuer }
      : { appleApiKey: resolvedKeyPath };
  }

  const appleId = readEnv("APPLE_ID");
  const appleIdPassword = readEnv("APPLE_APP_SPECIFIC_PASSWORD");
  const teamId = readEnv("APPLE_TEAM_ID");
  if (appleId && appleIdPassword && teamId) {
    return {
      appleId,
      appleIdPassword,
      teamId
    };
  }

  return null;
}

exports.default = async function notarizeMac(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  if (isEnabled("JARVIS_SKIP_NOTARIZE")) {
    console.log("[notarize] Skipping notarization because JARVIS_SKIP_NOTARIZE is enabled.");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!(await pathExists(appPath))) {
    throw new Error(`[notarize] Packaged app was not found at ${appPath}`);
  }

  const authOptions = await resolveAuthOptions();
  if (!authOptions) {
    const message = [
      "[notarize] No notarization credentials are configured.",
      "Set APPLE_KEYCHAIN_PROFILE, or APPLE_API_KEY, or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID."
    ].join(" ");

    if (isEnabled("JARVIS_REQUIRE_NOTARIZATION")) {
      throw new Error(message);
    }

    console.log(message);
    return;
  }

  console.log(`[notarize] Starting notarization for ${appPath}`);
  await notarize({
    appPath,
    ...authOptions
  });
  console.log("[notarize] Notarization completed successfully.");
};
