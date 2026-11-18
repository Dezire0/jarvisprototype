import type { MiddlewareHandler } from "hono";
import { sign, verify } from "hono/jwt";

const ISSUER = "jarvis-auth-service";
const AUDIENCE = "jarvis-workspace";
const LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export type SessionBindings = { JARVIS_SESSION_SIGNING_KEY?: string };
export type SessionVariables = { jwtPayload: { id: string } };

export function sessionSigningKey(bindings: SessionBindings): string | null {
  const key = bindings?.JARVIS_SESSION_SIGNING_KEY;
  return typeof key === "string" && /^[0-9a-f]{64}$/i.test(key) ? key : null;
}

export async function issueSession(account: { id: string; email: string }, key: string) {
  const now = Math.floor(Date.now() / 1000);
  return sign({
    id: account.id,
    email: account.email,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + LIFETIME_SECONDS,
  }, key, "HS256");
}

export const requireSession: MiddlewareHandler<{
  Bindings: SessionBindings;
  Variables: SessionVariables;
}> = async (c, next) => {
  c.header("Cache-Control", "no-store");
  const key = sessionSigningKey(c.env);
  if (!key) return c.json({ error: "Account service is unavailable" }, 503);

  const authorization = c.req.header("Authorization");
  const bearer = authorization && authorization.length < 4096
    ? /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(authorization)
    : null;
  if (!bearer) return c.json({ error: "Unauthorized: Invalid session" }, 401);

  try {
    const session = await verify(bearer[1], key, "HS256");
    if (session.iss !== ISSUER || session.aud !== AUDIENCE ||
        !Number.isInteger(session.exp) || Number(session.exp) <= Math.floor(Date.now() / 1000) ||
        typeof session.id !== "string" || !session.id.trim() || session.id.length > 128) {
      return c.json({ error: "Unauthorized: Invalid session" }, 401);
    }
    c.set("jwtPayload", { id: session.id });
  } catch {
    return c.json({ error: "Unauthorized: Invalid session" }, 401);
  }
  await next();
};
