const fs = require("node:fs/promises");
const path = require("node:path");
const { fileRevision } = require("./file-service.cjs");

const LIMIT = 200;

function folderError(code) {
  return Object.assign(new Error(code), { code });
}

function directoryIdentity(stats) {
  return stats.isDirectory() ? stats.dev + ":" + stats.ino : "";
}

class FolderBrowser {
  constructor(files) {
    this.files = files;
    this.selection = null;
    this.revision = 0;
  }

  async choose(selectedPath, assertAllowed) {
    assertAllowed();
    const directory = await fs.realpath(selectedPath);
    const identity = directoryIdentity(await fs.lstat(directory, { bigint: true }));
    if (!identity) throw folderError("FOLDER_CHANGED");
    return this.list([{ directory, identity }], assertAllowed);
  }

  async list(chain, assertAllowed, check = assertAllowed) {
    await this.checkChain(chain, check);
    const directory = chain.at(-1).directory;
    const entries = [];
    let more = false;
    for await (const entry of await fs.opendir(directory)) {
      if (!entry.isDirectory() && !entry.isFile()) continue;
      if (entries.length === LIMIT) {
        more = true;
        break;
      }
      const location = path.join(directory, entry.name);
      const stats = await fs.lstat(location, { bigint: true }).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (stats?.isDirectory()) entries.push({ name: entry.name, kind: "directory", location, identity: directoryIdentity(stats) });
      else if (stats?.isFile()) entries.push({ name: entry.name, kind: "file", location, identity: fileRevision(stats) });
    }
    await this.checkChain(chain, check);
    entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    const revision = ++this.revision;
    this.selection = { revision, chain, entries, assertAllowed };
    return {
      directory, revision, canGoUp: chain.length > 1, more,
      entries: entries.map(({ name, kind }, index) => ({ name, kind, id: index + 1 }))
    };
  }

  async checkChain(chain, assertAllowed) {
    for (const { directory, identity } of chain) {
      const stats = await fs.lstat(directory, { bigint: true }).catch(() => null);
      if (!stats || directoryIdentity(stats) !== identity) throw folderError("FOLDER_CHANGED");
    }
    assertAllowed();
  }

  async act({ revision, id, action, assertAllowed }) {
    assertAllowed();
    const selection = this.selection;
    if (!selection || selection.revision !== revision) throw folderError("FOLDER_STALE");
    const check = () => {
      assertAllowed();
      selection.assertAllowed();
    };
    const { chain, entries } = selection;
    await this.checkChain(chain, check);
    if (action === "refresh") return this.list(chain, selection.assertAllowed, check);
    if (action === "up" && chain.length > 1) return this.list(chain.slice(0, -1), selection.assertAllowed, check);
    if (!Number.isInteger(id) || id < 1 || id > entries.length) throw folderError("FOLDER_STALE");
    const entry = entries[id - 1];
    if (action === "enter" && entry.kind === "directory") {
      return this.list([...chain, { directory: entry.location, identity: entry.identity }], selection.assertAllowed, check);
    }
    if (action !== "preview" || entry.kind !== "file") throw folderError("FOLDER_STALE");
    const preview = await this.files.readPreview(entry.location, {
      assertFile(stats) {
        check();
        if (fileRevision(stats) !== entry.identity) throw folderError("FOLDER_CHANGED");
      }
    });
    await this.checkChain(chain, check);
    return preview;
  }
}

function folderGuidance(language) {
  const reply = language === "ko"
    ? "로컬 도구에서 폴더 찾아보기를 열어 파일을 확인하세요. 모델에 보여줄 파일은 대화에 직접 첨부할 수 있습니다."
    : "Open Browse files from Local tools to inspect the folder. Attach a file to the conversation to share it with your model.";
  return { reply, language, provider: "local", actions: [] };
}

module.exports = { FolderBrowser, folderGuidance };
