import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { googleSignInAttempts as attempts, users } from "../schema";
import { issueSession, sessionSigningKey, type SessionBindings } from "../session";

export type GoogleSignInBindings = SessionBindings & {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

const TTL_MS = 10 * 60 * 1000;
const cookieOptions = { httpOnly: true, secure: true, sameSite: "Lax", path: "/" } as const;
const routes = new Hono<{ Bindings: GoogleSignInBindings }>();

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const newProof = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
const proofPattern = /^[A-Za-z0-9_-]{43}$/;
const validProof = (value: unknown): value is string => typeof value === "string" && proofPattern.test(value);
const hashProof = async (value: string) =>
  toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
const cookieName = (state: string) => `__Host-jarvis-google-${state}`;

type GoogleIdentity = { subject: string; email: string; name: string | null; authoritative: boolean };

async function exchangeIdentity(
  code: string,
  verifier: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
): Promise<GoogleIdentity> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: "authorization_code",
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Google exchange failed");
  const { access_token: token } = await response.json<{ access_token?: unknown }>();
  if (typeof token !== "string" || !token || token.length > 4096) throw new Error("Google token unavailable");

  const profile = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (!profile.ok) throw new Error("Google profile unavailable");
  const { sub, email, email_verified, name, hd } = await profile.json<Record<string, unknown>>();
  if (typeof sub !== "string" || !sub || sub.length > 255 || email_verified !== true ||
      typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Google identity not verified");
  }
  const domain = email.split("@")[1].toLowerCase();
  return {
    subject: sub,
    email,
    name: typeof name === "string" ? name.trim().slice(0, 120) || null : null,
    authoritative: domain === "gmail.com" || (typeof hd === "string" && domain === hd.toLowerCase()),
  };
}

async function accountForIdentity(database: D1Database, identity: GoogleIdentity) {
  const db = drizzle(database);
  const bySubject = () => db.select().from(users).where(eq(users.googleSubject, identity.subject)).get();
  const established = await bySubject();
  if (established) return established;

  const previous = await db.select().from(users).where(eq(users.email, identity.email)).get();
  if (previous) {
    if (previous.googleSubject || previous.passwordHash !== null || !identity.authoritative) return null;
    const linked = await database.prepare(
      "UPDATE OR IGNORE users SET google_subject = ? WHERE id = ? AND google_subject IS NULL AND password_hash IS NULL RETURNING id",
    ).bind(identity.subject, previous.id).first();
    return linked ? previous : await bySubject();
  }

  const [created] = await db.insert(users).values({
    id: crypto.randomUUID(), email: identity.email, googleSubject: identity.subject, name: identity.name, plan: "free",
  }).onConflictDoNothing().returning();
  return created ?? await bySubject();
}

routes.post("/google/attempt", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.json({ error: "Google sign-in is unavailable" }, 503);
  }
  const body = await c.req.json<{ challenge?: unknown }>().catch(() => null);
  if (!validProof(body?.challenge)) return c.json({ error: "Invalid sign-in request" }, 400);
  const now = Date.now();
  const id = newProof();
  const db = drizzle(c.env.DB);
  await db.batch([
    db.delete(attempts).where(lte(attempts.expiresAt, now)),
    db.insert(attempts).values({ id, clientChallenge: body.challenge, status: "created", expiresAt: now + TTL_MS }),
  ]);
  return c.json({ attempt: id, expiresInMs: TTL_MS }, 201);
});

routes.get("/google", async (c) => {
  const id = c.req.query("attempt");
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = c.env;
  if (!clientId || !clientSecret) return c.json({ error: "Google sign-in is unavailable" }, 503);
  if (!validProof(id)) return c.redirect("/api/auth/google/result?status=failed", 303);

  const verifier = newProof();
  const challenge = await hashProof(verifier);
  const redirectUri = new URL("/api/auth/google-callback", c.req.url).toString();
  const [started] = await drizzle(c.env.DB).update(attempts).set({
    browserChallenge: challenge, redirectUri, status: "browser",
  }).where(and(eq(attempts.id, id), eq(attempts.status, "created"), gt(attempts.expiresAt, Date.now()))).returning({ id: attempts.id });
  if (!started) return c.redirect("/api/auth/google/result?status=failed", 303);
  setCookie(c, cookieName(id), verifier, { ...cookieOptions, maxAge: TTL_MS / 1000 });

  const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  target.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code",
    scope: "openid email profile", state: id, code_challenge: challenge, code_challenge_method: "S256",
  }).toString();
  return c.redirect(target.toString());
});

routes.get("/google-callback", async (c) => {
  const id = c.req.query("state");
  const code = c.req.query("code");
  if (!validProof(id)) return c.redirect("/api/auth/google/result?status=failed", 303);
  const verifier = getCookie(c, cookieName(id));
  if (!validProof(verifier)) return c.redirect("/api/auth/google/result?status=failed", 303);
  const db = drizzle(c.env.DB);
  const [active] = await db.update(attempts).set({
    status: "processing", browserChallenge: null,
  }).where(and(
    eq(attempts.id, id), eq(attempts.status, "browser"),
    eq(attempts.browserChallenge, await hashProof(verifier)), gt(attempts.expiresAt, Date.now()),
  )).returning({ redirectUri: attempts.redirectUri });
  if (!active?.redirectUri) return c.redirect("/api/auth/google/result?status=failed", 303);
  deleteCookie(c, cookieName(id), cookieOptions);

  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = c.env;
  let identity: GoogleIdentity | null = null;
  if (clientId && clientSecret && code && code.length <= 2048 && !c.req.query("error")) {
    try {
      identity = await exchangeIdentity(code, verifier, active.redirectUri, clientId, clientSecret);
    } catch {
      console.warn("Google identity exchange did not complete");
    }
  }

  const [updated] = await db.update(attempts).set({
    status: identity ? "ready" : "failed", redirectUri: null,
    identityJson: identity ? JSON.stringify(identity) : null,
  }).where(and(eq(attempts.id, id), eq(attempts.status, "processing"), gt(attempts.expiresAt, Date.now())))
    .returning({ id: attempts.id });
  return c.redirect(`/api/auth/google/result?status=${identity && updated ? "ready" : "failed"}`, 303);
});

routes.post("/google/complete", async (c) => {
  const body = await c.req.json<{ attempt?: unknown; verifier?: unknown }>().catch(() => null);
  if (!validProof(body?.attempt) || !validProof(body?.verifier)) return c.json({ error: "Invalid sign-in request" }, 400);
  const key = sessionSigningKey(c.env);
  if (!key) return c.json({ error: "Account service is unavailable" }, 503);
  const db = drizzle(c.env.DB);
  const target = and(eq(attempts.id, body.attempt), eq(attempts.clientChallenge, await hashProof(body.verifier)),
    gt(attempts.expiresAt, Date.now()));
  const [settled] = await db.delete(attempts).where(and(target, inArray(attempts.status, ["ready", "failed"])))
    .returning({ identity: attempts.identityJson });
  if (!settled) {
    const pending = await db.select({ id: attempts.id }).from(attempts)
      .where(and(target, inArray(attempts.status, ["created", "browser", "processing", "ready", "failed"]))).get();
    return pending ? c.json({ status: "pending" }, 202) : c.json({ error: "Sign-in attempt expired" }, 404);
  }
  if (!settled.identity) return c.json({ error: "Google sign-in did not complete" }, 409);

  const account = await accountForIdentity(c.env.DB, JSON.parse(settled.identity) as GoogleIdentity);
  if (!account) return c.json({ error: "This Google account needs to be linked", code: "link_required" }, 409);
  return c.json({
    token: await issueSession(account, key),
    user: { id: account.id, email: account.email, name: account.name, plan: account.plan },
  });
});

routes.post("/google/cancel", async (c) => {
  const body = await c.req.json<{ attempt?: unknown; verifier?: unknown }>().catch(() => null);
  if (!validProof(body?.attempt) || !validProof(body?.verifier)) return c.json({ error: "Invalid sign-in request" }, 400);
  await drizzle(c.env.DB).delete(attempts).where(and(
    eq(attempts.id, body.attempt), eq(attempts.clientChallenge, await hashProof(body.verifier)),
  ));
  return c.body(null, 204);
});

routes.get("/google/result", (c) => {
  const ready = c.req.query("status") === "ready";
  const ko = c.req.header("Accept-Language")?.toLowerCase().startsWith("ko");
  const title = ready ? (ko ? "Jarvis로 돌아가세요" : "Return to Jarvis")
    : (ko ? "로그인이 완료되지 않았습니다" : "Sign-in did not finish");
  const message = ready ? (ko ? "로그인을 시작한 창에서 계속하세요." : "Continue in the window where you started sign-in.")
    : (ko ? "Jarvis에서 다시 시도할 수 있습니다." : "You can try again from Jarvis.");
  c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  return c.html(`<!doctype html>
<html lang="${ko ? "ko" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>:root{color-scheme:light dark;font-family:system-ui,sans-serif} main{max-width:28rem;margin:15vh auto;padding:1.5rem} h1{font-size:1.5rem} p{line-height:1.5}</style>
</head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`);
});

export default routes;
