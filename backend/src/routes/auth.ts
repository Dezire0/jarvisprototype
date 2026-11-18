import { Hono } from "hono";
import { issueSession, requireSession, sessionSigningKey, type SessionVariables } from "../session";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../schema";
import { eq } from "drizzle-orm";

import googleSignIn, { type GoogleSignInBindings } from "./google-sign-in";

const auth = new Hono<{ Bindings: GoogleSignInBindings; Variables: SessionVariables }>();
auth.use("/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  if (!sessionSigningKey(c.env)) return c.json({ error: "Account service is unavailable" }, 503);
  await next();
});

// Password hashing utility using Web Crypto API
async function hashPassword(password: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

auth.post("/register", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "Invalid registration data" }, 400);
  }

  const { email, password, name } = body as Record<string, unknown>;
  const address = typeof email === "string" ? email.trim() : "";
  if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ||
      typeof password !== "string" || !password.trim() || password.length > 1024 ||
      (name != null && (typeof name !== "string" || name.trim().length > 120))) {
    return c.json({ error: "Enter a valid email, password, and optional name" }, 400);
  }

  const db = drizzle(c.env.DB);
  const hashedPassword = await hashPassword(password);
  try {
    const inserted = await db.insert(users).values({
      id: crypto.randomUUID(),
      email: address,
      passwordHash: hashedPassword,
      name: typeof name === "string" ? name.trim() || null : null,
      plan: "free",
    }).onConflictDoNothing({ target: users.email }).returning({ id: users.id });

    if (!inserted.length) return c.json({ error: "Email already exists" }, 409);
    return c.json({ success: true, message: "User registered successfully" });
  } catch (error) {
    console.error("Registration failed", error instanceof Error ? error.name : "Unknown error");
    return c.json({ error: "Registration failed" }, 500);
  }
});

auth.post("/login", async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "Invalid sign-in details" }, 400);
  }

  const { email, password } = body as Record<string, unknown>;
  const address = typeof email === "string" ? email.trim() : "";
  if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ||
      typeof password !== "string" || !password || password.length > 1024) {
    return c.json({ error: "Invalid sign-in details" }, 400);
  }

  const key = sessionSigningKey(c.env);
  if (!key) return c.json({ error: "Account service is unavailable" }, 503);
  try {
    const db = drizzle(c.env.DB);
    const [user] = await db.select().from(users).where(eq(users.email, address));
    if (!user || user.passwordHash !== await hashPassword(password)) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const token = await issueSession(user, key);
    return c.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
      hasGeminiKey: Boolean(user.geminiApiKeyEncrypted),
    });
  } catch {
    console.error("Sign-in failed");
    return c.json({ error: "Sign-in failed" }, 500);
  }
});

auth.put("/plan", requireSession, async (c) => {
  const { id } = c.get("jwtPayload");
  const body = await c.req.json<{ plan?: unknown }>().catch(() => null);
  const plan = body?.plan;
  if (plan !== "free" && plan !== "pro") {
    return c.json({ error: "Invalid plan" }, 400);
  }

  try {
    const user = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
    if (!user) return c.json({ error: "User not found" }, 404);

    const result = await c.env.DB.prepare("UPDATE users SET plan = ? WHERE id = ?").bind(plan, id).run();
    if (!result.success) throw new Error("Plan update failed");
    return c.json({ success: true, plan });
  } catch {
    console.error("Plan update failed");
    return c.json({ error: "Could not update plan" }, 500);
  }
});

auth.route("/", googleSignIn);

export default auth;
