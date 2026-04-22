import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
  GEMINI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/*", cors());

app.get("/", (c) => {
  return c.text("Jarvis Backend API v2 (Cloudflare Workers + D1) is running!");
});

import auth from "./routes/auth";
import chat from "./routes/chat";
import ai from "./routes/ai";
import settings from "./routes/settings";

app.route("/api/auth", auth);
app.route("/api/chat", chat);
app.route("/api/ai", ai);
app.route("/api/settings", settings);

export default app;
