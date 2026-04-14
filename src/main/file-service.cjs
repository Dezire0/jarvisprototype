const fs = require("node:fs/promises");
const path = require("node:path");

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
  FileService
};
