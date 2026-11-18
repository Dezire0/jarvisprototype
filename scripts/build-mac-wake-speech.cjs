const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = path.join(root, "native", "macos-wake-speech");
const output = path.join(root, "build", "macos-wake-speech");
const binary = path.join(output, "jarvis-wake-speech");

function buildMacWakeSpeech() {
  const swift = path.join(source, "main.swift");
  const plist = path.join(source, "Info.plist");
  const entitlements = path.join(root, "resources", "macos", "entitlements.wake-speech.plist");
  const builtTime = fs.statSync(binary, { throwIfNoEntry: false })?.mtimeMs ?? 0;
  if ([swift, plist, entitlements, __filename].every((file) => fs.statSync(file).mtimeMs < builtTime)) return;

  fs.mkdirSync(output, { recursive: true });
  const staging = fs.mkdtempSync(path.join(output, ".compile-"));
  const slices = ["arm64", "x86_64"].map((arch) => path.join(staging, arch));
  const run = (args) => execFileSync("/usr/bin/xcrun", args, { stdio: "inherit" });
  try {
    for (const slice of slices) {
      run(["swiftc", "-O", "-swift-version", "5", "-target", `${path.basename(slice)}-apple-macos11.0`,
        swift, "-o", slice, "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", plist]);
    }
    const universal = path.join(staging, "universal");
    run(["lipo", "-create", ...slices, "-output", universal]);
    execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", "--entitlements", entitlements, universal], { stdio: "inherit" });
    fs.renameSync(universal, binary);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { buildMacWakeSpeech };
if (require.main === module) buildMacWakeSpeech();
