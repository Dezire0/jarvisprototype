const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const screenshot = require("screenshot-desktop");

const execFileAsync = promisify(execFile);

function normalizeOcrText(text = "") {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

class ScreenService {
  constructor({ tempRoot } = {}) {
    this.tempRoot = tempRoot || path.join(os.tmpdir(), "jarvis-prototype");
  }

  async captureScreen() {
    await fs.mkdir(this.tempRoot, {
      recursive: true
    });

    const imagePath = path.join(this.tempRoot, `screen-${Date.now()}.png`);
    let image;

    try {
      image = await screenshot({
        format: "png"
      });
    } catch (error) {
      throw new Error(
        "Screen capture failed. On macOS, enable Screen Recording permission for Electron or Terminal and try again."
      );
    }

    await fs.writeFile(imagePath, image);

    return {
      imagePath
    };
  }

  async ocrImage(imagePath) {
    const runOcr = async (lang) => {
      const { stdout } = await execFileAsync("tesseract", [imagePath, "stdout", "-l", lang, "--psm", "6"]);
      return normalizeOcrText(stdout);
    };

    try {
      const text = await runOcr("eng+kor");
      return text;
    } catch (_error) {
      return runOcr("eng");
    }
  }

  async captureAndOcr() {
    const { imagePath } = await this.captureScreen();
    const text = await this.ocrImage(imagePath);

    return {
      imagePath,
      text
    };
  }
}

module.exports = {
  ScreenService
};
