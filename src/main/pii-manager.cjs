const { safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PII_STORE_PATH = path.join(os.homedir(), ".jarvis_pii_store.json");

/**
 * PIIManager securely stores and retrieves Personal Identifiable Information
 * and sensitive credentials using Electron's native safeStorage encryption.
 */
class PIIManager {
  constructor() {
    this.store = this._loadStore();
  }

  _loadStore() {
    if (!fs.existsSync(PII_STORE_PATH)) {
      return {};
    }
    try {
      const data = fs.readFileSync(PII_STORE_PATH, "utf8");
      return JSON.parse(data);
    } catch (err) {
      console.error("Failed to load PII store", err);
      return {};
    }
  }

  _saveStore() {
    try {
      fs.writeFileSync(PII_STORE_PATH, JSON.stringify(this.store, null, 2));
    } catch (err) {
      console.error("Failed to save PII store", err);
    }
  }

  /**
   * Encrypt and store a value
   * @param {string} key 
   * @param {string} value 
   */
  set(key, value) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn("SafeStorage is not available. Storing in plain text (UNSAFE).");
      this.store[key] = value;
    } else {
      const buffer = safeStorage.encryptString(value);
      this.store[key] = buffer.toString('base64');
    }
    this._saveStore();
  }

  /**
   * Retrieve and decrypt a value
   * @param {string} key 
   * @returns {string|null}
   */
  get(key) {
    const encryptedBase64 = this.store[key];
    if (!encryptedBase64) return null;

    if (!safeStorage.isEncryptionAvailable()) {
      return encryptedBase64; // Fallback plain text
    }

    try {
      const buffer = Buffer.from(encryptedBase64, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (err) {
      console.error("Failed to decrypt PII for key:", key, err);
      return null;
    }
  }

  /**
   * Delete a stored value
   * @param {string} key 
   */
  delete(key) {
    delete this.store[key];
    this._saveStore();
  }

  /**
   * Get all stored keys without revealing values.
   * Useful for the agent to know what it already has access to.
   * @returns {string[]}
   */
  getAvailableKeys() {
    return Object.keys(this.store);
  }
}

module.exports = new PIIManager();
