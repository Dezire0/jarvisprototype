const assert = require("node:assert/strict");
const { execFile, spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { copyFile, mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const { createServer } = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");
const { promisify } = require("node:util");
const { test } = require("node:test");

const execute = promisify(execFile);
const backend = path.join(__dirname, "..");
const wrangler = require.resolve("wrangler/bin/wrangler.js");
const legacyHash = createHash("sha256").update("fixture-password").digest("hex");

async function localPort() {
  const socket = createServer();
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const { port } = socket.address();
      socket.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

test("Worker auth uses local D1 for registration, login, duplicates, and key status", { timeout: 45000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "jarvis-test-auth-"));
  const persist = path.join(dir, "state");
  const config = path.join(dir, "wrangler.json");
  const migrations = path.join(dir, "migrations");
  let worker;
  let exited;
  t.after(async () => {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGTERM");
      await Promise.race([exited, sleep(3000)]);
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill("SIGKILL");
        await exited;
      }
    }
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(migrations);
  for (const migration of ["0000_milky_rockslide.sql", "0001_add_gemini_key.sql"]) {
    await copyFile(path.join(backend, "migrations", migration), path.join(migrations, migration));
  }
  const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
  await writeFile(config, JSON.stringify({
    name: "jarvis-auth-contract-test",
    compatibility_date: "2024-04-05",
    main: path.join(backend, "src/index.ts"),
    d1_databases: [{
      binding: "DB",
      database_name: "jarvis-auth-test-db",
      database_id: "00000000-0000-4000-8000-000000000001",
      migrations_dir: migrations,
    }],
  }));

  const localArguments = ["--config", config, "--local", "--persist-to", persist];
  await execute(process.execPath, [wrangler, "d1", "migrations", "apply", "DB", ...localArguments], { cwd: dir, env });

  await execute(process.execPath, [
    wrangler, "d1", "execute", "DB", ...localArguments,
    "--command",
    "INSERT INTO users (id, email, password_hash, gemini_api_key_encrypted) " +
    "VALUES ('legacy-fixture', 'legacy@example.invalid', '" + legacyHash + "', 'synthetic-ciphertext')",
  ], { cwd: dir, env });

  const profileMigration = "0002_restore_user_profile.sql";
  await copyFile(path.join(backend, "migrations", profileMigration), path.join(migrations, profileMigration));
  await execute(process.execPath, [wrangler, "d1", "migrations", "apply", "DB", ...localArguments], { cwd: dir, env });

  const port = await localPort();
  worker = spawn(process.execPath, [
    wrangler, "dev", ...localArguments, "--ip", "127.0.0.1", "--port", String(port),
  ], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const readable of [worker.stdout, worker.stderr]) {
    readable.on("data", (chunk) => { output = (output + chunk).slice(-16000); });
  }
  exited = new Promise((resolve) => worker.once("close", resolve));

  const base = "http://127.0.0.1:" + port;
  const deadline = Date.now() + 12000;
  let ready = false;
  while (!ready && Date.now() < deadline && worker.exitCode === null) {
    try {
      ready = (await fetch(base, { signal: AbortSignal.timeout(800) })).ok;
    } catch {
      await sleep(100);
    }
  }
  assert.ok(ready, output);

  const post = (route, data) => fetch(base + "/api/auth/" + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(3000),
  });

  assert.equal((await post("register", null)).status, 400);
  assert.equal((await post("register", { email: "invalid", password: {} })).status, 400);
  const registration = { email: "new@example.invalid", password: "fixture-password", name: " New User " };
  const responses = await Promise.all([post("register", registration), post("register", registration)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);

  const signIn = await post("login", registration);
  assert.equal(signIn.status, 200);
  const account = await signIn.json();
  assert.equal(account.user.name, "New User");
  assert.equal(account.user.plan, "free");
  assert.equal(account.hasGeminiKey, false);

  const legacyLogin = await post("login", { email: "legacy@example.invalid", password: "fixture-password" });
  assert.equal(legacyLogin.status, 200);
  const legacy = await legacyLogin.json();
  assert.equal(legacy.hasGeminiKey, true);
  assert.equal(legacy.user.plan, "free");
  assert.equal(JSON.stringify(legacy).includes("synthetic-ciphertext"), false);
  assert.equal((await post("login", { ...registration, password: "wrong" })).status, 401);

  const profile = await fetch(base + "/api/settings/profile", { headers: { Authorization: "Bearer " + account.token } });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).name, "New User");
});
