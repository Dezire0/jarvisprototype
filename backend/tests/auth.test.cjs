const assert = require("node:assert/strict");
const { execFile, spawn } = require("node:child_process");
const { createHash, randomBytes } = require("node:crypto");
const { sign } = require("hono/jwt");
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

test("Worker sessions use a required private key and keep existing D1 accounts", { timeout: 75000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "jarvis-test-auth-"));
  const persist = path.join(dir, "state");
  const config = path.join(dir, "wrangler.json");
  const migrations = path.join(dir, "migrations");
  let worker;
  let exited;
  async function stopWorker() {
    if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
    worker.kill("SIGTERM");
    await Promise.race([exited, sleep(3000)]);
    if (worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGKILL");
      await exited;
    }
  }
  t.after(async () => {
    await stopWorker();
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(migrations);
  for (const migration of ["0000_milky_rockslide.sql", "0001_add_gemini_key.sql"]) {
    await copyFile(path.join(backend, "migrations", migration), path.join(migrations, migration));
  }
  const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
  async function configure(key) {
    await writeFile(config, JSON.stringify({
      name: "jarvis-auth-contract-test",
      compatibility_date: "2024-04-05",
      main: path.join(backend, "src/index.ts"),
      ...(key !== undefined && { vars: { JARVIS_SESSION_SIGNING_KEY: key } }),
      d1_databases: [{
        binding: "DB",
        database_name: "jarvis-auth-test-db",
        database_id: "00000000-0000-4000-8000-000000000001",
        migrations_dir: migrations,
      }],
    }), { mode: 0o600 });
  }
  await configure();

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

  let output = "";
  async function startWorker() {
    const port = await localPort();
    worker = spawn(process.execPath, [
      wrangler, "dev", ...localArguments, "--ip", "127.0.0.1", "--port", String(port),
    ], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    output = "";
    for (const readable of [worker.stdout, worker.stderr]) {
      readable.on("data", (chunk) => { output = (output + chunk).slice(-16000); });
    }
    exited = new Promise((resolve) => worker.once("close", resolve));

    const url = "http://127.0.0.1:" + port;
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && worker.exitCode === null) {
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(800) })).ok) return url;
      } catch {}
      await sleep(100);
    }
    assert.fail("Local Worker did not start");
  }
  let base = await startWorker();

  const post = (route, data) => fetch(base + "/api/auth/" + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(3000),
  });
  const authenticated = (route, token, options = {}) => fetch(base + route, {
    ...options,
    headers: { ...options.headers, Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(3000),
  });
  const profileRoute = "/api/settings/profile";
  const registration = { email: "new@example.invalid", password: "fixture-password", name: " New User " };
  assert.equal((await post("login", registration)).status, 503);
  assert.equal((await post("register", registration)).status, 503);
  assert.equal((await fetch(base + profileRoute)).status, 503);
  assert.equal((await fetch(base + "/api/auth/google", { redirect: "manual" })).status, 503);
  await stopWorker();

  await configure("invalid-fixture-binding");
  base = await startWorker();
  assert.equal((await post("login", registration)).status, 503);
  assert.equal((await fetch(base + "/api/chat/threads")).status, 503);
  await stopWorker();

  const signingKey = randomBytes(32).toString("hex");
  await configure(signingKey);
  base = await startWorker();
  assert.equal((await post("register", null)).status, 400);
  assert.equal((await post("register", { email: "invalid", password: {} })).status, 400);
  const responses = await Promise.all([post("register", registration), post("register", registration)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);

  assert.equal((await post("login", null)).status, 400);
  assert.equal((await post("login", { email:"missing", password: 42 })).status, 400);
  const signIn = await post("login", registration);
  assert.equal(signIn.status, 200);
  assert.equal(signIn.headers.get("cache-control"), "no-store");
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

  const profile = await authenticated(profileRoute, account.token);
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).name, "New User");
  const expectedError = { error: "Unauthorized: Invalid session" };
  for (const route of [profileRoute, "/api/chat/threads", "/api/ai/usage"]) {
    const missing = await fetch(base + route);
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), expectedError);
  }

  const now = Math.floor(Date.now() / 1000);
  const fixture = { id: account.user.id, iss:"jarvis-auth-service", aud:"jarvis-workspace", exp:now + 60 };
  const expired = await sign({ ...fixture, exp:now - 60 }, signingKey, "HS256");
  const otherAudience = await sign({ ...fixture, aud:"another-fixture" }, signingKey, "HS256");
  const noExpiry = await sign({ id:fixture.id, iss:fixture.iss, aud:fixture.aud }, signingKey, "HS256");
  for (const token of ["invalid-fixture", expired, otherAudience, noExpiry]) {
    const result = await authenticated(profileRoute, token);
    assert.equal(result.status, 401);
    assert.deepEqual(await result.json(), expectedError);
  }
  const planRoute = "/api/auth/plan";
  const options = { method:"PUT", headers:{"Content-Type":"application/json"} };
  const malformedPlan = await authenticated(planRoute, account.token, { ...options, body:"{" });
  assert.equal(malformedPlan.status, 400);
  const plan = await authenticated(planRoute, account.token, { ...options, body:'{"plan":"free"}' });
  assert.equal(plan.status, 200);
  assert.equal((await authenticated("/api/ai/usage", account.token)).status, 200);
  const sync = await authenticated("/api/chat/sync", account.token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId: "owner-fixture-thread",
      title: "Owner fixture thread",
      messages: [{ id: "owner-fixture-message", role: "user", text: "Synthetic conversation", createdAt: Date.now() }],
    }),
  });
  assert.equal(sync.status, 200);
  const threads = await authenticated("/api/chat/threads", account.token);
  assert.equal(threads.status, 200);
  assert.deepEqual((await threads.json()).threads.map(({ id }) => id), ["owner-fixture-thread"]);
  const separateThreads = await authenticated("/api/chat/threads", legacy.token);
  assert.equal(separateThreads.status, 200);
  assert.deepEqual((await separateThreads.json()).threads, []);

  const querySentinel = "synthetic-private-query-fixture";
  const badCallback = await fetch(base + "/api/auth/google-callback?state=" + querySentinel);
  assert.equal(badCallback.status, 400);
  assert.equal(badCallback.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(await badCallback.json(), { error: "No code provided" });
  const appLogLines = output.split("\n").filter((line) => line.includes("[REQUEST]"));
  assert.ok(appLogLines.length > 0, "Expected API request events");
  assert.ok(appLogLines.every((line) => /\[REQUEST\] [A-Z]+ [0-9]{3}\s*$/.test(line)));
  assert.ok(appLogLines.every((line) => !line.includes(querySentinel) && !line.includes(account.token)));

  await stopWorker();
  await configure(randomBytes(32).toString("hex"));
  base = await startWorker();
  for (const route of [profileRoute, "/api/chat/threads", "/api/ai/usage"]) {
    const stale = await authenticated(route, account.token);
    assert.equal(stale.status, 401);
    assert.deepEqual(await stale.json(), expectedError);
  }
  const signedInAgain = await post("login", registration);
  assert.equal(signedInAgain.status, 200);
  const renewed = await signedInAgain.json();
  assert.equal(renewed.user.id, account.user.id);
  assert.equal((await authenticated(profileRoute, renewed.token)).status, 200);
  const restored = await authenticated("/api/chat/threads", renewed.token);
  assert.equal(restored.status, 200);
  assert.deepEqual((await restored.json()).threads.map(({ id }) => id), ["owner-fixture-thread"]);
});
