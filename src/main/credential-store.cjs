const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "friday-jarvis-prototype";
const LEGACY_KEYCHAIN_SERVICE = "jarvis";

function createEmptyVault() {
  return {
    version: 1,
    entries: {}
  };
}

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

function isMissingPasswordError(error) {
  const message = String(error?.stderr || error?.message || "");
  return /could not be found/i.test(message) || error?.code === 44;
}

class CredentialStore {
  constructor({ app, safeStorage, execFileImpl, sharedVaultDir } = {}) {
    this.app = app;
    this.safeStorage = safeStorage || null;
    this.execFile = execFileImpl || execFileAsync;
    this.sharedVaultDir = sharedVaultDir || path.join(os.homedir(), ".friday-jarvis");
    this.migrationPromise = null;
  }

  get vaultPath() {
    return path.join(this.sharedVaultDir, "credentials.json");
  }

  get legacyVaultPath() {
    return path.join(this.app.getPath("userData"), "jarvis-credentials.json");
  }

  async readVault() {
    try {
      const raw = await fs.readFile(this.vaultPath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === "ENOENT") {
        return createEmptyVault();
      }

      throw error;
    }
  }

  async readLegacyVault() {
    try {
      const raw = await fs.readFile(this.legacyVaultPath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === "ENOENT") {
        return createEmptyVault();
      }

      throw error;
    }
  }

  async writeVault(vault) {
    await fs.mkdir(this.sharedVaultDir, {
      recursive: true
    });

    await fs.writeFile(this.vaultPath, JSON.stringify(vault, null, 2), "utf8");
  }

  async writeLegacyVault(vault) {
    await fs.mkdir(path.dirname(this.legacyVaultPath), {
      recursive: true
    });

    await fs.writeFile(this.legacyVaultPath, JSON.stringify(vault, null, 2), "utf8");
  }

  ensureEncryption() {
    if (!this.safeStorage?.isEncryptionAvailable?.()) {
      throw new Error("OS encryption is not available right now, so secure credential storage cannot be enabled.");
    }
  }

  encrypt(text) {
    this.ensureEncryption();
    return this.safeStorage.encryptString(text).toString("base64");
  }

  decrypt(encoded) {
    this.ensureEncryption();
    return this.safeStorage.decryptString(Buffer.from(encoded, "base64"));
  }

  passwordAccount(siteKey) {
    return `${siteKey}:password`;
  }

  legacyPasswordAccount(siteKey) {
    return `${siteKey}_password`;
  }

  async runSecurityCommand(args) {
    if (process.platform !== "darwin") {
      throw new Error("macOS Keychain is only available on darwin.");
    }

    return this.execFile("security", args);
  }

  async getPasswordFromKeychain(service, account) {
    try {
      const { stdout } = await this.runSecurityCommand([
        "find-generic-password",
        "-s",
        service,
        "-a",
        account,
        "-w"
      ]);
      return String(stdout || "").replace(/\r?\n$/, "");
    } catch (error) {
      if (isMissingPasswordError(error)) {
        return "";
      }

      throw error;
    }
  }

  async savePasswordToKeychain(service, account, password) {
    await this.runSecurityCommand([
      "add-generic-password",
      "-U",
      "-s",
      service,
      "-a",
      account,
      "-w",
      password
    ]);
  }

  async deletePasswordFromKeychain(service, account) {
    try {
      await this.runSecurityCommand([
        "delete-generic-password",
        "-s",
        service,
        "-a",
        account
      ]);
      return true;
    } catch (error) {
      if (isMissingPasswordError(error)) {
        return false;
      }

      throw error;
    }
  }

  async readPassword(siteKey, legacyEntry = null) {
    const primaryPassword = await this.getPasswordFromKeychain(KEYCHAIN_SERVICE, this.passwordAccount(siteKey)).catch(
      () => ""
    );

    if (primaryPassword) {
      return primaryPassword;
    }

    const legacyKeychainPassword = await this.getPasswordFromKeychain(
      LEGACY_KEYCHAIN_SERVICE,
      this.legacyPasswordAccount(siteKey)
    ).catch(() => "");

    if (legacyKeychainPassword) {
      return legacyKeychainPassword;
    }

    if (legacyEntry?.password) {
      return this.decrypt(legacyEntry.password);
    }

    return "";
  }

  async saveLegacyPassword(siteKey, metadata, password) {
    const vault = await this.readLegacyVault();
    const current = vault.entries[siteKey] || {};
    vault.entries[siteKey] = {
      site: siteKey,
      loginUrl: metadata.loginUrl || current.loginUrl || "",
      username: metadata.username || current.username || "",
      password: this.encrypt(password),
      updatedAt: metadata.updatedAt || new Date().toISOString()
    };
    await this.writeLegacyVault(vault);
  }

  async ensureMigrated() {
    if (!this.migrationPromise) {
      this.migrationPromise = this.migrateLegacyVault();
    }

    return this.migrationPromise;
  }

  async migrateLegacyVault() {
    const legacyVault = await this.readLegacyVault();
    const legacyEntries = Object.entries(legacyVault.entries || {});

    if (!legacyEntries.length) {
      return;
    }

    const sharedVault = await this.readVault();
    let sharedChanged = false;

    for (const [rawKey, entry] of legacyEntries) {
      const siteKey = normalizeSiteKey(entry.site || rawKey);
      const existing = sharedVault.entries[siteKey] || {};
      const incomingUpdatedAt = String(entry.updatedAt || "");
      const existingUpdatedAt = String(existing.updatedAt || "");
      const shouldReplace = !existing.site || incomingUpdatedAt > existingUpdatedAt;

      if (shouldReplace) {
        sharedVault.entries[siteKey] = {
          site: siteKey,
          loginUrl: entry.loginUrl || existing.loginUrl || "",
          username: entry.username || existing.username || "",
          updatedAt: entry.updatedAt || existing.updatedAt || new Date().toISOString()
        };
        sharedChanged = true;
      }

      const storedPassword = await this.getPasswordFromKeychain(KEYCHAIN_SERVICE, this.passwordAccount(siteKey)).catch(
        () => ""
      );

      if (!storedPassword && entry.password) {
        try {
          await this.savePasswordToKeychain(KEYCHAIN_SERVICE, this.passwordAccount(siteKey), this.decrypt(entry.password));
        } catch (_error) {
          // Keep the legacy vault as a fallback if Keychain migration is unavailable.
        }
      }
    }

    if (sharedChanged) {
      await this.writeVault(sharedVault);
    }
  }

  async saveCredential({ site, loginUrl, username, password }) {
    if (!username || !password) {
      throw new Error("Both username and password are required.");
    }

    await this.ensureMigrated();

    const key = normalizeSiteKey(site || loginUrl);
    const vault = await this.readVault();
    const updatedAt = new Date().toISOString();

    try {
      await this.savePasswordToKeychain(KEYCHAIN_SERVICE, this.passwordAccount(key), password);
    } catch (error) {
      if (!this.safeStorage?.isEncryptionAvailable?.()) {
        throw new Error(`Secure credential storage is unavailable: ${error.message}`);
      }

      await this.saveLegacyPassword(
        key,
        {
          loginUrl,
          username,
          updatedAt
        },
        password
      );
    }

    vault.entries[key] = {
      site: key,
      loginUrl: loginUrl || "",
      username,
      updatedAt
    };

    await this.writeVault(vault);

    return {
      site: key,
      loginUrl: loginUrl || "",
      username
    };
  }

  async getCredential(siteOrUrl) {
    await this.ensureMigrated();

    const key = normalizeSiteKey(siteOrUrl);
    const vault = await this.readVault();
    const entry = vault.entries[key];
    const legacyVault = await this.readLegacyVault();
    const legacyEntry = legacyVault.entries[key];

    if (!entry && !legacyEntry) {
      return null;
    }

    const password = await this.readPassword(key, legacyEntry);
    const username = entry?.username || legacyEntry?.username || "";

    if (!username || !password) {
      return null;
    }

    return {
      site: key,
      loginUrl: entry?.loginUrl || legacyEntry?.loginUrl || "",
      username,
      password
    };
  }

  async listCredentials() {
    await this.ensureMigrated();

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
    await this.ensureMigrated();

    const key = normalizeSiteKey(siteOrUrl);
    const vault = await this.readVault();
    const legacyVault = await this.readLegacyVault();
    const sharedDeleted = Boolean(vault.entries[key]);
    const legacyDeleted = Boolean(legacyVault.entries[key]);

    if (sharedDeleted) {
      delete vault.entries[key];
      await this.writeVault(vault);
    }

    if (legacyDeleted) {
      delete legacyVault.entries[key];
      await this.writeLegacyVault(legacyVault);
    }

    const keychainDeleted = await this.deletePasswordFromKeychain(KEYCHAIN_SERVICE, this.passwordAccount(key)).catch(
      () => false
    );
    await this.deletePasswordFromKeychain(LEGACY_KEYCHAIN_SERVICE, this.legacyPasswordAccount(key)).catch(() => false);

    return {
      deleted: sharedDeleted || legacyDeleted || keychainDeleted,
      site: key
    };
  }
}

module.exports = {
  CredentialStore,
  normalizeSiteKey
};
