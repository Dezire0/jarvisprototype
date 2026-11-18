import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SessionBindings } from "./session";

type Bindings = SessionBindings & {
  DB: D1Database;
  GEMINI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.onError((_error, c) => {
  console.error("Worker request failed");
  return c.json({ error: "Request failed" }, 500);
});

app.use("*", async (c, next) => {
  await next();
  console.log(`[REQUEST] ${c.req.method} ${c.res.status}`);
});

app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  })
);

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
