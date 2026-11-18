import { Hono } from "hono";
import { issueSession, requireSession, sessionSigningKey, type SessionBindings, type SessionVariables } from "../session";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../schema";
import { eq } from "drizzle-orm";

type Bindings = SessionBindings & {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

const auth = new Hono<{ Bindings: Bindings; Variables: SessionVariables }>();
auth.use("/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  if (!sessionSigningKey(c.env)) return c.json({ error: "Account service is unavailable" }, 503);
  await next();
});
const ALLOWED_WEB_RETURN_ORIGINS = new Set([
  "https://dexproject.pages.dev",
]);

function encodeAuthState(payload: Record<string, string>): string {
  return btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeAuthState(raw = ""): Record<string, string> | null {
  if (!raw) {
    return null;
  }

  try {
    const normalized = raw
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(raw.length / 4) * 4, "=");

    return JSON.parse(atob(normalized));
  } catch {
    return null;
  }
}

function normalizeReturnTarget(candidate = ""): string {
  if (!candidate) {
    return "";
  }

  try {
    const parsed = new URL(candidate);

    if (parsed.protocol === "jarvis-desktop:") {
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    }

    if (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "localhost" ||
        ALLOWED_WEB_RETURN_ORIGINS.has(parsed.origin))
    ) {
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    }
  } catch {
    return "";
  }

  return "";
}

function buildAuthReturnUrl(target: string, token: string, userPayload: string): string {
  const normalizedTarget = normalizeReturnTarget(target) || "jarvis-desktop://auth";
  const redirectUrl = new URL(normalizedTarget);
  redirectUrl.searchParams.set("token", token);
  redirectUrl.searchParams.set("user", userPayload);
  return redirectUrl.toString();
}

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

auth.get("/google", async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google-callback`;
  const returnTo = normalizeReturnTarget(c.req.query("return_to") || "");
  
  if (!clientId || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.json({ error: "Google sign-in is unavailable" }, 503);
  }

  const scope = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
  const state = returnTo ? encodeAuthState({ returnTo }) : "";
  const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent${state ? `&state=${encodeURIComponent(state)}` : ""}`;
  
  return c.redirect(googleUrl);
});

auth.get("/google-callback", async (c) => {
  const code = c.req.query("code");
  const state = decodeAuthState(c.req.query("state") || "");
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google-callback`;

  if (!code) return c.json({ error: "No code provided" }, 400);
  const key = sessionSigningKey(c.env);
  if (!clientId || !clientSecret || !key) {
    return c.json({ error: "Google sign-in is unavailable" }, 503);
  }

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
    const token = await issueSession(user, key);

    const userJson = JSON.stringify({ id: user.id, email: user.email, plan: user.plan });
    const returnTarget = normalizeReturnTarget(state?.returnTo || "");

    if (returnTarget) {
      return c.redirect(buildAuthReturnUrl(returnTarget, token, userJson));
    }

    // 5. Send user back to the desktop app and close the browser tab when possible.
    const frontendUrl = "jarvis-desktop://auth";
    const deepLinkUserJson = encodeURIComponent(userJson);
    const deepLinkUrl = `${frontendUrl}?token=${token}&user=${deepLinkUserJson}`;

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
  } catch {
    console.error("Google sign-in failed");
    return c.json({ error: "Google sign-in failed" }, 500);
  }
});

export default auth;
