import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { drizzle } from "drizzle-orm/d1";
import { threads, messages } from "../schema";
import { eq, desc } from "drizzle-orm";

const chat = new Hono<{ Bindings: { DB: D1Database; JWT_SECRET: string }; Variables: { jwtPayload: { id: string } } }>();

// Apply JWT middleware to all chat routes
chat.use("/*", (c, next) => {
  const jwtMiddleware = jwt({
    secret: c.env.JWT_SECRET || "fallback-secret",
  });
  return jwtMiddleware(c, next);
});

// Get all threads for the current user
chat.get("/threads", async (c) => {
  const payload = c.get("jwtPayload");
  const db = drizzle(c.env.DB);

  const userThreads = await db
    .select()
    .from(threads)
    .where(eq(threads.userId, payload.id))
    .orderBy(desc(threads.createdAt));

  return c.json({ success: true, threads: userThreads });
});

// Get messages for a specific thread
chat.get("/threads/:id/messages", async (c) => {
  const payload = c.get("jwtPayload");
  const threadId = c.req.param("id");
  const db = drizzle(c.env.DB);

  // First verify the thread belongs to the user
  const threadList = await db.select().from(threads).where(eq(threads.id, threadId));
  const thread = threadList[0];

  if (!thread || thread.userId !== payload.id) {
    return c.json({ error: "Thread not found or unauthorized" }, 404);
  }

  const threadMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt);

  return c.json({ success: true, messages: threadMessages });
});

// Sync a thread and its messages
chat.post("/sync", async (c) => {
  const payload = c.get("jwtPayload");
  const { threadId, title, messages: newMessages } = await c.req.json();
  const db = drizzle(c.env.DB);

  if (!threadId) {
    return c.json({ error: "threadId is required" }, 400);
  }

  // Upsert the thread (if it doesn't exist, create it)
  const existingThreadList = await db.select().from(threads).where(eq(threads.id, threadId));
  const existingThread = existingThreadList[0];

  if (!existingThread) {
    await db.insert(threads).values({
      id: threadId,
      userId: payload.id,
      title: title || "New Chat",
    });
  }

  // Insert messages if any
  if (newMessages && Array.isArray(newMessages) && newMessages.length > 0) {
    for (const msg of newMessages) {
      // Check if message exists to avoid duplicates
      const existingMsgList = await db.select().from(messages).where(eq(messages.id, msg.id));
      if (existingMsgList.length === 0) {
        await db.insert(messages).values({
          id: msg.id,
          threadId: threadId,
          role: msg.role,
          content: msg.content,
        });
      }
    }
  }

  return c.json({ success: true, message: "Sync complete" });
});

export default chat;
