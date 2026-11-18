const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DesktopAuthSession } = require("../../src/main/desktop-auth-session.cjs");
const { hasSecureStorage } = require("../../src/main/secure-storage.cjs");

const account = {
  token: "fixture-bearer",
  user: { id: "fixture-account", email: "account@example.invalid" }
};

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-account-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "account.json");
  const key = crypto.randomBytes(32);
  const secureStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString(plaintext) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(encoded) {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, encoded.subarray(0, 12));
      decipher.setAuthTag(encoded.subarray(12, 28));
      return Buffer.concat([decipher.update(encoded.subarray(28)), decipher.final()]).toString("utf8");
    }
  };
  function open(options) {
    return new DesktopAuthSession({ filePath, secureStorage, platform: "linux", ...options });
  }
  return { filePath, open, secureStorage };
}

test("supported OS encryption does not accept the Linux basic-text or unknown backends", () => {
  for (const backend of ["basic_text", "unknown", "", undefined]) {
    const secureStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend };
    assert.equal(hasSecureStorage(secureStorage, "linux"), false);
  }
  for (const backend of ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]) {
    const secureStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend };
    assert.equal(hasSecureStorage(secureStorage, "linux"), true);
  }
  assert.equal(hasSecureStorage({ isEncryptionAvailable: () => true }, "darwin"), true);
  assert.equal(hasSecureStorage({ isEncryptionAvailable: () => false }, "win32"), false);
});

test("a remembered account is encrypted together and survives restart and sign-out", (t) => {
  const { filePath, open } = fixture(t);
  const first = open();
  const saved = first.save({
    ...account,
    user: { ...account.user, settings: { geminiKey: "ignore-out-of-scope-field", planConfirmed: true } },
    remember: true
  });
  assert.equal(saved.remembered, true);
  assert.equal(saved.user.settings.geminiKey, undefined);
  assert.equal(saved.user.settings.planConfirmed, true);
  const persisted = fs.readFileSync(filePath, "utf8");
  assert.equal(persisted.includes(account.token), false);
  assert.equal(persisted.includes(account.user.email), false);
  if (process.platform !== "win32") assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);

  const restarted = open();
  assert.equal(restarted.restore().token, account.token);
  restarted.clear();
  const migrated = open({ readLegacy: () => account });
  assert.equal(migrated.restore().token, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), { version: 1, encrypted: null });
});

test("unavailable encryption and an explicit temporary session survive reload only", (t) => {
  const { filePath, open, secureStorage } = fixture(t);
  const unavailable = { ...secureStorage, getSelectedStorageBackend: () => "basic_text" };
  const store = open({ secureStorage: unavailable });
  const saved = store.save({ ...account, remember: true });
  assert.equal(saved.status, "unavailable");
  assert.equal(saved.remembered, false);
  assert.equal(store.restore().token, account.token);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(open({ secureStorage: unavailable }).restore().token, null);

  const remembered = open();
  remembered.save({ ...account, remember: true });
  const other = remembered.save({ ...account, token: "new-temporary-token", remember: false });
  assert.equal(other.remembered, false);
  assert.equal(remembered.restore().token, "new-temporary-token");
  assert.equal(open().restore().token, null);
});

test("legacy import respects the local preference and a clear blocks it even without OS encryption", (t) => {
  const { open, secureStorage } = fixture(t);
  const legacy = { hasLegacy: () => true, readLegacy: () => account };
  assert.equal(open(legacy).restore({ allowLegacy: false }).token, null);
  assert.equal(open(legacy).restore().token, account.token);
  assert.equal(open().restore().token, account.token);

  open({ ...legacy, secureStorage: { isEncryptionAvailable: () => false } }).clear();
  assert.equal(open(legacy).restore().token, null);
});

test("write failures keep a fresh session temporarily or report a failed clear", (t) => {
  const { filePath, open } = fixture(t);
  const fresh = open();
  fresh.write = () => { throw new Error("fixture write failure"); };
  const saved = fresh.save({ ...account, remember: true });
  assert.equal(saved.status, "save-failed");
  assert.equal(saved.remembered, false);
  assert.equal(fresh.restore().token, account.token);

  const persisted = open();
  persisted.save({ ...account, remember: true });
  persisted.write = () => { throw new Error("fixture write failure"); };
  assert.throws(() => persisted.clear(), /Could not remove the saved Jarvis session/);
  assert.throws(() => persisted.save({ ...account, token: "another-token" }), /previously saved Jarvis session/);
  assert.equal(persisted.restore().token, account.token);
  assert.equal(open().restore().token, account.token);

  fs.writeFileSync(filePath, JSON.stringify({ version: 1, encrypted: account.token }));
  const invalid = open().restore();
  assert.equal(invalid.status, "read-failed");
  assert.equal(invalid.token, null);
});
