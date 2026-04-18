const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { loadProjectEnv } = require("../src/main/project-env.cjs");

loadProjectEnv({
  rootDir: path.join(__dirname, "..")
});

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function run(command, args) {
  try {
    return {
      ok: true,
      output: execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim()
    };
  } catch (error) {
    const stdout = String(error.stdout || "").trim();
    const stderr = String(error.stderr || "").trim();
    return {
      ok: false,
      output: [stdout, stderr].filter(Boolean).join("\n").trim()
    };
  }
}

function printSection(title, lines) {
  console.log(`\n${title}`);
  for (const line of lines) {
    console.log(`- ${line}`);
  }
}

function resolveNotaryAuth() {
  const keychainProfile = readEnv("APPLE_KEYCHAIN_PROFILE");
  if (keychainProfile) {
    return `keychain profile: ${keychainProfile}`;
  }

  const appleApiKey = readEnv("APPLE_API_KEY");
  if (appleApiKey) {
    const resolvedPath = path.resolve(appleApiKey);
    const exists = fs.existsSync(resolvedPath);
    return exists
      ? `App Store Connect API key: ${resolvedPath}`
      : `App Store Connect API key path is missing: ${resolvedPath}`;
  }

  const appleId = readEnv("APPLE_ID");
  const appPassword = readEnv("APPLE_APP_SPECIFIC_PASSWORD");
  const teamId = readEnv("APPLE_TEAM_ID");
  if (appleId && appPassword && teamId) {
    return `Apple ID auth: ${appleId} / team ${teamId}`;
  }

  return "";
}

const notarytool = run("xcrun", ["notarytool", "--version"]);
const identities = run("security", ["find-identity", "-v", "-p", "codesigning"]);
const authSummary = resolveNotaryAuth();

printSection("Tooling", [
  notarytool.ok ? `notarytool available (${notarytool.output})` : `notarytool missing: ${notarytool.output || "unknown error"}`,
  fs.existsSync(path.resolve("resources/macos/entitlements.mac.plist"))
    ? "macOS entitlements file present"
    : "macOS entitlements file missing"
]);

printSection("Code Signing", [
  identities.output.includes("Developer ID Application:")
    ? "Developer ID Application identity found in keychain"
    : "No Developer ID Application identity found in keychain",
  "Tip: run `security find-identity -v -p codesigning` to inspect all code-signing identities."
]);

printSection("Notarization Auth", [
  authSummary || "No notarization auth configured yet",
  "Preferred: APPLE_KEYCHAIN_PROFILE created with `xcrun notarytool store-credentials`."
]);

printSection("Release Host", [
  readEnv("JARVIS_UPDATER_PROVIDER")
    ? `Updater provider configured: ${readEnv("JARVIS_UPDATER_PROVIDER")}`
    : "Updater provider not configured yet",
  "Supabase is optional, not required. Any HTTPS file host or GitHub Releases works."
]);
