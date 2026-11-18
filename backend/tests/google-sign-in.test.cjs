const assert = require("node:assert/strict");
const { createHash, randomBytes } = require("node:crypto");
const { readFile, readdir } = require("node:fs/promises");
const { createRequire } = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, Response } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const backend = path.join(__dirname, "..");
const origin = "https://jarvis-test.example.invalid";
const makeProof = () => randomBytes(32).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("base64url");

test("the original window redeems Google sign-in once and keeps existing account identity", {timeout:30000}, async (t) => {
  let profile = { sub:"fixture-google-subject", email:"fixture@gmail.com", email_verified:true, name:"Fixture" };
  let tokenRequests = 0;
  let profileRequests = 0;
  let lastProviderExchange;
  const script = await build({
    entryPoints:[path.join(backend, "src/index.ts")],
    bundle:true,
    format:"esm",
    target:"es2022",
    write:false,
    logLevel:"silent",
  });
  const worker = new Miniflare({
    modules:true,
    script:script.outputFiles[0].text,
    compatibilityDate:"2024-04-05",
    bindings:{
      JARVIS_SESSION_SIGNING_KEY:randomBytes(32).toString("hex"),
      GOOGLE_CLIENT_ID:"fixture-google-client",
      GOOGLE_CLIENT_SECRET:"fixture-google-secret",
    },
    d1Databases:["DB"],
    async outboundService(request) {
      const url = new URL(request.url);
      if (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token" && request.method === "POST") {
        tokenRequests++;
        lastProviderExchange = new URLSearchParams(await request.text());
        return Response.json({access_token:"inert-provider-token"});
      }
      if (url.origin === "https://www.googleapis.com" && url.pathname === "/oauth2/v3/userinfo" &&
          request.headers.get("authorization") === "Bearer inert-provider-token") {
        profileRequests++;
        return Response.json(profile);
      }
      return new Response(null, {status:502});
    },
  });
  t.after(() => worker.dispose());
  const db = await worker.getD1Database("DB");
  const migrationDir = path.join(backend, "migrations");
  for (const name of (await readdir(migrationDir)).filter(name => name.endsWith(".sql")).sort()) {
    const sql = await readFile(path.join(migrationDir, name), "utf8");
    await db.batch(sql.split("--> statement-breakpoint").map(line => line.trim()).filter(Boolean).map(line => db.prepare(line)));
  }
  await db.prepare("INSERT INTO users (id,email,name) VALUES (?,?,?)").bind("legacy-google-id", profile.email, "Previous name").run();
  await db.prepare("INSERT INTO users (id,email,password_hash) VALUES (?,?,?)")
    .bind("email-account", "protected-fixture@gmail.com", "test-placeholder").run();

  function request(route, options) {
    return worker.dispatchFetch(origin + route, { redirect:"manual", ...options });
  }
  function post(route, data) {
    return request("/api/auth/google/" + route, {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data),
    });
  }
  async function begin() {
    const verifier = makeProof();
    const response = await post("attempt", {challenge:hash(verifier)});
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const { attempt, expiresInMs } = await response.json();
    assert.match(attempt, /^[\w-]{43}$/);
    assert.equal(expiresInMs, 600000);
    return { attempt, verifier };
  }
  async function authorization(attempt) {
    const response = await request("/api/auth/google?attempt=" + attempt);
    assert.equal(response.status, 302);
    const redirect = new URL(response.headers.get("location"));
    assert.equal(redirect.origin, "https://accounts.google.com");
    assert.equal(redirect.searchParams.get("state"), attempt);
    assert.equal(redirect.searchParams.get("code_challenge_method"), "S256");
    assert.equal(redirect.searchParams.get("redirect_uri"), origin + "/api/auth/google-callback");
    const set = response.headers.get("set-cookie");
    assert.match(set, /HttpOnly/);
    assert.match(set, /Secure/);
    assert.match(set, /SameSite=Lax/i);
    const cookie = set.split(";")[0];
    const cookieValue = cookie.split("=")[1];
    assert.equal(redirect.searchParams.get("code_challenge"), hash(cookieValue));
    return cookie;
  }
  function returnFromGoogle(attempt, cookie, parameter = "code=synthetic-provider-code") {
    return request("/api/auth/google-callback?state=" + attempt + "&" + parameter, {
      headers: cookie ? {Cookie:cookie} : {},
    });
  }

  const initial = await begin();
  assert.equal((await post("complete", initial)).status, 202);
  const browser = await authorization(initial.attempt);
  const unrelated = await returnFromGoogle(initial.attempt);
  assert.equal(unrelated.headers.get("location"), "/api/auth/google/result?status=failed");
  assert.equal(tokenRequests, 0);
  const completed = await returnFromGoogle(initial.attempt, browser);
  assert.equal(completed.status, 303);
  const row = await db.prepare("SELECT status FROM google_sign_in_attempts WHERE id = ?").bind(initial.attempt).first();
  assert.equal(completed.headers.get("location"), "/api/auth/google/result?status=ready",
    JSON.stringify({ tokenRequests, profileRequests, status: row?.status }));
  assert.match(completed.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(lastProviderExchange.get("code_verifier"), browser.split("=")[1]);
  assert.equal(lastProviderExchange.get("redirect_uri"), origin + "/api/auth/google-callback");
  assert.equal(profileRequests, 1);
  assert.equal((await returnFromGoogle(initial.attempt, browser)).headers.get("location"), "/api/auth/google/result?status=failed");
  assert.equal(tokenRequests, 1);
  assert.equal((await post("complete", {...initial, verifier:makeProof()})).status, 404);

  const redeemed = await Promise.all([post("complete", initial), post("complete", initial)]);
  assert.deepEqual(redeemed.map(response => response.status).sort(), [200,404]);
  const session = await redeemed.find(response => response.ok).json();
  assert.equal(session.user.id, "legacy-google-id");
  assert.equal(session.user.name, "Previous name");
  const current = await request("/api/settings/profile", {headers:{Authorization:"Bearer " + session.token}});
  assert.equal(current.status, 200);
  assert.equal((await current.json()).id, "legacy-google-id");
  const page = await request(completed.headers.get("location"));
  const html = await page.text();
  assert.match(html, /Return to Jarvis/);
  assert.ok(!html.includes(session.token) && !html.includes(profile.email));
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");

  profile = {...profile, email:"renamed-fixture@gmail.com"};
  const repeated = await begin();
  await returnFromGoogle(repeated.attempt, await authorization(repeated.attempt));
  assert.equal((await (await post("complete", repeated)).json()).user.id, "legacy-google-id");

  profile = {...profile, sub:"new-google-subject", email:"new-fixture@gmail.com", name:"New fixture name"};
  const newAccount = await begin();
  await returnFromGoogle(newAccount.attempt, await authorization(newAccount.attempt));
  const newSession = await (await post("complete", newAccount)).json();
  assert.equal(newSession.user.name, "New fixture name");
  assert.equal(newSession.user.plan, "free");
  assert.notEqual(newSession.user.id, "legacy-google-id");

  profile = {...profile, sub:"different-google-subject", email:"protected-fixture@gmail.com"};
  const collision = await begin();
  await returnFromGoogle(collision.attempt, await authorization(collision.attempt));
  const conflict = await post("complete", collision);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "link_required");

  profile = {...profile, email:"unverified-fixture@gmail.com", email_verified:false};
  const unverified = await begin();
  const invalid = await returnFromGoogle(unverified.attempt, await authorization(unverified.attempt));
  assert.equal(invalid.headers.get("location"), "/api/auth/google/result?status=failed");
  assert.equal((await post("complete", unverified)).status, 409);

  const canceled = await begin();
  const canceledBrowser = await authorization(canceled.attempt);
  assert.equal((await post("cancel", canceled)).status, 204);
  assert.equal((await returnFromGoogle(canceled.attempt, canceledBrowser)).headers.get("location"), "/api/auth/google/result?status=failed");
  assert.equal((await post("complete", canceled)).status, 404);

  const declined = await begin();
  const declinedBrowser = await authorization(declined.attempt);
  const beforeDecline = tokenRequests;
  const rejected = await returnFromGoogle(declined.attempt, declinedBrowser, "error=access_denied");
  assert.equal(rejected.headers.get("location"), "/api/auth/google/result?status=failed");
  assert.equal((await post("complete", declined)).status, 409);
  assert.equal(tokenRequests, beforeDecline);

  const expired = await begin();
  await db.prepare("UPDATE google_sign_in_attempts SET expires_at = 1 WHERE id = ?").bind(expired.attempt).run();
  assert.equal((await post("complete", expired)).status, 404);
});
