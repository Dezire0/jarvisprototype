import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { requireSession, type SessionBindings, type SessionVariables } from "../session";
import { users } from "../schema";

const FREE_DAILY_MSG_LIMIT = 15;
const PRO_DAILY_TOKEN_LIMIT = 200_000;
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type CloudModelBindings = {
  GEMINI_API_KEY?: string;
  JARVIS_CLOUD_FREE_MODEL?: string;
  JARVIS_CLOUD_PRO_MODEL?: string;
};

type Bindings = SessionBindings & CloudModelBindings & { DB: D1Database };

function cloudModel(env: CloudModelBindings, isPro: boolean) {
  const model = isPro
    ? env.JARVIS_CLOUD_PRO_MODEL?.trim() || "gemini-3.5-flash"
    : env.JARVIS_CLOUD_FREE_MODEL?.trim() || "gemini-3.5-flash-lite";
  return /^gemini-[a-z0-9][a-z0-9.-]{0,99}$/.test(model) ? model : null;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<ChatMessage>;
  return (item.role === "user" || item.role === "assistant") &&
    typeof item.content === "string" && item.content.trim().length > 0;
}

function parseChatRequest(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  const body = value as { messages?: unknown; systemPrompt?: unknown; language?: unknown };
  const { messages, systemPrompt, language } = body;
  if (!Array.isArray(messages) || !messages.length || !messages.every(isChatMessage) ||
      messages.at(-1)?.role !== "user" ||
      (systemPrompt !== undefined && typeof systemPrompt !== "string") ||
      (language !== undefined && typeof language !== "string")) {
    return null;
  }

  return { messages, systemPrompt, language };
}

type GeminiReply = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  usageMetadata?: { totalTokenCount?: number };
};

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

const ai = new Hono<{ Bindings: Bindings; Variables: SessionVariables }>();

ai.use("/*", requireSession);

ai.get("/usage", async (c) => {
  const { id } = c.get("jwtPayload");
  const [user] = await drizzle(c.env.DB).select().from(users).where(eq(users.id, id));
  if (!user) return c.json({ error: "User not found" }, 404);

  const isPro = user.plan === "pro";
  const model = cloudModel(c.env, isPro);
  if (!model) return c.json({ error: "Cloud model is not configured.", code: "cloud_configuration" }, 503);

  const isToday = user.lastMessageDate === utcDate();
  if (isPro) {
    const tokensUsed = isToday ? user.dailyTokenCount : 0;
    return c.json({
      success: true,
      plan: "pro",
      model,
      tokensUsed,
      tokenLimit: PRO_DAILY_TOKEN_LIMIT,
      tokensRemaining: Math.max(0, PRO_DAILY_TOKEN_LIMIT - tokensUsed),
    });
  }

  const messagesUsed = isToday ? user.dailyMessageCount : 0;
  return c.json({
    success: true,
    plan: "free",
    model,
    messagesUsed,
    messageLimit: FREE_DAILY_MSG_LIMIT,
    messagesRemaining: Math.max(0, FREE_DAILY_MSG_LIMIT - messagesUsed),
  });
});

ai.post("/chat", async (c) => {
  const body = parseChatRequest(await c.req.json<unknown>().catch(() => null));
  if (!body) return c.json({ error: "A conversation ending with a user message is required." }, 400);

  const { id } = c.get("jwtPayload");
  const db = drizzle(c.env.DB);
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) return c.json({ error: "User not found" }, 404);

  const isToday = user.lastMessageDate === utcDate();
  const isPro = user.plan === "pro";
  if (!isPro && isToday && user.dailyMessageCount >= FREE_DAILY_MSG_LIMIT) {
    return c.json({
      error: "rate_limit_exceeded",
      code: "plan_limit",
      message: "오늘의 무료 메시지 한도에 도달했습니다. 한도는 UTC 자정에 초기화됩니다.",
      messageEn: "You reached the Free daily message limit. It resets at midnight UTC.",
      remaining: 0,
      limit: FREE_DAILY_MSG_LIMIT,
    }, 429);
  }
  if (isPro && isToday && user.dailyTokenCount >= PRO_DAILY_TOKEN_LIMIT) {
    return c.json({
      error: "rate_limit_exceeded",
      code: "plan_limit",
      message: "오늘의 Pro 토큰 한도에 도달했습니다. 한도는 UTC 자정에 초기화됩니다.",
      messageEn: "You reached the Pro daily token limit. It resets at midnight UTC.",
      tokensRemaining: 0,
      tokenLimit: PRO_DAILY_TOKEN_LIMIT,
    }, 429);
  }

  const model = cloudModel(c.env, isPro);
  const apiKey = c.env.GEMINI_API_KEY?.trim();
  if (!model || !apiKey) {
    return c.json({ error: "Cloud model is not configured.", code: "cloud_configuration" }, 503);
  }

  const contents = body.messages.map(({ role, content }) => ({
    role: role === "assistant" ? "model" : "user",
    parts: [{ text: content }],
  }));
  const systemPrompt = body.systemPrompt?.trim() || (body.language === "ko"
    ? "실용적인 비서 Jarvis로서 한국어로 답변하세요."
    : "Answer in English as Jarvis, a practical assistant.");

  const deadline = AbortSignal.timeout(30_000);
  let upstream: Response;
  try {
    upstream = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
      method: "POST",
      redirect: "manual",
      signal: deadline,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.7, maxOutputTokens: isPro ? 8192 : 2048 },
      }),
    });
  } catch {
    if (deadline.aborted) return c.json({ error: "Cloud provider timed out.", code: "provider_timeout" }, 504);
    return c.json({ error: "Could not reach the cloud provider.", code: "provider_unavailable" }, 502);
  }

  if (upstream.status === 429) {
    return c.json({
      error: "rate_limit_exceeded",
      code: "provider_limit",
      message: "클라우드가 혼잡합니다. 잠시 후 다시 시도해 주세요.",
      messageEn: "The cloud provider is busy. Try again in a moment.",
    }, 429);
  }
  if (!upstream.ok) {
    return c.json({ error: "Cloud provider could not complete the request.", code: "provider_unavailable" }, 502);
  }

  const data = await upstream.json<GeminiReply>().catch(() => null);
  const parts = data?.candidates?.[0]?.content?.parts;
  const reply = Array.isArray(parts)
    ? parts.filter((part) => part && !part.thought && typeof part.text === "string")
        .map((part) => part.text).join("").trim()
    : "";
  if (!reply) {
    return c.json({ error: "Cloud provider did not return a text reply.", code: "provider_empty" }, 502);
  }

  const reportedTokens = data?.usageMetadata?.totalTokenCount ?? 0;
  const tokensUsed = Number.isSafeInteger(reportedTokens) && reportedTokens >= 0 ? reportedTokens : 0;
  const today = utcDate();
  const [usage] = await db.update(users).set({
    dailyMessageCount: sql`case when ${users.lastMessageDate} = ${today} then ${users.dailyMessageCount} + 1 else 1 end`,
    dailyTokenCount: sql`case when ${users.lastMessageDate} = ${today} then ${users.dailyTokenCount} + ${tokensUsed} else ${tokensUsed} end`,
    lastMessageDate: today,
  }).where(eq(users.id, id)).returning({
    messages: users.dailyMessageCount,
    tokens: users.dailyTokenCount,
  });
  if (!usage) return c.json({ error: "User not found" }, 404);

  return c.json({
    success: true,
    reply,
    model,
    plan: user.plan,
    tokensUsed,
    ...(isPro
      ? { tokensRemaining: Math.max(0, PRO_DAILY_TOKEN_LIMIT - usage.tokens) }
      : { messagesRemaining: Math.max(0, FREE_DAILY_MSG_LIMIT - usage.messages) }),
  });
});

export default ai;
