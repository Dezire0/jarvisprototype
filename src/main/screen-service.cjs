const path = require("node:path");
const { execFile } = require("node:child_process");
const screenshot = require("screenshot-desktop");

const MAX_OCR_BYTES = 16_000;

function screenError(code, message) {
  return Object.assign(new Error(message), { code });
}

function runTesseract(image, language) {
  const searchPath = process.platform === "darwin"
    ? [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(path.delimiter)
    : process.env.PATH;
  return new Promise((resolve, reject) => {
    const child = execFile("tesseract", ["stdin", "stdout", "-l", language, "--psm", "6"], {
      timeout: 12_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, PATH: searchPath },
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on("error", () => {});
    child.stdin.end(image);
  });
}

function normalizeOcrText(text = "") {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

class ScreenService {
  constructor({ capture = screenshot, recognize = runTesseract } = {}) {
    this.capture = capture;
    this.recognize = recognize;
  }

  async captureScreen() {
    try {
      const image = await this.capture({ format: "png" });
      if (Buffer.isBuffer(image) && image.length) return image;
    } catch {
      // Return an actionable message without including raw OS output.
    }
    throw screenError("SCREEN_CAPTURE_FAILED", "Screen capture failed. Check the desktop screen-capture settings.");
  }

  async ocrImage(image) {
    const readText = async () => {
      try {
        return await this.recognize(image, "eng+kor");
      } catch (error) {
        if (error.code === "ENOENT" || error.killed) throw error;
        return this.recognize(image, "eng");
      }
    };
    try {
      const bytes = Buffer.from(normalizeOcrText(await readText()), "utf8");
      const truncated = bytes.length > MAX_OCR_BYTES;
      const text = new TextDecoder().decode(bytes.subarray(0, MAX_OCR_BYTES), { stream: truncated });
      return { text, truncated };
    } catch (error) {
      if (error.code === "ENOENT") throw screenError("OCR_NOT_INSTALLED", "Tesseract is required to read the screen.");
      throw screenError("OCR_FAILED", "The screen text could not be recognized. Check Tesseract and its language data.");
    }
  }

  async captureAndOcr() {
    return this.ocrImage(await this.captureScreen());
  }
}

module.exports = {
  ScreenService,
  MAX_OCR_BYTES
};
