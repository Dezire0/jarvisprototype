import { Hono } from "hono";
import { sign } from "hono/jwt";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../schema";
import { eq } from "drizzle-orm";

const auth = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string } }>();

// Password hashing utility using Web Crypto API
async function hashPassword(password: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

auth.post("/register", async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  const db = drizzle(c.env.DB);
  const hashedPassword = await hashPassword(password);
  const userId = crypto.randomUUID();

  try {
    await db.insert(users).values({
      id: userId,
      email,
      passwordHash: hashedPassword,
    });
    return c.json({ success: true, message: "User registered successfully" });
  } catch (error: any) {
    if (error.message.includes("UNIQUE constraint failed")) {
      return c.json({ error: "Email already exists" }, 409);
    }
    return c.json({ error: "Registration failed" }, 500);
  }
});

auth.post("/login", async (c) => {
  const { email, password } = await c.req.json();
  const db = drizzle(c.env.DB);
  
  const userList = await db.select().from(users).where(eq(users.email, email));
  const user = userList[0];

  if (!user) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const hashedPassword = await hashPassword(password);
  if (user.passwordHash !== hashedPassword) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const token = await sign(
    { id: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }, // 7 days
    c.env.JWT_SECRET || "fallback-secret"
  );

  return c.json({ success: true, token, user: { id: user.id, email: user.email } });
});

export default auth;
