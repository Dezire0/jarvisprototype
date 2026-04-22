import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../schema";
import { eq } from "drizzle-orm";

const FREE_DAILY_LIMIT = 30;
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
  GEMINI_API_KEY: string;
};

type Variables = {
  jwtPayload: { id: string };
};

const ai = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// JWT auth required for all AI routes
ai.use("/*", (c, next) => {
  const jwtMiddleware = jwt({
    secret: c.env.JWT_SECRET || "fallback-secret",
    alg: "HS256",
  });
  return jwtMiddleware(c, next);
});

// GET /api/ai/usage — Return today's usage and limit
ai.get("/usage", async (c) => {
  const payload = c.get("jwtPayload");
  const db = drizzle(c.env.DB);

  const userList = await db.select().from(users).where(eq(users.id, payload.id));
  const user = userList[0];

  if (!user) return c.json({ error: "User not found" }, 404);

  const today = new Date().toISOString().slice(0, 10);
  const count = user.lastMessageDate === today ? user.dailyMessageCount : 0;

  return c.json({
    success: true,
    plan: user.plan,
    used: count,
    limit: user.plan === "pro" ? null : FREE_DAILY_LIMIT,
    remaining: user.plan === "pro" ? null : Math.max(0, FREE_DAILY_LIMIT - count),
    resetAt: "자정 (KST)",
  });
});

// POST /api/ai/chat — Proxy request to Gemini using operator's central API key
ai.post("/chat", async (c) => {
  const payload = c.get("jwtPayload");
  const db = drizzle(c.env.DB);

  // 1. Load user
  const userList = await db.select().from(users).where(eq(users.id, payload.id));
  const user = userList[0];

  if (!user) return c.json({ error: "User not found" }, 404);

  // 2. Rate limit check for free plan
  if (user.plan !== "pro") {
    const today = new Date().toISOString().slice(0, 10);
    const currentCount = user.lastMessageDate === today ? user.dailyMessageCount : 0;

    if (currentCount >= FREE_DAILY_LIMIT) {
      return c.json(
        {
          error: "rate_limit_exceeded",
          message:
            "오늘의 무료 사용량(30회)을 모두 사용했습니다. 내일 자정에 초기화되거나 Pro 플랜으로 업그레이드하세요.",
          messageEn:
            "You've used all 30 free messages today. Resets at midnight or upgrade to Pro.",
          remaining: 0,
          limit: FREE_DAILY_LIMIT,
        },
        429
      );
    }

    // 3. Increment counter
    await db
      .update(users)
      .set({
        dailyMessageCount: currentCount + 1,
        lastMessageDate: today,
      })
      .where(eq(users.id, payload.id));
  }

  // 4. Get request body
  const body = await c.req.json<{
    messages: Array<{ role: string; content: string }>;
    systemPrompt?: string;
    language?: string;
  }>();

  if (!body.messages || !Array.isArray(body.messages)) {
    return c.json({ error: "messages array is required" }, 400);
  }

  // 5. Build Gemini request
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Service not configured. Contact administrator." }, 503);
  }

  const contents = body.messages.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  const systemInstruction = body.systemPrompt
    ? { parts: [{ text: body.systemPrompt }] }
    : {
        parts: [
          {
            text:
              body.language === "ko"
                ? "당신은 유능하고 친절한 AI 비서 Jarvis입니다. 한국어로만 응답하세요."
                : "You are a capable and friendly AI assistant named Jarvis. Respond in English only.",
          },
        ],
      };

  const geminiPayload = {
    contents,
    systemInstruction,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  };

  // 6. Call Gemini
  let geminiRes: Response;
  try {
    geminiRes = await fetch(
      `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload),
      }
    );
  } catch (err: any) {
    return c.json({ error: "Failed to reach Gemini API", detail: err.message }, 502);
  }

  if (!geminiRes.ok) {
    const errBody = await geminiRes.json().catch(() => ({}));
    // Handle quota exceeded from Google's side
    if (geminiRes.status === 429) {
      return c.json(
        {
          error: "rate_limit_exceeded",
          message: "서비스 사용량이 일시적으로 초과되었습니다. 잠시 후 다시 시도해주세요.",
          messageEn: "Service is temporarily overloaded. Please try again in a moment.",
        },
        429
      );
    }
    return c.json({ error: "Gemini API error", detail: errBody }, geminiRes.status as any);
  }

  const geminiData = await geminiRes.json<any>();
  const text =
    geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  return c.json({
    success: true,
    reply: text,
    model: GEMINI_MODEL,
    plan: user.plan,
  });
});

export default ai;
