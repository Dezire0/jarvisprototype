import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../schema";
import { eq } from "drizzle-orm";
import { encryptApiKey, decryptApiKey } from "../crypto";

const settings = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string }; Variables: { jwtPayload: { id: string } } }>();

// JWT auth required for all settings routes
settings.use("/*", (c, next) => {
  const jwtMiddleware = jwt({
    secret: c.env.JWT_SECRET || "fallback-secret",
    alg: "HS256",
  });
  return jwtMiddleware(c, next);
});

// GET /api/settings/gemini-key — Retrieve stored Gemini API key
settings.get("/gemini-key", async (c) => {
  const payload = c.get("jwtPayload");
  const db = drizzle(c.env.DB);

  const userList = await db.select().from(users).where(eq(users.id, payload.id));
  const user = userList[0];

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const decrypted = user.geminiApiKeyEncrypted
    ? await decryptApiKey(user.geminiApiKeyEncrypted, c.env.JWT_SECRET || "fallback-secret")
    : "";

  return c.json({
    success: true,
    hasKey: Boolean(decrypted),
    // Return masked key for display, full key for use
    maskedKey: decrypted ? `${decrypted.slice(0, 6)}...${decrypted.slice(-4)}` : null,
    key: decrypted || null,
  });
});

// POST /api/settings/gemini-key — Save Gemini API key
settings.post("/gemini-key", async (c) => {
  const payload = c.get("jwtPayload");
  const { key } = await c.req.json();
  const db = drizzle(c.env.DB);

  if (!key || typeof key !== "string" || key.trim().length < 10) {
    return c.json({ error: "A valid API key is required" }, 400);
  }

  const encrypted = await encryptApiKey(key.trim(), c.env.JWT_SECRET || "fallback-secret");

  await db
    .update(users)
    .set({ geminiApiKeyEncrypted: encrypted })
    .where(eq(users.id, payload.id));

  return c.json({ success: true, message: "Gemini API key saved" });
});

// DELETE /api/settings/gemini-key — Remove Gemini API key
settings.delete("/gemini-key", async (c) => {
  const payload = c.get("jwtPayload");
  const db = drizzle(c.env.DB);

  await db
    .update(users)
    .set({ geminiApiKeyEncrypted: null })
    .where(eq(users.id, payload.id));

  return c.json({ success: true, message: "Gemini API key removed" });
});

export default settings;
