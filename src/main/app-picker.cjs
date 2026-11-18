const fs = require("node:fs/promises");
const path = require("node:path");

const RESULT_LIMIT = 24;

function pickerError(code) {
  return Object.assign(new Error(code), { code });
}

async function snapshotBundle(location) {
  if (typeof location !== "string" || !path.isAbsolute(location) || !/\.app$/i.test(location)) return null;
  try {
    const absolute = await fs.realpath(location);
    if (!/\.app$/i.test(absolute)) return null;
    const root = await fs.lstat(absolute, { bigint: true });
    const info = await fs.lstat(path.join(absolute, "Contents", "Info.plist"), { bigint: true });
    if (!root.isDirectory() || !info.isFile()) return null;
    return {
      location: absolute,
      fingerprint: [root.dev, root.ino, root.ctimeNs, info.dev, info.ino, info.mtimeNs, info.ctimeNs, info.size].join(":")
    };
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP"].includes(error.code)) return null;
    throw error;
  }
}

class AppPicker {
  constructor({ listApps, launch, platform = process.platform }) {
    this.listApps = listApps;
    this.launch = launch;
    this.platform = platform;
    this.revision = 0;
    this.selection = null;
  }

  async search({ query = "", refresh = false, assertAllowed }) {
    assertAllowed();
    if (this.platform !== "darwin") return { supported: false, apps: [] };
    if (typeof query !== "string" || query.length > 120) throw pickerError("APPS_QUERY");

    const revision = ++this.revision;
    this.selection = null;
    const { apps } = await this.listApps({ query: query.trim(), limit: RESULT_LIMIT + 1, forceRefresh: refresh === true });
    const inspected = await Promise.all(apps.map((app) => snapshotBundle(app.path)));
    assertAllowed();
    if (revision !== this.revision) throw pickerError("APPS_STALE");

    const entries = new Map();
    const visited = new Set();
    for (const bundle of inspected) {
      if (!bundle || visited.has(bundle.location)) continue;
      visited.add(bundle.location);
      const id = String(entries.size + 1);
      entries.set(id, {
        ...bundle,
        name: path.basename(bundle.location).slice(0, -4)
      });
      if (entries.size === RESULT_LIMIT) break;
    }

    this.selection = { revision, entries, assertAllowed };
    return {
      supported: true,
      revision,
      more: apps.length > RESULT_LIMIT,
      apps: [...entries].map(([id, bundle]) => ({ id, name: bundle.name, location: bundle.location }))
    };
  }

  async open({ revision, id, assertAllowed }) {
    assertAllowed();
    const selection = this.selection;
    if (!selection || selection.revision !== revision || !selection.entries.has(id)) throw pickerError("APPS_STALE");
    selection.assertAllowed();
    const bundle = selection.entries.get(id);
    const current = await snapshotBundle(bundle.location);
    if (this.selection !== selection) throw pickerError("APPS_STALE");
    if (current?.location !== bundle.location || current.fingerprint !== bundle.fingerprint) throw pickerError("APPS_CHANGED");
    assertAllowed();
    selection.assertAllowed();
    if (await this.launch(bundle.location)) throw pickerError("APPS_OPEN_FAILED");
    return { name: bundle.name };
  }
}

function appPickerGuidance(language) {
  const reply = language === "ko"
    ? "로컬 도구에서 앱을 열고 설치된 앱을 찾아 선택하세요."
    : "Open Apps from Local tools to find and choose an installed app.";
  return { reply, language, provider: "local", actions: [] };
}

module.exports = { AppPicker, appPickerGuidance };
