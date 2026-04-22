import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../schema";
import { eq } from "drizzle-orm";

type Bindings = { DB: D1Database; JWT_SECRET: string };
type Variables = { jwtPayload: { id: string } };

const settings = new Hono<{ Bindings: Bindings; Variables: Variables }>();

settings.use("/*", (c, next) => {
  const jwtMiddleware = jwt({
    secret: c.env.JWT_SECRET || "fallback-secret",
    alg: "HS256",
  });
  return jwtMiddleware(c, next);
});

// GET /api/settings/plan — Get user's current plan
settings.get("/plan", async (c) => {
  const payload = c.get("jwtPayload");
  const db = drizzle(c.env.DB);

  const userList = await db.select().from(users).where(eq(users.id, payload.id));
  const user = userList[0];

  if (!user) return c.json({ error: "User not found" }, 404);

  return c.json({ success: true, plan: user.plan });
});

// GET /api/settings/profile — Get user profile
settings.get("/profile", async (c) => {
  const payload = c.get("jwtPayload");
  const db = drizzle(c.env.DB);

  const userList = await db.select().from(users).where(eq(users.id, payload.id));
  const user = userList[0];

  if (!user) return c.json({ error: "User not found" }, 404);

  const today = new Date().toISOString().slice(0, 10);
  const usedToday = user.lastMessageDate === today ? user.dailyMessageCount : 0;

  return c.json({
    success: true,
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    usage: {
      today: usedToday,
      limit: user.plan === "pro" ? null : 15,
    },
  });
});

// PATCH /api/settings/profile — Update user name
settings.patch("/profile", async (c) => {
  const payload = c.get("jwtPayload");
  const db = drizzle(c.env.DB);
  const { name } = await c.req.json<{ name?: string }>();

  if (!name?.trim()) return c.json({ error: "Name is required" }, 400);

  await db.update(users).set({ name: name.trim() }).where(eq(users.id, payload.id));

  return c.json({ success: true });
});

export default settings;
