import { Hono } from "hono";
import { jwt } from "hono/jwt";

const speech = new Hono<{ Bindings: { JWT_SECRET: string; GROQ_API_KEY: string } }>();

// Apply JWT middleware to secure the speech endpoint
speech.use("/*", (c, next) => {
  const jwtMiddleware = jwt({
    secret: "jarvis-permanent-secret-key-2024-v1",
    alg: "HS256",
  });
  return jwtMiddleware(c, next);
});

speech.post("/transcribe", async (c) => {
  // In a real implementation, we would extract the audio blob/file from c.req
  // and forward it to Groq or OpenAI Whisper API using the securely stored API key.
  
  // const body = await c.req.parseBody();
  // const audioFile = body['file'];
  
  if (!c.env.GROQ_API_KEY) {
    return c.json({ error: "STT API key is not configured on the server" }, 500);
  }

  // Placeholder logic
  return c.json({ 
    success: true, 
    text: "이것은 서버에서 변환된 가상의 텍스트입니다. (STT Proxy 준비 완료)" 
  });
});

export default speech;
