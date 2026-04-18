const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.join(__dirname, "..");
const iconsDir = path.join(repoRoot, "resources", "icons");
const brandDir = path.join(repoRoot, "resources", "brand");
const sourceSvg = path.join(iconsDir, "jarvis-icon.svg");
const sourcePng = path.join(brandDir, "jarvis-logo-badge.png");
const pngPath = path.join(iconsDir, "icon.png");
const icnsPath = path.join(iconsDir, "icon.icns");
const icoPath = path.join(iconsDir, "icon.ico");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...options
  });

  if (result.status !== 0) {
    throw new Error(
      [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `${command} failed`
    );
  }
}

function commandExists(command) {
  const result = spawnSync("which", [command], {
    stdio: "pipe",
    encoding: "utf8"
  });

  return result.status === 0;
}

async function ensureFile(filePath) {
  await fsp.access(filePath);
}

async function makeBasePng(tempDir) {
  const basePng = path.join(tempDir, "icon-1024.png");

  if (fs.existsSync(sourcePng)) {
    if (commandExists("magick")) {
      run("magick", [
        sourcePng,
        "-background",
        "none",
        `PNG32:${basePng}`
      ]);
      return basePng;
    }

    await fsp.copyFile(sourcePng, basePng);
    return basePng;
  }

  if (commandExists("ffmpeg")) {
    try {
      run("ffmpeg", [
        "-y",
        "-i",
        sourceSvg,
        "-frames:v",
        "1",
        "-vf",
        "scale=1024:1024",
        basePng
      ]);
      return basePng;
    } catch (_error) {
      // Fall through to qlmanage on macOS builds where ffmpeg lacks SVG decoding.
    }
  }

  if (commandExists("qlmanage")) {
    run("qlmanage", [
      "-t",
      "-s",
      "1024",
      "-o",
      tempDir,
      sourceSvg
    ]);
    const quickLookPng = path.join(tempDir, `${path.basename(sourceSvg)}.png`);
    await ensureFile(quickLookPng);
    await fsp.copyFile(quickLookPng, basePng);
    return basePng;
  }

  throw new Error("Neither ffmpeg nor qlmanage is available to rasterize the SVG icon.");
}

async function buildIconset(basePng, tempDir) {
  const iconsetDir = path.join(tempDir, "jarvis.iconset");
  await fsp.mkdir(iconsetDir, {
    recursive: true
  });

  const sizes = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"]
  ];

  for (const [size, filename] of sizes) {
    run("sips", [
      "-z",
      String(size),
      String(size),
      basePng,
      "--out",
      path.join(iconsetDir, filename)
    ]);
  }

  return iconsetDir;
}

function buildIcnsWithTiff2Icns(basePng, tempDir) {
  const tiffPath = path.join(tempDir, "iconset.tiff");
  const frames = [16, 32, 48, 128, 256, 512, 1024];
  const args = [];

  for (const size of frames) {
    args.push("(");
    args.push(basePng, "-resize", `${size}x${size}`);
    args.push(")");
  }

  args.push(tiffPath);
  run("magick", args);
  run("tiff2icns", [tiffPath, icnsPath]);
}

async function main() {
  if (!fs.existsSync(sourcePng)) {
    await ensureFile(sourceSvg);
  }
  await fsp.mkdir(iconsDir, {
    recursive: true
  });

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "jarvis-icons-"));

  try {
    const basePng = await makeBasePng(tempDir);
    await fsp.copyFile(basePng, pngPath);

    const iconsetDir = await buildIconset(basePng, tempDir);
    try {
      run("iconutil", ["-c", "icns", iconsetDir, "-o", icnsPath]);
    } catch (error) {
      if (commandExists("tiff2icns") && commandExists("magick")) {
        buildIcnsWithTiff2Icns(basePng, tempDir);
      } else if (!fs.existsSync(icnsPath)) {
        throw error;
      } else {
        console.warn(
          [
            "iconutil failed, preserving the existing macOS .icns icon.",
            String(error.message || error)
          ].join("\n")
        );
      }
    }

    if (commandExists("ffmpeg")) {
      run("ffmpeg", [
        "-y",
        "-i",
        basePng,
        "-vf",
        "scale=256:256",
        icoPath
      ]);
    } else {
      await fsp.copyFile(basePng, icoPath);
    }

    const outputs = [pngPath, icnsPath, icoPath]
      .filter((filePath) => fs.existsSync(filePath))
      .map((filePath) => path.relative(repoRoot, filePath));

    console.log(JSON.stringify({
      ok: true,
      outputs
    }, null, 2));
  } finally {
    await fsp.rm(tempDir, {
      recursive: true,
      force: true
    });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
