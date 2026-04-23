import { createAssistantStreamResponse } from "assistant-stream";
import { Hono } from "hono";
import { jwt } from "hono/jwt";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = "gemini-1.5-flash";
const SYSTEM_PROMPT =
  "You are Jarvis, a helpful AI assistant. Respond in the user's language when appropriate.";
const CHAT_SYSTEM_PROMPT =
  "당신은 유능하고 친절한 AI 비서 Jarvis입니다. 한국어로 응답하세요.";
const DEFAULT_SYSTEM_PROMPT =
  "당신은 유능하고 친절한 AI 비서 Jarvis입니다. 한국어로 응답하세요.";

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
  GEMINI_API_KEY: string;
};

type Variables = {
  jwtPayload: { id: string };
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  status?: "running" | "complete";
  provider?: string;
  actions?: unknown[];
};

type ChatRequestBody = {
  commands?: Array<{
    type?: string;
    message?: {
      role?: "user" | "assistant";
      parts?: Array<{ type?: string; text?: string }>;
      text?: string;
      content?: unknown;
    };
    parentId?: string | null;
    sourceId?: string | null;
  }>;
  state?: {
    messages?: ChatMessage[];
    [key: string]: unknown;
  } | null;
  threadId?: string | null;
  messages?: Array<{
    id?: string;
    role?: "user" | "assistant";
    text?: string;
    content?: string | Array<{ text?: string }>;
    createdAt?: unknown;
    status?: unknown;
    provider?: unknown;
    actions?: unknown;
  }>;
  title?: string;
  system?: string;
  [key: string]: unknown;
};

type PersistedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

const chat = new Hono<{ Bindings: Bindings; Variables: Variables }>();

chat.use("/*", (c, next) => {
  const jwtMiddleware = jwt({
    secret: "jarvis-permanent-secret-key-2024-v1",
    alg: "HS256",
  });

  return jwtMiddleware(c, next);
});

chat.get("/threads", async (c) => {
  const userId = c.get("jwtPayload").id;

  try {
    const threads = await listThreads(c.env.DB, userId);
    return c.json({ success: true, threads });
  } catch (error: any) {
    return c.json({ error: "Failed to fetch threads", details: error.message }, 500);
  }
});

chat.get("/threads/:threadId/messages", async (c) => {
  const userId = c.get("jwtPayload").id;
  const threadId = c.req.param("threadId");

  try {
    const messages = await loadThreadMessages(c.env.DB, userId, threadId);
    if (messages === null) {
      return c.json({ error: "Thread not found" }, 404);
    }

    return c.json({ success: true, threadId, messages });
  } catch (error: any) {
    return c.json({ error: "Failed to fetch messages", details: error.message }, 500);
  }
});

chat.post("/sync", async (c) => {
  const userId = c.get("jwtPayload").id;

  let body: ChatRequestBody;
  try {
    body = await parseBody(c);
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const threadId = resolveThreadId(body.threadId);
  const messages = Array.isArray(body.messages)
    ? body.messages
        .map(normalizeMessageLike)
        .filter((message): message is ChatMessage => message !== null)
    : undefined;

  try {
    await persistThreadSnapshot(c.env.DB, userId, threadId, {
      title: typeof body.title === "string" ? body.title : undefined,
      messages,
    });

    return c.json({
      success: true,
      threadId,
      messageCount: messages?.length ?? 0,
    });
  } catch (error: any) {
    return c.json({ error: "Failed to sync thread", details: error.message }, 500);
  }
});

chat.post("/", async (c) => handleChat(c));
chat.post("", async (c) => handleChat(c));

async function handleChat(c: any) {
  const userId = c.get("jwtPayload").id;

  let body: ChatRequestBody;
  try {
    body = await parseBody(c);
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (Array.isArray(body.commands) && body.commands.length > 0) {
    return handleTransportChat(c, userId, body);
  }

  if (Array.isArray(body.messages)) {
    return handleLegacyChat(c, userId, body);
  }

  return c.json({ error: "No messages or commands provided" }, 400);
}

async function handleTransportChat(c: any, userId: string, body: ChatRequestBody) {
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Service not configured. Contact administrator." }, 503);
  }

  const threadId = resolveThreadId(body.threadId);
  const systemPrompt =
    typeof body.system === "string" && body.system.trim().length > 0
      ? body.system.trim()
      : SYSTEM_PROMPT;

  const existingMessages = Array.isArray(body.state?.messages)
    ? body.state.messages
        .map(normalizeMessageLike)
        .filter((message): message is ChatMessage => message !== null)
    : [];

  const conversationMessages = applyCommandsToMessages(
    existingMessages,
    body.commands ?? [],
  );

  if (conversationMessages.length === existingMessages.length) {
    return c.json({ error: "No user message provided" }, 400);
  }

  return createAssistantStreamResponse(async (controller) => {
    controller.enqueue({
      type: "update-state",
      path: [],
      operations: [
        {
          type: "set",
          path: ["messages"],
          value: conversationMessages as any,
        },
      ],
    });

    try {
      await persistThreadSnapshot(c.env.DB, userId, threadId, {
        messages: conversationMessages,
      });
    } catch (error) {
      console.error("Failed to persist draft chat state:", error);
    }

    let replyText = "";

    try {
      replyText = await generateGeminiReply({
        apiKey,
        systemPrompt,
        messages: conversationMessages,
      });
    } catch (error: any) {
      console.error("Gemini chat error:", error);
      controller.enqueue({
        type: "error",
        path: [],
        error: error?.message ?? "Gemini request failed",
      });
      return;
    }

    const finalMessages = [
      ...conversationMessages,
      createAssistantMessage(replyText),
    ];

    controller.enqueue({
      type: "update-state",
      path: [],
      operations: [
        {
          type: "set",
          path: ["messages"],
          value: finalMessages as any,
        },
      ],
    });

    try {
      await persistThreadSnapshot(c.env.DB, userId, threadId, {
        messages: finalMessages,
      });
    } catch (error) {
      console.error("Failed to persist final chat state:", error);
    }
  });
}

async function handleLegacyChat(c: any, userId: string, body: ChatRequestBody) {
  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Service not configured. Contact administrator." }, 503);
  }

  const threadId = resolveThreadId(body.threadId);
  const systemPrompt =
    typeof body.system === "string" && body.system.trim().length > 0
      ? body.system.trim()
      : SYSTEM_PROMPT;

  const conversationMessages = (body.messages ?? [])
    .map(normalizeMessageLike)
    .filter((message): message is ChatMessage => message !== null)
    .filter((message) => message.text.trim().length > 0);

  if (conversationMessages.length === 0) {
    return c.json({ error: "No messages provided" }, 400);
  }

  try {
    const replyText = await generateGeminiReply({
      apiKey,
      systemPrompt,
      messages: conversationMessages,
    });

    const finalMessages = [
      ...conversationMessages,
      createAssistantMessage(replyText),
    ];

    try {
      await persistThreadSnapshot(c.env.DB, userId, threadId, {
        messages: finalMessages,
      });
    } catch (error) {
      console.error("Failed to persist legacy chat state:", error);
    }

    return c.json({ messages: finalMessages });
  } catch (error: any) {
    return c.json({ error: "Chat processing failed", details: error.message }, 500);
  }
}

async function parseBody(c: any): Promise<ChatRequestBody> {
  return (await c.req.json()) as ChatRequestBody;
}

function resolveThreadId(threadId: string | null | undefined) {
  if (typeof threadId === "string" && threadId.trim().length > 0) {
    return threadId.trim();
  }

  return "default-thread";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeRole(value: unknown): "user" | "assistant" | null {
  if (value === "user" || value === "assistant") {
    return value;
  }

  return null;
}

function normalizeMilliseconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return Date.now();
}

function normalizeIsoTimestamp(value: unknown): string {
  return new Date(normalizeMilliseconds(value)).toISOString();
}

function normalizeTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter((part) => part.trim().length > 0)
    .join(" ")
    .trim();
}

function extractMessageText(message: Record<string, unknown>): string {
  if (typeof message.text === "string") {
    return message.text.trim();
  }

  if (typeof message.content === "string") {
    return message.content.trim();
  }

  if (Array.isArray(message.parts)) {
    return normalizeTextParts(message.parts);
  }

  if (Array.isArray(message.content)) {
    return normalizeTextParts(message.content);
  }

  return "";
}

function normalizeMessageLike(message: unknown): ChatMessage | null {
  if (!isRecord(message)) {
    return null;
  }

  const role = normalizeRole(message.role);
  if (!role) {
    return null;
  }

  const text = extractMessageText(message);
  if (role === "user" && text.length === 0) {
    return null;
  }

  const normalized: ChatMessage = {
    id:
      typeof message.id === "string" && message.id.trim().length > 0
        ? message.id.trim()
        : crypto.randomUUID(),
    role,
    text,
    createdAt: normalizeIsoTimestamp(message.createdAt),
  };

  if (role === "assistant") {
    normalized.status = message.status === "running" ? "running" : "complete";

    if (typeof message.provider === "string" && message.provider.trim().length > 0) {
      normalized.provider = message.provider;
    }

    if (Array.isArray(message.actions)) {
      normalized.actions = message.actions;
    }
  }

  return normalized;
}

function createAssistantMessage(text: string): ChatMessage {
  return {
    id: `assistant-${crypto.randomUUID()}`,
    role: "assistant",
    text: text.trim(),
    createdAt: new Date().toISOString(),
    status: "complete",
    provider: "gemini",
  };
}

function applyCommandsToMessages(
  existingMessages: ChatMessage[],
  commands: Array<{
    type?: string;
    message?: {
      role?: "user" | "assistant";
      parts?: Array<{ type?: string; text?: string }>;
      text?: string;
      content?: unknown;
    };
    parentId?: string | null;
    sourceId?: string | null;
  }>,
) {
  const messages = [...existingMessages];

  for (const command of commands) {
    if (command?.type !== "add-message" || !command.message) {
      continue;
    }

    const message = normalizeMessageLike(command.message);
    if (!message) {
      continue;
    }

    messages.push(message);
  }

  return messages;
}

function buildGeminiContents(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.text.trim().length > 0)
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.text }],
    }));
}

function extractGeminiText(data: any) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

async function generateGeminiReply({
  apiKey,
  systemPrompt,
  messages,
}: {
  apiKey: string;
  systemPrompt: string;
  messages: ChatMessage[];
}) {
  const contents = buildGeminiContents(messages);
  if (contents.length === 0) {
    throw new Error("No conversation messages to send to Gemini");
  }

  const response = await fetch(
    `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
      }),
    },
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(
      `Gemini API error: ${response.status} ${JSON.stringify(errData)}`,
    );
  }

  const data = await response.json<any>();
  return extractGeminiText(data);
}

function deriveThreadTitle(messages: readonly ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.text.trim().length > 0);
  const fallbackMessage = firstUserMessage ?? messages.find((message) => message.text.trim().length > 0);
  const title = fallbackMessage?.text.trim().replace(/\s+/g, " ") ?? "";

  return title.length > 0 ? title.slice(0, 50) : "New Chat";
}

async function persistThreadSnapshot(
  db: D1Database,
  userId: string,
  threadId: string,
  options: {
    title?: string;
    messages?: readonly ChatMessage[];
  },
) {
  const existingThread = await db
    .prepare("SELECT id, title FROM threads WHERE id = ? AND user_id = ?")
    .bind(threadId, userId)
    .first<{ id: string; title: string | null }>();

  const resolvedTitle = options.title ?? deriveThreadTitle(options.messages ?? []);

  if (!existingThread) {
    await db
      .prepare(
        "INSERT INTO threads (id, user_id, title, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(threadId, userId, resolvedTitle, Date.now())
      .run();
  } else if (options.title !== undefined || !existingThread.title) {
    await db
      .prepare("UPDATE threads SET title = ? WHERE id = ? AND user_id = ?")
      .bind(resolvedTitle, threadId, userId)
      .run();
  }

  if (options.messages !== undefined) {
    await db.prepare("DELETE FROM messages WHERE thread_id = ?").bind(threadId).run();

    for (const message of options.messages) {
      const persistedMessage: PersistedMessage = {
        id: message.id,
        role: message.role,
        content: message.text,
        createdAt: normalizeMilliseconds(message.createdAt),
      };

      await db
        .prepare(
          "INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(
          persistedMessage.id,
          threadId,
          persistedMessage.role,
          persistedMessage.content,
          persistedMessage.createdAt,
        )
        .run();
    }
  }
}

async function listThreads(db: D1Database, userId: string) {
  const { results } = await db
    .prepare(
      "SELECT id, title, created_at AS createdAt FROM threads WHERE user_id = ? ORDER BY created_at DESC, id DESC",
    )
    .bind(userId)
    .all();

  return (results as Array<Record<string, unknown>>).map((thread) => ({
    id: typeof thread.id === "string" ? thread.id : "",
    title:
      typeof thread.title === "string" && thread.title.trim().length > 0
        ? thread.title
        : "New Chat",
    createdAt: normalizeMilliseconds(thread.createdAt),
  }));
}

async function loadThreadMessages(
  db: D1Database,
  userId: string,
  threadId: string,
) {
  const thread = await db
    .prepare("SELECT id FROM threads WHERE id = ? AND user_id = ?")
    .bind(threadId, userId)
    .first<{ id: string }>();

  if (!thread) {
    return null;
  }

  const { results } = await db
    .prepare(
      "SELECT id, role, content, created_at AS createdAt FROM messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC",
    )
    .bind(threadId)
    .all();

  return (results as Array<Record<string, unknown>>).map((message) => ({
    id: typeof message.id === "string" ? message.id : crypto.randomUUID(),
    role: message.role === "assistant" ? "assistant" : "user",
    content: typeof message.content === "string" ? message.content : "",
    createdAt: normalizeMilliseconds(message.createdAt),
  }));
}

export default chat;
