const fs = require("node:fs/promises");
const path = require("node:path");
const { safeStorage } = require("electron");

function normalizeSiteKey(siteOrUrl = "") {
  const value = String(siteOrUrl).trim();

  if (!value) {
    throw new Error("A site key or URL is required.");
  }

  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch (_error) {
    return value.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  }
}

class CredentialStore {
  constructor({ app }) {
    this.app = app;
  }

  get vaultPath() {
    return path.join(this.app.getPath("userData"), "jarvis-credentials.json");
  }

  async readVault() {
    try {
      const raw = await fs.readFile(this.vaultPath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {
          version: 1,
          entries: {}
        };
      }

      throw error;
    }
  }

  async writeVault(vault) {
    await fs.mkdir(path.dirname(this.vaultPath), {
      recursive: true
    });

    await fs.writeFile(this.vaultPath, JSON.stringify(vault, null, 2), "utf8");
  }

  ensureEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS encryption is not available right now, so secure credential storage cannot be enabled.");
    }
  }

  encrypt(text) {
    this.ensureEncryption();
    return safeStorage.encryptString(text).toString("base64");
  }

  decrypt(encoded) {
    this.ensureEncryption();
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  }

  async saveCredential({ site, loginUrl, username, password }) {
    if (!username || !password) {
      throw new Error("Both username and password are required.");
    }

    const key = normalizeSiteKey(site || loginUrl);
    const vault = await this.readVault();

    vault.entries[key] = {
      site: key,
      loginUrl: loginUrl || "",
      username,
      password: this.encrypt(password),
      updatedAt: new Date().toISOString()
    };

    await this.writeVault(vault);

    return {
      site: key,
      loginUrl: loginUrl || "",
      username
    };
  }

  async getCredential(siteOrUrl) {
    const key = normalizeSiteKey(siteOrUrl);
    const vault = await this.readVault();
    const entry = vault.entries[key];

    if (!entry) {
      return null;
    }

    return {
      site: entry.site,
      loginUrl: entry.loginUrl,
      username: entry.username,
      password: this.decrypt(entry.password)
    };
  }

  async listCredentials() {
    const vault = await this.readVault();

    return Object.values(vault.entries)
      .map((entry) => ({
        site: entry.site,
        loginUrl: entry.loginUrl,
        username: entry.username,
        updatedAt: entry.updatedAt
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async deleteCredential(siteOrUrl) {
    const key = normalizeSiteKey(siteOrUrl);
    const vault = await this.readVault();

    if (!vault.entries[key]) {
      return {
        deleted: false,
        site: key
      };
    }

    delete vault.entries[key];
    await this.writeVault(vault);

    return {
      deleted: true,
      site: key
    };
  }
}

module.exports = {
  CredentialStore,
  normalizeSiteKey
};
