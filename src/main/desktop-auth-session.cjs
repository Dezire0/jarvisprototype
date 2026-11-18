const fs = require("node:fs");
const { hasSecureStorage, writePrivateJson } = require("./secure-storage.cjs");

function accountFrom(value) {
  const token = value?.token;
  const user = value?.user;
  if (typeof token !== "string" || !token || typeof user?.id !== "string" || !user.id) {
    return null;
  }
  const { id, email, name, plan, settings } = user;
  return {
    token,
    user: {
      id,
      email,
      name,
      plan,
      settings: {
        autoSync: settings?.autoSync,
        preferWebAi: settings?.preferWebAi,
        language: settings?.language,
        planConfirmed: settings?.planConfirmed
      }
    }
  };
}

class DesktopAuthSession {
  constructor({ filePath, secureStorage, platform, hasLegacy, readLegacy }) {
    this.filePath = filePath;
    this.storage = secureStorage;
    this.platform = platform;
    this.hasLegacy = hasLegacy;
    this.readLegacy = readLegacy;
    this.active = null;
    this.remembered = false;
    this.initialized = false;
  }

  canRemember() {
    return hasSecureStorage(this.storage, this.platform);
  }

  write(encrypted) {
    writePrivateJson(this.filePath, { version: 1, encrypted });
  }

  view(status) {
    return {
      token: this.active?.token ?? null,
      user: this.active?.user ?? null,
      remembered: this.remembered,
      canRemember: this.canRemember(),
      status
    };
  }

  restore({ allowLegacy = true } = {}) {
    if (this.initialized || !this.canRemember()) return this.view();
    this.initialized = true;

    let record;
    try {
      record = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" && allowLegacy) {
        const legacy = accountFrom(this.readLegacy?.());
        if (legacy) {
          try {
            return this.save({ ...legacy, remember: true });
          } catch {
            this.active = legacy;
            this.remembered = true;
            return this.view("save-failed");
          }
        }
      }
      return this.view(error.code === "ENOENT" ? undefined : "read-failed");
    }

    if (record?.version === 1 && typeof record.encrypted === "string") {
      try {
        const plaintext = this.storage.decryptString(Buffer.from(record.encrypted, "base64"));
        this.active = accountFrom(JSON.parse(plaintext));
        this.remembered = Boolean(this.active);
      } catch {
        return this.view("read-failed");
      }
    }
    return this.view();
  }

  discardRememberedSession() {
    if (fs.existsSync(this.filePath) || this.hasLegacy?.()) this.write(null);
  }

  save(payload) {
    const active = accountFrom(payload);
    if (!active) throw new Error("A valid Jarvis session is required.");

    let status;
    let remembered = false;
    if (payload.remember && this.canRemember()) {
      try {
        const encrypted = this.storage.encryptString(JSON.stringify(active)).toString("base64");
        this.write(encrypted);
        remembered = true;
      } catch {
        status = "save-failed";
      }
    } else if (payload.remember) {
      status = "unavailable";
    }

    if (!remembered) {
      try {
        this.discardRememberedSession();
      } catch {
        throw new Error("Could not remove the previously saved Jarvis session.");
      }
    }

    this.initialized = true;
    this.active = active;
    this.remembered = remembered;
    return this.view(status);
  }

  clear() {
    try {
      this.discardRememberedSession();
    } catch {
      throw new Error("Could not remove the saved Jarvis session.");
    }
    this.initialized = true;
    this.active = null;
    this.remembered = false;
  }
}

module.exports = { DesktopAuthSession };
