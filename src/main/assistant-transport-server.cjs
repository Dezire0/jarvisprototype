const http = require("node:http");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = Number(process.env.JARVIS_ASSISTANT_PORT || 8010);
const STREAM_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "Content-Type": "text/plain; charset=utf-8",
  "x-vercel-ai-data-stream": "v1"
};
const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8"
};

function createId(prefix = "msg") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function chunkText(text = "", size = 28) {
  const chunks = [];

  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }

  return chunks.length ? chunks : [""];
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function prefersKorean(text = "") {
  return /[ㄱ-ㅎ가-힣]/.test(String(text || ""));
}

function buildRunningProgressSteps(text = "") {
  const normalized = String(text || "").toLowerCase();
  const isKo = prefersKorean(text);

  if (/(로그인|login|sign in|log in)/i.test(normalized)) {
    return isKo
      ? [
          "현재 사이트와 로그인 문맥을 확인하는 중",
          "로그인 진입점을 찾는 중",
          "아이디와 비밀번호 입력 칸을 찾는 중",
          "입력 후 화면 상태를 다시 확인하는 중"
        ]
      : [
          "Checking the current site and login context",
          "Finding the login entry point",
          "Locating the username and password fields",
          "Re-checking the page after the form step"
        ];
  }

  if (/(메일|이메일|gmail|outlook|email|mail|message)/i.test(normalized)) {
    return isKo
      ? [
          "현재 메일함 문맥을 확인하는 중",
          "가장 관련 있는 메시지를 찾는 중",
          "열린 메일 화면을 다시 확인하는 중"
        ]
      : [
          "Checking the current mailbox context",
          "Finding the most relevant message",
          "Re-checking the opened mail view"
        ];
  }

  if (/(브라우저|browser|사이트|url|검색|search|amazon|github|google|youtube)/i.test(normalized)) {
    return isKo
      ? [
          "현재 브라우저 문맥을 확인하는 중",
          "다음 웹 동작을 계획하는 중",
          "클릭하거나 입력할 요소를 찾는 중",
          "실행 결과를 다시 확인하는 중"
        ]
      : [
          "Checking the current browser context",
          "Planning the next web action",
          "Finding the element to click or type into",
          "Re-checking the result after execution"
        ];
  }

  return isKo
    ? [
        "현재 작업 문맥을 확인하는 중",
        "다음 동작을 계획하는 중",
        "실행 결과를 다시 확인하는 중"
      ]
    : [
        "Checking the current task context",
        "Planning the next action",
        "Re-checking the result after execution"
      ];
}

function buildRunningMessageDetails(text = "") {
  const progressSteps = buildRunningProgressSteps(text);

  return {
    livePreview: true,
    progressLabel: progressSteps[0] || "",
    progressSteps
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function normalizeState(rawState = {}) {
  const messages = Array.isArray(rawState?.messages) ? rawState.messages : [];

  return {
    messages: messages
      .filter((message) => message && typeof message === "object")
      .map((message) => ({
        id: typeof message.id === "string" ? message.id : createId(message.role === "assistant" ? "assistant" : "user"),
        role: message.role === "assistant" ? "assistant" : "user",
        text: typeof message.text === "string" ? message.text : "",
        createdAt: typeof message.createdAt === "string" ? message.createdAt : new Date().toISOString(),
        status: message.status === "running" ? "running" : "complete",
        provider: typeof message.provider === "string" ? message.provider : "",
        actions: Array.isArray(message.actions) ? message.actions : [],
        details: message.details && typeof message.details === "object" ? message.details : null
      }))
  };
}

function extractUserText(commands = []) {
  for (const command of commands) {
    if (command?.type !== "add-message" || command?.message?.role !== "user") {
      continue;
    }

    const parts = Array.isArray(command.message.parts) ? command.message.parts : [];
    const text = parts
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
}

function normalizeMemoryContext(rawContext = {}, threadId = "") {
  const context = rawContext && typeof rawContext === "object" ? rawContext : {};

  return {
    threadId,
    projectId: typeof context.projectId === "string" ? context.projectId.trim() : "",
    projectName: typeof context.projectName === "string" ? context.projectName.trim() : "",
    threadTitle: typeof context.threadTitle === "string" ? context.threadTitle.trim() : "",
    memoryMode: context.memoryMode === "temporary" ? "temporary" : "persistent"
  };
}

function writeChunk(res, type, value) {
  res.write(`${type}:${JSON.stringify(value)}\n`);
}

function writeStateSet(res, nextState) {
  writeChunk(res, "aui-state", [
    {
      type: "set",
      path: [],
      value: nextState
    }
  ]);
}

function writeStateAppendText(res, messageIndex, value) {
  writeChunk(res, "aui-state", [
    {
      type: "append-text",
      path: ["messages", String(messageIndex), "text"],
      value
    }
  ]);
}

function writeStateField(res, messageIndex, field, value) {
  writeChunk(res, "aui-state", [
    {
      type: "set",
      path: ["messages", String(messageIndex), field],
      value
    }
  ]);
}

function writeFinish(res) {
  writeChunk(res, "d", {
    finishReason: "stop",
    usage: {
      inputTokens: 0,
      outputTokens: 0
    }
  });
}

function writeError(res, message) {
  writeChunk(res, "3", String(message || "Unknown assistant transport error."));
}

function writeAuthCallbackPage(res) {
  res.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "text/html; charset=utf-8"
  });
  res.end(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Jarvis Login Complete</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #080808; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(420px, calc(100vw - 32px)); padding: 28px; border: 1px solid rgba(255,255,255,.12); border-radius: 18px; background: rgba(255,255,255,.04); }
      h1 { margin: 0 0 10px; font-size: 22px; }
      p { margin: 0; color: #a1a1aa; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>Jarvis 로그인 완료</h1>
      <p>세션을 Jarvis Desktop으로 전달했습니다. 이 창은 닫아도 됩니다.</p>
    </main>
    <script>setTimeout(() => window.close(), 900);</script>
  </body>
</html>`);
}

function createThreadAssistantResolver(createAssistantForThread) {
  const cache = new Map();

  return (threadId) => {
    const cacheKey = threadId || "default-thread";

    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, createAssistantForThread(cacheKey));
    }

    return cache.get(cacheKey);
  };
}

function createAssistantTransportServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  createAssistantForThread,
  onAuthCallback,
  allowDynamicPort = true
}) {
  if (typeof createAssistantForThread !== "function") {
    throw new Error("createAssistantForThread is required.");
  }

  const resolveAssistant = createThreadAssistantResolver(createAssistantForThread);
  let server = null;
  let activePort = Number(port) || DEFAULT_PORT;

  async function handleAssistantRequest(req, res) {
    let payload;

    try {
      payload = await readJson(req);
    } catch (error) {
      res.writeHead(400, STREAM_HEADERS);
      writeError(res, `Invalid JSON payload: ${error.message}`);
      res.end();
      return;
    }

    const threadId = typeof payload?.threadId === "string" && payload.threadId.trim() ? payload.threadId.trim() : "default-thread";
    const assistant = resolveAssistant(threadId);
    const state = normalizeState(payload?.state);
    const userText = extractUserText(payload?.commands);
    const memoryContext = normalizeMemoryContext(payload?.memoryContext, threadId);

    if (!userText) {
      res.writeHead(200, STREAM_HEADERS);
      writeStateSet(res, state);
      writeFinish(res);
      res.end();
      return;
    }

    const assistantMessage = {
      id: createId("assistant"),
      role: "assistant",
      text: "",
      createdAt: new Date().toISOString(),
      status: "running",
      provider: "",
      actions: [],
      details: buildRunningMessageDetails(userText)
    };
    const nextState = {
      messages: [
        ...state.messages,
        {
          id: createId("user"),
          role: "user",
          text: userText,
          createdAt: new Date().toISOString(),
          status: "complete",
          provider: "",
          details: null
        },
        assistantMessage
      ]
    };
    const assistantMessageIndex = nextState.messages.length - 1;

    res.writeHead(200, STREAM_HEADERS);
    writeStateSet(res, nextState);

    try {
      if (typeof assistant?.setSessionContext === "function") {
        await assistant.setSessionContext({
          ...memoryContext,
          stateMessages: state.messages
        });
      }

      const result = await assistant.handleInput(userText);
      const reply = typeof result?.reply === "string" ? result.reply : "";
      const provider = typeof result?.provider === "string" ? result.provider : "local";

      for (const piece of chunkText(reply)) {
        if (piece) {
          writeStateAppendText(res, assistantMessageIndex, piece);
          await delay(2);
        }
      }

      writeStateField(res, assistantMessageIndex, "status", "complete");
      writeStateField(res, assistantMessageIndex, "provider", provider);
      writeStateField(res, assistantMessageIndex, "actions", result.actions || []);
      writeStateField(res, assistantMessageIndex, "details", result.details || null);
      writeFinish(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeStateAppendText(res, assistantMessageIndex, message);
      writeStateField(res, assistantMessageIndex, "status", "complete");
      writeStateField(res, assistantMessageIndex, "provider", "local-error");
      writeFinish(res);
    }

    res.end();
  }

  const requestListener = async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, JSON_HEADERS);
      res.end(
        JSON.stringify({
          ok: true,
          service: "assistant-transport",
          host,
          port
        })
      );
      return;
    }

    if (req.method === "GET" && req.url?.startsWith("/auth/callback")) {
      const requestUrl = new URL(req.url, `http://${host}:${activePort}`);
      const token = requestUrl.searchParams.get("token") || "";
      const userRaw = requestUrl.searchParams.get("user") || "";

      if (!token || !userRaw) {
        res.writeHead(400, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: "Missing auth callback payload" }));
        return;
      }

      try {
        const user = JSON.parse(userRaw);

        if (typeof onAuthCallback === "function") {
          await onAuthCallback({ token, user });
        }

        writeAuthCallbackPage(res);
      } catch (error) {
        res.writeHead(400, JSON_HEADERS);
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      }

      return;
    }

    if (req.method === "POST" && req.url === "/assistant") {
      await handleAssistantRequest(req, res);
      return;
    }

    res.writeHead(404, JSON_HEADERS);
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
  };

  return {
    get url() {
      return `http://${host}:${activePort}/assistant`;
    },
    get authCallbackUrl() {
      return `http://${host}:${activePort}/auth/callback`;
    },
    start() {
      if (server) {
        return Promise.resolve();
      }

      server = http.createServer((req, res) => {
        Promise.resolve(requestListener(req, res)).catch((error) => {
          res.writeHead(500, STREAM_HEADERS);
          writeError(res, error instanceof Error ? error.message : String(error));
          res.end();
        });
      });

      const tryListen = (requestedPort) =>
        new Promise((resolve, reject) => {
          const handleError = (error) => {
            server.off("error", handleError);
            reject(error);
          };

          server.once("error", handleError);
          server.listen(requestedPort, host, () => {
            server.off("error", handleError);
            const address = server.address();
            activePort =
              typeof address === "object" && address && address.port
                ? address.port
                : requestedPort;
            resolve();
          });
        });

      return tryListen(activePort).catch((error) => {
        if (!allowDynamicPort || error?.code !== "EADDRINUSE") {
          throw error;
        }

        return tryListen(0);
      });
    },
    stop() {
      if (!server) {
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        const activeServer = server;
        server = null;
        activeServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

module.exports = {
  createAssistantTransportServer
};
