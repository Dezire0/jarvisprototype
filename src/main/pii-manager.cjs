const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { PROFILE_SWITCH } = require("./desktop-profile.cjs");
const { hasSecureStorage, writePrivateJson } = require("./secure-storage.cjs");

const legacyPath = app.commandLine.hasSwitch(PROFILE_SWITCH)
  ? path.join(app.getPath("userData"), "jarvis-pii.json")
  : path.join(os.homedir(), ".jarvis_pii_store.json");
const encryptedPath = path.join(app.getPath("userData"), "jarvis-pii-encrypted.json");

function readStore(filePath) {
  try {
    return Object.assign(Object.create(null), JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Could not read the Jarvis credential store.");
    return Object.create(null);
  }
}

function isSessionKey(key) {
  return typeof key === "string" && /^auth\./i.test(key);
}

function validateKey(key) {
  if (typeof key !== "string" || !key || isSessionKey(key)) {
    throw new Error("This credential field is unavailable.");
  }
}

function decrypt(value) {
  if (typeof value !== "string" || !value || !hasSecureStorage(safeStorage)) return null;
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return null;
  }
}

function update(key, val) {
  const store = readStore(encryptedPath);
  store[key] = val;
  try {
    writePrivateJson(encryptedPath, store);
  } catch {
    throw new Error("Could not update the Jarvis credential store.");
  }
}

module.exports = {
  set(key, value) {
    validateKey(key);
    if (typeof value !== "string" || !hasSecureStorage(safeStorage)) {
      throw new Error("OS-protected storage is unavailable for this credential.");
    }
    update(key, safeStorage.encryptString(value).toString("base64"));
  },
  get(key) {
    validateKey(key);
    try {
      const store = readStore(encryptedPath);
      return decrypt(Object.hasOwn(store, key) ? store[key] : readStore(legacyPath)[key]);
    } catch {
      return null;
    }
  },
  delete(key) {
    validateKey(key);
    update(key, null);
  },
  getAvailableKeys() {
    const entries = { ...readStore(legacyPath), ...readStore(encryptedPath) };
    return Object.keys(entries).filter((key) => entries[key] !== null && !isSessionKey(key));
  },
  hasLegacySession() {
    const legacy = readStore(legacyPath);
    return Object.hasOwn(legacy, "auth.token") || Object.hasOwn(legacy, "auth.user");
  },
  readLegacySession() {
    try {
      const legacy = readStore(legacyPath);
      const token = decrypt(legacy["auth.token"]);
      const user = JSON.parse(decrypt(legacy["auth.user"]));
      return token && user ? { token, user } : null;
    } catch {
      return null;
    }
  }
};
