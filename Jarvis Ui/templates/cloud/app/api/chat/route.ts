import { createHmac, timingSafeEqual } from "node:crypto";

const bytesLimit = 8 * 1024 * 1024;
const sessionHeader = "x-jarvis-desktop-session";
const hex = /^[a-f0-9]{64}$/;
const responseHeaders = { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" };

function desktopSession(req: Request) {
  const token = process.env.JARVIS_DESKTOP_SESSION_TOKEN;
  const origin = process.env.JARVIS_UI_ORIGIN;
  if (!token || !hex.test(token) || !origin || !URL.canParse(origin)) return null;

  const url = new URL(origin);
  const host = req.headers.get("host") || new URL(req.url).host;
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== origin || url.host !== host) {
    return null;
  }
  return { token, origin };
}

function transportUrl() {
  const raw = process.env.JARVIS_TRANSPORT_URL;
  if (!raw || !URL.canParse(raw)) return null;

  const url = new URL(raw);
  return url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    url.pathname === "/assistant" &&
    !url.username && !url.password && !url.search && !url.hash
    ? url
    : null;
}

export function GET(req: Request) {
  const current = desktopSession(req);
  const challenge = new URL(req.url).searchParams.get("challenge");
  if (!current || !challenge || !hex.test(challenge)) return new Response(null, { status: 404 });

  const proof = createHmac("sha256", current.token).update("jarvis-desktop-ui:" + challenge).digest("hex");
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store", "x-jarvis-ui-proof": proof },
  });
}

function error(message: string, status: number) {
  return new Response(message, { status, headers: responseHeaders });
}

export async function POST(req: Request) {
  const current = desktopSession(req);
  const upstreamUrl = transportUrl();
  if (!current || !upstreamUrl) return error("Open Jarvis Desktop to connect to the assistant.", 503);

  const received = req.headers.get(sessionHeader);
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if ((origin && origin !== current.origin) || (site && site !== "same-origin")) {
    return error("This request must come from the desktop workspace.", 403);
  }
  if (!received || !hex.test(received) ||
      !timingSafeEqual(Buffer.from(current.token, "hex"), Buffer.from(received, "hex"))) {
    return error("This request must come from the desktop workspace.", 401);
  }
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return error("JSON is required.", 415);
  }
  if (Number(req.headers.get("content-length")) > bytesLimit) {
    return error("The request is too large.", 413);
  }

  const reader = req.body?.getReader();
  if (!reader) return error("JSON is required.", 400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > bytesLimit) {
        void reader.cancel().catch(() => {});
        return error("The request is too large.", 413);
      }
      chunks.push(value);
    }
  } catch {
    return error("Could not read the request.", 400);
  } finally {
    reader.releaseLock();
  }

  const headersDeadline = new AbortController();
  const timeout = setTimeout(() => headersDeadline.abort(), 10000);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", [sessionHeader]: current.token },
      body: Buffer.concat(chunks, bytes),
      redirect: "error",
      signal: AbortSignal.any([req.signal, headersDeadline.signal]),
    });

    if (!upstream.ok) {
      void upstream.body?.cancel().catch(() => {});
      return error("The assistant could not accept the request.", upstream.status);
    }

    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "x-vercel-ai-data-stream"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return error("The local assistant is unavailable. Open Jarvis Desktop and try again.", 503);
  } finally {
    clearTimeout(timeout);
  }
}
