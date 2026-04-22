import { Hono } from "hono";
import { cors } from "hono/cors";

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/*", cors());

app.get("/", (c) => {
  return c.text("Jarvis Backend API (Cloudflare Workers + D1) is running!");
});

import auth from "./routes/auth";
import chat from "./routes/chat";
import speech from "./routes/speech";
import settings from "./routes/settings";

app.route("/api/auth", auth);
app.route("/api/chat", chat);
app.route("/api/speech", speech);
app.route("/api/settings", settings);

export default app;
