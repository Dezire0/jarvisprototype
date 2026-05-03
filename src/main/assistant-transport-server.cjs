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
      details: null
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
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json; charset=utf-8"
      });
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

    if (req.method === "POST" && req.url === "/assistant") {
      await handleAssistantRequest(req, res);
      return;
    }

    res.writeHead(404, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8"
    });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
  };

  return {
    get url() {
      return `http://${host}:${activePort}/assistant`;
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
