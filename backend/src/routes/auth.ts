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
      name: name || null,
      plan: "free",
      dailyMessageCount: 0,
      dailyTokenCount: 0,
      lastMessageDate: "",
    });
    return c.json({ success: true, message: "User registered successfully" });
  } catch (error: any) {
    console.error("Registration error:", error);
    if (error.message && error.message.includes("UNIQUE constraint failed")) {
      return c.json({ error: "Email already exists" }, 409);
    }
    return c.json({ error: `Registration failed: ${error.message || "Unknown error"}` }, 500);
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

  return c.json({
    success: true,
    token,
    user: { 
      id: user.id, 
      email: user.email,
      plan: user.plan 
    },
    hasGeminiKey: Boolean(user.geminiApiKeyEncrypted),
  });
});

import { jwt } from "hono/jwt";

auth.put("/plan", async (c) => {
  // Use jwt middleware manually since it's not applied globally to /auth
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  
  let payload;
  try {
    const { verify } = await import("hono/jwt");
    payload = await verify(token, c.env.JWT_SECRET || "fallback-secret");
  } catch (e) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { plan } = await c.req.json();
  if (plan !== "free" && plan !== "pro") {
    return c.json({ error: "Invalid plan" }, 400);
  }

  const db = drizzle(c.env.DB);
  try {
    await db.update(users)
      .set({ plan })
      .where(eq(users.id, payload.id as string));
    return c.json({ success: true, plan });
  } catch (error) {
    return c.json({ error: "Failed to update plan" }, 500);
  }
});

auth.get("/google", async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google-callback`;
  
  if (!clientId) {
    return c.json({ error: "Google Client ID not configured in backend" }, 500);
  }

  const scope = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
  const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;
  
  return c.redirect(googleUrl);
});

auth.get("/google-callback", async (c) => {
  const code = c.req.query("code");
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google-callback`;

  if (!code) return c.json({ error: "No code provided" }, 400);

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok) throw new Error(tokenData.error_description || "Failed to exchange token");

    // 2. Get user info from Google
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userInfo = await userInfoRes.json() as any;

    // 3. Find or Create user in DB
    const db = drizzle(c.env.DB);
    let userList = await db.select().from(users).where(eq(users.email, userInfo.email));
    let user = userList[0];

    if (!user) {
      const userId = crypto.randomUUID();
      await db.insert(users).values({
        id: userId,
        email: userInfo.email,
        name: userInfo.name,
        plan: "free",
      });
      userList = await db.select().from(users).where(eq(users.id, userId));
      user = userList[0];
    }

    // 4. Generate JWT
    const token = await sign(
      { id: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, // 30 days
      c.env.JWT_SECRET || "fallback-secret"
    );

    // 5. Redirect back to App (Deep Link)
    const frontendUrl = "jarvis-desktop://auth"; 
    
    const userJson = encodeURIComponent(JSON.stringify({ id: user.id, email: user.email, plan: user.plan }));
    
    return c.redirect(`${frontendUrl}?token=${token}&user=${userJson}`);
  } catch (error: any) {
    console.error("Google Auth Error:", error);
    return c.json({ error: error.message || "Authentication failed" }, 500);
  }
});

export default auth;
