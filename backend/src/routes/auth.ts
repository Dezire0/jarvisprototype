import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../schema";
import { eq } from "drizzle-orm";

const INTERNAL_JWT_SECRET = "jarvis-permanent-secret-key-2024-v1";

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
    { id: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, // 30 days
    INTERNAL_JWT_SECRET,
    "HS256"
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

auth.put("/plan", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) return c.json({ error: "Unauthorized: Missing header" }, 401);
  
  const token = authHeader.replace("Bearer ", "");
  
  let payload;
  try {
    payload = await verify(token, INTERNAL_JWT_SECRET, "HS256");
    if (!payload || !payload.id) {
      throw new Error("Invalid token payload: missing ID");
    }
  } catch (e: any) {
    console.error("Token verification failed:", e.message);
    return c.json({ 
      error: "Unauthorized: Invalid session", 
      debug: e.message,
      token_preview: token.substring(0, 10) + "..." 
    }, 401);
  }

  const { plan } = await c.req.json();
  if (plan !== "free" && plan !== "pro") {
    return c.json({ error: "Invalid plan" }, 400);
  }

  try {
    // Check if user exists first
    const userResult = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?")
      .bind(payload.id)
      .first();
    
    if (!userResult) {
      return c.json({ error: "User not found in database", id: payload.id }, 404);
    }

    // Use raw SQL for maximum reliability
    const result = await c.env.DB.prepare("UPDATE users SET plan = ? WHERE id = ?")
      .bind(plan, payload.id)
      .run();
    
    if (!result.success) {
      throw new Error("D1 Update execution failed");
    }

    return c.json({ success: true, plan });
  } catch (error: any) {
    console.error("Plan update CRITICAL error:", error.message);
    return c.json({ 
      error: "Critical server error during plan update", 
      details: error.message,
      stack: error.stack
    }, 500);
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
      INTERNAL_JWT_SECRET,
      "HS256"
    );

    // 5. Send user back to the desktop app and close the browser tab when possible.
    const frontendUrl = "jarvis-desktop://auth";
    const userJson = encodeURIComponent(JSON.stringify({ id: user.id, email: user.email, plan: user.plan }));
    const deepLinkUrl = `${frontendUrl}?token=${token}&user=${userJson}`;

    return c.html(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Open Jarvis Desktop</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(67, 56, 202, 0.18), transparent 36%),
          linear-gradient(180deg, #0c0d10, #050608);
        color: #f5f7fb;
      }
      .card {
        width: min(520px, calc(100vw - 32px));
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 28px;
        background: rgba(17, 19, 24, 0.92);
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
        padding: 28px;
      }
      .eyebrow {
        margin: 0 0 10px;
        font-size: 11px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.48);
      }
      h1 {
        margin: 0;
        font-size: 30px;
        line-height: 1.1;
      }
      p {
        margin: 16px 0 0;
        color: rgba(255, 255, 255, 0.68);
        line-height: 1.6;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 24px;
      }
      .button {
        appearance: none;
        border: none;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
      }
      .button-primary {
        background: #ffffff;
        color: #050608;
      }
      .button-secondary {
        background: rgba(255, 255, 255, 0.06);
        color: #f5f7fb;
      }
      .hint {
        margin-top: 18px;
        font-size: 13px;
      }
      .manual-close .hint-close {
        display: inline;
      }
      .hint-close {
        display: none;
      }
    </style>
  </head>
  <body>
    <section class="card">
      <p class="eyebrow">Jarvis Desktop</p>
      <h1>Jarvis를 여는 중입니다</h1>
      <p>
        앱 열기 버튼을 누른 뒤에는 이 탭의 역할이 끝나요. 가능하면 자동으로 닫고, 브라우저가 막으면 직접 닫아도 됩니다.
      </p>
      <div class="actions">
        <a class="button button-primary" id="open-app" href="${deepLinkUrl}">Jarvis Desktop 열기</a>
        <button class="button button-secondary" id="retry-app" type="button">다시 시도</button>
      </div>
      <p class="hint">
        앱이 열리면 이 탭은 자동으로 닫히도록 시도합니다.
        <span class="hint-close"> 자동으로 닫히지 않으면 직접 닫아주세요.</span>
      </p>
    </section>

    <script>
      const deepLinkUrl = ${JSON.stringify(deepLinkUrl)};
      let closeQueued = false;

      function openJarvis() {
        window.location.href = deepLinkUrl;
      }

      function tryCloseWindow() {
        if (closeQueued) {
          return;
        }
        closeQueued = true;
        document.body.classList.add("manual-close");
        window.setTimeout(() => {
          try {
            window.open("", "_self");
          } catch (_error) {}
          try {
            window.close();
          } catch (_error) {}
          closeQueued = false;
        }, 180);
      }

      window.addEventListener("load", () => {
        window.setTimeout(openJarvis, 120);
      });

      window.addEventListener("pagehide", tryCloseWindow);
      window.addEventListener("blur", () => {
        window.setTimeout(tryCloseWindow, 220);
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          window.setTimeout(tryCloseWindow, 220);
        }
      });

      document.getElementById("open-app")?.addEventListener("click", () => {
        window.setTimeout(tryCloseWindow, 220);
      });

      document.getElementById("retry-app")?.addEventListener("click", () => {
        openJarvis();
        window.setTimeout(tryCloseWindow, 220);
      });
    </script>
  </body>
</html>`);
  } catch (error: any) {
    console.error("Google Auth Error:", error);
    return c.json({ error: error.message || "Authentication failed" }, 500);
  }
});

export default auth;
