const fs = require("node:fs/promises");
const path = require("node:path");

const FILE_PREVIEW_BYTES = 16 * 1024;

function unsupportedPreview() {
  return Object.assign(new Error("The preview requires a regular UTF-8 text file."), {
    code: "UNSUPPORTED_FILE_PREVIEW"
  });
}

class FileService {
  constructor({ workspaceRoot }) {
    this.workspaceRoot = workspaceRoot;
  }

  resolvePath(filePath) {
    if (!filePath) {
      throw new Error("A file path is required.");
    }

    return path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.workspaceRoot, filePath);
  }

  async readFile(filePath) {
    const resolvedPath = this.resolvePath(filePath);
    const content = await fs.readFile(resolvedPath, "utf8");

    return {
      path: resolvedPath,
      content
    };
  }

  async readPreview(filePath) {
    const resolvedPath = this.resolvePath(filePath);
    if (!(await fs.stat(resolvedPath)).isFile()) throw unsupportedPreview();

    const file = await fs.open(resolvedPath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
    try {
      if (!(await file.stat()).isFile()) throw unsupportedPreview();
      const buffer = Buffer.alloc(FILE_PREVIEW_BYTES + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }

      const truncated = total > FILE_PREVIEW_BYTES;
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true })
          .decode(buffer.subarray(0, Math.min(total, FILE_PREVIEW_BYTES)), { stream: truncated });
      } catch {
        throw unsupportedPreview();
      }
      if (text.includes("\0")) throw unsupportedPreview();
      return { name: path.basename(resolvedPath), text, truncated };
    } finally {
      await file.close();
    }
  }

  async writeFile(filePath, content) {
    const resolvedPath = this.resolvePath(filePath);
    await fs.mkdir(path.dirname(resolvedPath), {
      recursive: true
    });
    await fs.writeFile(resolvedPath, content, "utf8");

    return {
      path: resolvedPath,
      bytes: Buffer.byteLength(content, "utf8")
    };
  }

  async listDirectory(dirPath = ".") {
    const resolvedPath = this.resolvePath(dirPath);
    const entries = await fs.readdir(resolvedPath, {
      withFileTypes: true
    });

    return {
      path: resolvedPath,
      entries: entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file"
      }))
    };
  }
}

module.exports = {
  FileService,
  FILE_PREVIEW_BYTES
};
