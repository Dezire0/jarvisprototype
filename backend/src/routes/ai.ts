import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../schema";
import { eq } from "drizzle-orm";

// ── Plan config ──────────────────────────────────────────
const FREE_DAILY_MSG_LIMIT = 15;            // 무료: 일 15회 메시지
const FREE_MODEL = "gemini-1.5-flash-latest"; // 무료: Gemini 1.5 Flash (Fixed 404)

const PRO_DAILY_TOKEN_LIMIT = 200_000;      // 유료: 일 200k 토큰
const PRO_MODEL = "gemini-2.0-flash";       // 유료: Gemini 2.0 Flash
// ─────────────────────────────────────────────────────────

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

ai.use("/*", (c, next) => {
  const jwtMiddleware = jwt({
    secret: "jarvis-permanent-secret-key-2024-v1",
    alg: "HS256",
  });
  return jwtMiddleware(c, next);
});

// GET /api/ai/usage — 오늘 사용량 조회
ai.get("/usage", async (c) => {
  const payload = c.get("jwtPayload");
  const db = drizzle(c.env.DB);

  const userList = await db.select().from(users).where(eq(users.id, payload.id));
  const user = userList[0];
  if (!user) return c.json({ error: "User not found" }, 404);

  const today = new Date().toISOString().slice(0, 10);
  const isToday = user.lastMessageDate === today;
  const usedMessages = isToday ? user.dailyMessageCount : 0;
  const usedTokens = isToday ? user.dailyTokenCount : 0;

  if (user.plan === "pro") {
    return c.json({
      success: true,
      plan: "pro",
      model: PRO_MODEL,
      tokensUsed: usedTokens,
      tokenLimit: PRO_DAILY_TOKEN_LIMIT,
      tokensRemaining: Math.max(0, PRO_DAILY_TOKEN_LIMIT - usedTokens),
    });
  }

  return c.json({
    success: true,
    plan: "free",
    model: FREE_MODEL,
    messagesUsed: usedMessages,
    messageLimit: FREE_DAILY_MSG_LIMIT,
    messagesRemaining: Math.max(0, FREE_DAILY_MSG_LIMIT - usedMessages),
  });
});

// POST /api/ai/chat — 중앙 Gemini 프록시
ai.post("/chat", async (c) => {
  const payload = c.get("jwtPayload");
  const db = drizzle(c.env.DB);

  const userList = await db.select().from(users).where(eq(users.id, payload.id));
  const user = userList[0];
  if (!user) return c.json({ error: "User not found" }, 404);

  const today = new Date().toISOString().slice(0, 10);
  const isToday = user.lastMessageDate === today;
  const currentMsgCount = isToday ? user.dailyMessageCount : 0;
  const currentTokenCount = isToday ? user.dailyTokenCount : 0;

  // ── 플랜별 Rate limit 체크 ──────────────────────────────
  const isPro = user.plan === "pro";
  const model = isPro ? PRO_MODEL : FREE_MODEL;

  if (!isPro && currentMsgCount >= FREE_DAILY_MSG_LIMIT) {
    return c.json(
      {
        error: "rate_limit_exceeded",
        message: `오늘의 무료 사용량(${FREE_DAILY_MSG_LIMIT}회)을 모두 사용했습니다. 내일 자정에 초기화되거나 Pro 플랜으로 업그레이드하세요.`,
        messageEn: `You've used all ${FREE_DAILY_MSG_LIMIT} free messages today. Resets at midnight or upgrade to Pro.`,
        remaining: 0,
        limit: FREE_DAILY_MSG_LIMIT,
      },
      429
    );
  }

  if (isPro && currentTokenCount >= PRO_DAILY_TOKEN_LIMIT) {
    return c.json(
      {
        error: "rate_limit_exceeded",
        message: `오늘의 Pro 플랜 토큰 한도(${PRO_DAILY_TOKEN_LIMIT.toLocaleString()}토큰)에 도달했습니다. 내일 자정에 초기화됩니다.`,
        messageEn: `You've reached today's Pro token limit (${PRO_DAILY_TOKEN_LIMIT.toLocaleString()} tokens). Resets at midnight.`,
        tokensRemaining: 0,
        tokenLimit: PRO_DAILY_TOKEN_LIMIT,
      },
      429
    );
  }

  // ── 요청 본문 파싱 ───────────────────────────────────────
  const body = await c.req.json<{
    messages: Array<{ role: string; content: string }>;
    systemPrompt?: string;
    language?: string;
  }>();

  if (!body.messages || !Array.isArray(body.messages)) {
    return c.json({ error: "messages array is required" }, 400);
  }

  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Service not configured. Contact administrator." }, 503);
  }

  // ── Gemini 요청 빌드 ─────────────────────────────────────
  const contents = body.messages.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  const systemInstruction = body.systemPrompt
    ? { parts: [{ text: body.systemPrompt }] }
    : {
        parts: [{
          text: body.language === "ko"
            ? "당신은 유능하고 친절한 AI 비서 Jarvis입니다. 한국어로만 응답하세요."
            : "You are a capable and friendly AI assistant named Jarvis. Respond in English only.",
        }],
      };

  const geminiPayload = {
    contents,
    systemInstruction,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: isPro ? 8192 : 2048,
    },
  };

  // ── Gemini API 호출 ──────────────────────────────────────
  let geminiRes: Response;
  // Google v1beta prefers 'gemini-1.5-flash' or specific versions like 'gemini-1.5-flash-002'.
  // Using 'gemini-1.5-flash' is the most standard.
  const actualModel = model === "gemini-1.5-flash-latest" ? "gemini-1.5-flash" : model;
  try {
    geminiRes = await fetch(
      `${GEMINI_API_BASE}/models/${actualModel}:generateContent?key=${apiKey}`,
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
    if (geminiRes.status === 429) {
      return c.json({
        error: "rate_limit_exceeded",
        message: "서비스 사용량이 일시적으로 초과되었습니다. 잠시 후 다시 시도해주세요.",
        messageEn: "Service is temporarily overloaded. Please try again in a moment.",
      }, 429);
    }
    return c.json({ error: "Gemini API error", detail: errBody }, geminiRes.status as any);
  }

  const geminiData = await geminiRes.json<any>();
  const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // ── 사용량 업데이트 ───────────────────────────────────────
  // token count from Gemini response (usageMetadata)
  const tokensUsed: number =
    (geminiData?.usageMetadata?.totalTokenCount as number) ?? 0;

  await db.update(users).set({
    dailyMessageCount: currentMsgCount + 1,
    dailyTokenCount: currentTokenCount + tokensUsed,
    lastMessageDate: today,
  }).where(eq(users.id, payload.id));

  return c.json({
    success: true,
    reply: text,
    model,
    plan: user.plan,
    tokensUsed,
    ...(isPro
      ? { tokensRemaining: Math.max(0, PRO_DAILY_TOKEN_LIMIT - currentTokenCount - tokensUsed) }
      : { messagesRemaining: Math.max(0, FREE_DAILY_MSG_LIMIT - currentMsgCount - 1) }
    ),
  });
});

export default ai;
