import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  name: text("name"),
  googleSubject: text("google_subject").unique(),
  geminiApiKeyEncrypted: text("gemini_api_key_encrypted"),
  // Plan: "free" | "pro"
  plan: text("plan").notNull().default("free"),
  // Daily rate limiting
  dailyMessageCount: integer("daily_message_count").notNull().default(0),
  dailyTokenCount: integer("daily_token_count").notNull().default(0),
  lastMessageDate: text("last_message_date").default(""),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

export const googleSignInAttempts = sqliteTable("google_sign_in_attempts", {
  id: text("id").primaryKey(),
  clientChallenge: text("client_challenge").notNull(),
  browserChallenge: text("browser_challenge"),
  redirectUri: text("redirect_uri"),
  status: text("status").notNull(),
  identityJson: text("identity_json"),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("google_sign_in_expiry").on(table.expiresAt)]);

export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  title: text("title"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => threads.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});
