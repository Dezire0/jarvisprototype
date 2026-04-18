const DEFAULT_TRANSPORT_URL = "http://127.0.0.1:8010/assistant";

function getTransportUrl() {
  return (
    process.env.JARVIS_TRANSPORT_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    DEFAULT_TRANSPORT_URL
  );
}

function copyStreamingHeaders(response: Response) {
  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  const cacheControl = response.headers.get("cache-control");
  const connection = response.headers.get("connection");
  const streamVersion = response.headers.get("x-vercel-ai-data-stream");

  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Content-Type", contentType || "text/plain; charset=utf-8");

  if (cacheControl) {
    headers.set("Cache-Control", cacheControl);
  }

  if (connection) {
    headers.set("Connection", connection);
  }

  if (streamVersion) {
    headers.set("x-vercel-ai-data-stream", streamVersion);
  }

  return headers;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function POST(req: Request) {
  const transportUrl = getTransportUrl();
  const body = await req.text();
  const upstream = await fetch(transportUrl, {
    method: "POST",
    headers: {
      "Content-Type": req.headers.get("content-type") || "application/json",
    },
    body,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: copyStreamingHeaders(upstream),
  });
}
