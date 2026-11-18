const fs = require("node:fs/promises");
const path = require("node:path");

const FILE_PREVIEW_BYTES = 16 * 1024;

function unsupportedPreview() {
  return Object.assign(new Error("The preview requires a regular UTF-8 text file."), {
    code: "UNSUPPORTED_FILE_PREVIEW"
  });
}

function fileWriteError(code, message) {
  return Object.assign(new Error(message), { code });
}

function fileRevision(stats) {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs, stats.mode].join(":");
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

  async existingFileForWrite(filePath) {
    const requested = path.resolve(this.resolvePath(filePath));
    try {
      const dir = await fs.realpath(path.dirname(requested));
      const target = path.join(dir, path.basename(requested));
      const stats = await fs.lstat(target, { bigint: true });
      if (!stats.isFile() || (process.getuid && stats.uid !== BigInt(process.getuid()))) {
        throw fileWriteError("FILE_UNSUPPORTED", "Choose a regular file you own.");
      }
      await fs.access(target, fs.constants.W_OK);
      return { path: target, revision: fileRevision(stats), mode: Number(stats.mode & 0o777n) };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async writeFile(filePath, content, { assertAllowed } = {}) {
    if (typeof content !== "string") throw fileWriteError("FILE_UNSUPPORTED", "Text content is required.");
    const resolvedPath = path.resolve(this.resolvePath(filePath));
    assertAllowed?.();
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    return this.#publishFile(resolvedPath, content, { assertAllowed });
  }

  async replaceFile(snapshot, content, assertAllowed) {
    return this.#publishFile(snapshot.path, content, { snapshot, assertAllowed });
  }

  async #publishFile(target, content, { snapshot, assertAllowed }) {
    if (typeof content !== "string") throw fileWriteError("FILE_UNSUPPORTED", "Text content is required.");
    const staging = await fs.mkdtemp(path.join(path.dirname(target), ".jarvis-save-"));
    const stagedFile = path.join(staging, "content");
    try {
      await fs.writeFile(stagedFile, content, { encoding: "utf8", flag: "wx", mode: snapshot?.mode ?? 0o666 });
      if (snapshot) {
        await fs.chmod(stagedFile, snapshot.mode);
        const current = await this.existingFileForWrite(target).catch((error) => {
          if (error.code === "FILE_UNSUPPORTED") return null;
          throw error;
        });
        if (current?.path !== snapshot.path || current.revision !== snapshot.revision) {
          throw fileWriteError("FILE_CHANGED", "The file changed while replacement was pending.");
        }
        assertAllowed?.();
        await fs.rename(stagedFile, target);
      } else {
        assertAllowed?.();
        await fs.link(stagedFile, target);
      }
      return { path: target, bytes: Buffer.byteLength(content, "utf8") };
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
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
