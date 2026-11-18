const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Electron can report encryption as available even when Linux uses basic_text.
function hasSecureStorage(storage, platform = process.platform) {
  try {
    if (!storage?.isEncryptionAvailable()) return false;
    if (platform !== "linux") return true;

    const backend = storage.getSelectedStorageBackend();
    return backend === "gnome_libsecret" || /^kwallet[56]?$/.test(backend);
  } catch {
    return false;
  }
}

function writePrivateJson(filePath, value) {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

module.exports = { hasSecureStorage, writePrivateJson };
