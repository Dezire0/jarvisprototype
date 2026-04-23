import { Hono } from "hono";
import { jwt } from "hono/jwt";

const chat = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string; GEMINI_API_KEY: string }; Variables: { jwtPayload: { id: string } } }>();

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Apply JWT middleware to all chat routes
chat.use("/*", (c, next) => {
  const jwtMiddleware = jwt({
    secret: "jarvis-permanent-secret-key-2024-v1",
    alg: "HS256"
  });
  return jwtMiddleware(c, next);
});

// GET /threads — Get all threads for the current user
chat.get("/threads", async (c) => {
  const payload = c.get("jwtPayload");
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM threads WHERE user_id = ? ORDER BY created_at DESC"
    )
    .bind(payload.id)
    .all();

    return c.json({ success: true, threads: results });
  } catch (error: any) {
    return c.json({ error: "Failed to fetch threads", details: error.message }, 500);
  }
});

// POST / — The main chat endpoint used by assistant-ui (Standard JSON)
chat.post("/", async (c) => {
  return handleChat(c);
});

chat.post("", async (c) => {
  return handleChat(c);
});

async function handleChat(c: any) {
  const payload = c.get("jwtPayload");
  const body = await c.req.json();
  const messages = body.messages || [];

  if (messages.length === 0) {
    return c.json({ error: "No messages provided" }, 400);
  }

  const apiKey = c.env.GEMINI_API_KEY;

  try {
    const geminiRes = await fetch(
      `${GEMINI_API_BASE}/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: messages.map((m: any) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content?.[0]?.text || m.text || "" }]
          })),
          systemInstruction: {
            parts: [{ text: "당신은 유능하고 친절한 AI 비서 Jarvis입니다. 한국어로 응답하세요." }]
          }
        }),
      }
    );

    if (!geminiRes.ok) {
      const errData = await geminiRes.json().catch(() => ({}));
      throw new Error(`Gemini API error: ${geminiRes.status} ${JSON.stringify(errData)}`);
    }

    const data = await geminiRes.json<any>();
    const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // IMPORTANT: Return EXACTLY what the client's TransportState expects
    const responseState = {
      messages: [
        ...messages,
        {
          id: `ai-${Date.now()}`,
          role: "assistant",
          text: replyText,
          createdAt: new Date().toISOString(),
          status: "complete"
        }
      ]
    };

    // Auto-sync to DB in background
    c.executionCtx.waitUntil(syncToDB(c.env.DB, payload.id, messages[messages.length-1], replyText));

    return c.json(responseState);
  } catch (error: any) {
    return c.json({ error: "Chat processing failed", details: error.message }, 500);
  }
}

async function syncToDB(db: D1Database, userId: string, userMsg: any, aiReply: string) {
  try {
    const threadId = "default-thread"; 
    await db.prepare(
      "INSERT OR IGNORE INTO threads (id, user_id, title, created_at) VALUES (?, ?, ?, (strftime('%s', 'now')))"
    )
    .bind(threadId, userId, userMsg.text?.slice(0, 50) || "New Chat")
    .run();

    await db.prepare(
      "INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, (strftime('%s', 'now')))"
    )
    .bind(`user-${Date.now()}`, threadId, "user", userMsg.text || userMsg.content?.[0]?.text || "")
    .run();

    await db.prepare(
      "INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, (strftime('%s', 'now')))"
    )
    .bind(`ai-${Date.now()}`, threadId, "assistant", aiReply)
    .run();
  } catch (e) {
    console.error("Auto-sync failed:", e);
  }
}

chat.post("/sync", async (c) => {
  return c.json({ success: true, message: "Sync handled automatically now" });
});

export default chat;
