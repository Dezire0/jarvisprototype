const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { CredentialStore } = require("../../src/main/credential-store.cjs");

function createSafeStorageStub() {
  return {
    isEncryptionAvailable() {
      return true;
    },
    encryptString(text) {
      return Buffer.from(`enc:${text}`, "utf8");
    },
    decryptString(buffer) {
      return Buffer.from(buffer).toString("utf8").replace(/^enc:/, "");
    }
  };
}

function createSecurityStub() {
  const passwords = new Map();

  return {
    passwords,
    async execFile(command, args) {
      assert.equal(command, "security");
      const action = args[0];
      const service = args[args.indexOf("-s") + 1];
      const account = args[args.indexOf("-a") + 1];
      const key = `${service}::${account}`;

      if (action === "add-generic-password") {
        passwords.set(key, args[args.indexOf("-w") + 1]);
        return { stdout: "" };
      }

      if (action === "find-generic-password") {
        if (!passwords.has(key)) {
          const error = new Error("The specified item could not be found in the keychain.");
          error.code = 44;
          error.stderr = "The specified item could not be found in the keychain.";
          throw error;
        }

        return { stdout: `${passwords.get(key)}\n` };
      }

      if (action === "delete-generic-password") {
        if (!passwords.has(key)) {
          const error = new Error("The specified item could not be found in the keychain.");
          error.code = 44;
          error.stderr = "The specified item could not be found in the keychain.";
          throw error;
        }

        passwords.delete(key);
        return { stdout: "" };
      }

      throw new Error(`Unsupported security action: ${action}`);
    }
  };
}

test("CredentialStore migrates the legacy Electron vault into the shared Friday vault", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-credential-store-"));
  const sharedVaultDir = path.join(tempRoot, "shared");
  const userDataDir = path.join(tempRoot, "user-data");
  const safeStorage = createSafeStorageStub();
  const security = createSecurityStub();

  await fs.mkdir(userDataDir, { recursive: true });
  await fs.writeFile(
    path.join(userDataDir, "jarvis-credentials.json"),
    JSON.stringify(
      {
        version: 1,
        entries: {
          "example.com": {
            site: "example.com",
            loginUrl: "https://example.com/login",
            username: "pepper",
            password: safeStorage.encryptString("rescue-armor").toString("base64"),
            updatedAt: "2026-04-14T12:00:00.000Z"
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const store = new CredentialStore({
    app: {
      getPath(name) {
        assert.equal(name, "userData");
        return userDataDir;
      }
    },
    safeStorage,
    execFileImpl: security.execFile,
    sharedVaultDir
  });

  const credential = await store.getCredential("example.com");
  const sharedVault = JSON.parse(await fs.readFile(path.join(sharedVaultDir, "credentials.json"), "utf8"));

  assert.equal(credential.username, "pepper");
  assert.equal(credential.password, "rescue-armor");
  assert.equal(sharedVault.entries["example.com"].loginUrl, "https://example.com/login");
  assert.equal(
    security.passwords.get("friday-jarvis-prototype::example.com:password"),
    "rescue-armor"
  );
});

test("CredentialStore save and delete use the shared vault and keychain backend", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-credential-store-"));
  const sharedVaultDir = path.join(tempRoot, "shared");
  const userDataDir = path.join(tempRoot, "user-data");
  const security = createSecurityStub();

  const store = new CredentialStore({
    app: {
      getPath() {
        return userDataDir;
      }
    },
    safeStorage: createSafeStorageStub(),
    execFileImpl: security.execFile,
    sharedVaultDir
  });

  await store.saveCredential({
    site: "github.com",
    loginUrl: "https://github.com/login",
    username: "tony",
    password: "mk42"
  });

  const listed = await store.listCredentials();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].site, "github.com");
  assert.equal(await store.getCredential("github.com").then((item) => item.password), "mk42");

  const deleted = await store.deleteCredential("github.com");
  assert.equal(deleted.deleted, true);
  assert.equal(await store.getCredential("github.com"), null);
});
