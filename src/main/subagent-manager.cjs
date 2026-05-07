const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_AGENT_DEPTH = 3;
const DEFAULT_LOG_PATH = path.resolve(__dirname, "..", "..", "data", "subagent-messages.log");

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value = "", limit = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeDepth(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.floor(numeric));
}

function createPossibleFix(message = "") {
  const text = String(message || "");
  if (/depth/i.test(text)) {
    return `Keep sub-agent delegation at depth ${MAX_AGENT_DEPTH} or lower, or collapse the work back into the parent agent.`;
  }
  if (/accessibility|permission|not authorized|not permitted/i.test(text)) {
    return "Ask the user to enable Accessibility permission for Jarvis Desktop in System Settings before retrying.";
  }
  if (/session not found|already finished|not running/i.test(text)) {
    return "List the current subagents first, then steer or kill only a running sessionId.";
  }
  return "";
}

class AsyncMutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  async runExclusive(work) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

function createLockedBrowser(browser, mutex) {
  if (!browser || !mutex) {
    return browser;
  }

  return new Proxy(browser, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") {
        return value;
      }

      if (property === "createIsolatedSession") {
        return value.bind(target);
      }

      return async (...args) => mutex.runExclusive(() => value.apply(target, args));
    }
  });
}

class SubAgentManager {
  constructor({
    createRuntime,
    sharedBrowser = null,
    createIsolatedBrowserSession = null,
    maxDepth = MAX_AGENT_DEPTH,
    logFilePath = DEFAULT_LOG_PATH
  } = {}) {
    this.createRuntime = createRuntime;
    this.sharedBrowser = sharedBrowser;
    this.createIsolatedBrowserSession = createIsolatedBrowserSession;
    this.maxDepth = normalizeDepth(maxDepth, MAX_AGENT_DEPTH) || MAX_AGENT_DEPTH;
    this.logFilePath = logFilePath || DEFAULT_LOG_PATH;
    this.sessions = new Map();
    this.sharedBrowserMutex = new AsyncMutex();
  }

  ensureLogFile() {
    try {
      fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
      if (!fs.existsSync(this.logFilePath)) {
        fs.writeFileSync(this.logFilePath, "");
      }
    } catch (_error) {
      // Logging is best-effort; runtime control should continue even if the file cannot be created.
    }
  }

  appendLog(source = "Agent", target = "SubAgent", message = "", extra = {}) {
    this.ensureLogFile();
    const line = JSON.stringify({
      at: nowIso(),
      flow: `[${source} -> ${target}]`,
      message: normalizeText(message, 1200),
      ...extra
    });

    try {
      fs.appendFileSync(this.logFilePath, `${line}\n`);
    } catch (_error) {
      // Ignore log write failures to avoid blocking the main automation path.
    }
  }

  buildSessionView(session = {}) {
    return {
      sessionId: session.sessionId || "",
      agentId: session.agentId || "",
      parentSessionId: session.parentSessionId || "",
      depth: normalizeDepth(session.depth, 0),
      status: session.status || "unknown",
      task: session.task || "",
      isolatedBrowser: Boolean(session.isolatedBrowser),
      createdAt: session.createdAt || "",
      updatedAt: session.updatedAt || "",
      finalSummary: session.finalSummary || "",
      error: session.error || "",
      possible_fix: session.possibleFix || "",
      pendingSteers: Array.isArray(session.pendingSteers) ? session.pendingSteers.length : 0
    };
  }

  getSession(sessionId = "") {
    return this.sessions.get(String(sessionId || "").trim()) || null;
  }

  list(sessionId = "") {
    const normalizedId = String(sessionId || "").trim();
    if (normalizedId) {
      const session = this.getSession(normalizedId);
      return session ? [this.buildSessionView(session)] : [];
    }
    return Array.from(this.sessions.values())
      .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
      .map((session) => this.buildSessionView(session));
  }

  async resolveBrowserHandle(session = {}) {
    if (typeof this.createIsolatedBrowserSession === "function") {
      try {
        const isolated = await this.createIsolatedBrowserSession(session);
        if (isolated) {
          return {
            browser: isolated,
            isolatedBrowser: true
          };
        }
      } catch (error) {
        this.appendLog(
          session.parentSessionId || "Agent",
          session.sessionId || "SubAgent",
          "Failed to create isolated browser session; falling back to shared browser lock.",
          { error: String(error?.message || error || "") }
        );
      }
    }

    return {
      browser: createLockedBrowser(this.sharedBrowser, this.sharedBrowserMutex),
      isolatedBrowser: false
    };
  }

  async spawn({ task = "", agentId = "", depth = 0, parentSessionId = "", language = "en" } = {}) {
    const normalizedDepth = normalizeDepth(depth, 0);
    if (normalizedDepth > this.maxDepth) {
      const error = `sessions_spawn depth ${normalizedDepth} exceeds MAX_AGENT_DEPTH ${this.maxDepth}.`;
      return {
        state: null,
        error,
        possible_fix: createPossibleFix(error)
      };
    }

    if (typeof this.createRuntime !== "function") {
      return {
        state: null,
        error: "Sub-agent runtime factory is unavailable.",
        possible_fix: "Recreate the BrowserAgentRuntime with a sub-agent manager attached before using sessions_spawn."
      };
    }

    const sessionId = `subagent-${crypto.randomUUID().slice(0, 8)}`;
    const session = {
      sessionId,
      parentSessionId: String(parentSessionId || "").trim(),
      agentId: normalizeText(agentId || "subagent", 80) || "subagent",
      task: normalizeText(task, 800),
      depth: normalizedDepth,
      language: String(language || "en").trim() || "en",
      status: "queued",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      finalSummary: "",
      error: "",
      possibleFix: "",
      pendingSteers: [],
      abortController: new AbortController(),
      result: null,
      isolatedBrowser: false,
      closeBrowser: async () => {}
    };
    this.sessions.set(sessionId, session);
    this.appendLog(
      session.parentSessionId || "Agent",
      session.agentId,
      `Spawn requested for "${session.task}"`,
      { sessionId, depth: normalizedDepth }
    );

    const handle = await this.resolveBrowserHandle(session);
    session.browser = handle.browser;
    session.isolatedBrowser = Boolean(handle.isolatedBrowser);
    if (handle.browser && typeof handle.browser.close === "function" && handle.isolatedBrowser) {
      session.closeBrowser = async () => handle.browser.close().catch(() => {});
    }

    const runtime = this.createRuntime({
      session,
      browser: session.browser
    });
    session.runtime = runtime;
    session.status = "running";
    session.updatedAt = nowIso();

    const consumeExternalNotes = () => {
      const notes = Array.isArray(session.pendingSteers) ? [...session.pendingSteers] : [];
      session.pendingSteers = [];
      if (notes.length) {
        session.updatedAt = nowIso();
      }
      return notes;
    };

    session.promise = (async () => {
      try {
        const initialState = session.browser && typeof session.browser.observe === "function"
          ? await session.browser.observe().catch(() => null)
          : null;
        const result = await runtime.runLoop({
          input: session.task,
          language: session.language,
          initialState,
          sessionContext: {
            sessionId,
            parentSessionId: session.parentSessionId,
            agentId: session.agentId,
            depth: session.depth,
            subAgent: true
          },
          abortSignal: session.abortController.signal,
          consumeExternalNotes
        });
        session.result = result;
        session.finalSummary = normalizeText(result?.finalSummary || "", 1200);
        session.error = "";
        session.possibleFix = "";
        session.status = result?.stopReason === "killed" ? "killed" : "completed";
        session.updatedAt = nowIso();
        this.appendLog(session.agentId, session.parentSessionId || "Agent", session.finalSummary || session.status, {
          sessionId,
          status: session.status
        });
      } catch (error) {
        const message = String(error?.message || error || "Sub-agent failed.");
        session.status = "failed";
        session.error = message;
        session.possibleFix = createPossibleFix(message);
        session.updatedAt = nowIso();
        this.appendLog(session.agentId, session.parentSessionId || "Agent", message, {
          sessionId,
          status: "failed"
        });
      } finally {
        await session.closeBrowser();
      }
    })();

    return {
      state: {
        session: this.buildSessionView(session)
      },
      error: null
    };
  }

  async steer(sessionId = "", message = "") {
    const session = this.getSession(sessionId);
    if (!session) {
      const error = `Sub-agent session not found: ${sessionId || "(missing sessionId)"}.`;
      return { state: null, error, possible_fix: createPossibleFix(error) };
    }
    if (session.status !== "running") {
      const error = `Sub-agent session ${sessionId} is not running. Current status: ${session.status}.`;
      return { state: { session: this.buildSessionView(session) }, error, possible_fix: createPossibleFix(error) };
    }

    const note = normalizeText(message, 500);
    if (!note) {
      return {
        state: { session: this.buildSessionView(session) },
        error: "subagents steer requires a non-empty steering message."
      };
    }

    session.pendingSteers.push(note);
    session.updatedAt = nowIso();
    this.appendLog(session.parentSessionId || "Agent", session.agentId, note, {
      sessionId,
      action: "steer"
    });
    return {
      state: { session: this.buildSessionView(session) },
      error: null
    };
  }

  async kill(sessionId = "") {
    const session = this.getSession(sessionId);
    if (!session) {
      const error = `Sub-agent session not found: ${sessionId || "(missing sessionId)"}.`;
      return { state: null, error, possible_fix: createPossibleFix(error) };
    }

    if (session.status === "completed" || session.status === "failed" || session.status === "killed") {
      return {
        state: { session: this.buildSessionView(session) },
        error: null
      };
    }

    session.abortController.abort();
    session.status = "killing";
    session.updatedAt = nowIso();
    this.appendLog(session.parentSessionId || "Agent", session.agentId, "Kill requested.", {
      sessionId,
      action: "kill"
    });
    return {
      state: { session: this.buildSessionView(session) },
      error: null
    };
  }
}

module.exports = {
  DEFAULT_LOG_PATH,
  MAX_AGENT_DEPTH,
  SubAgentManager,
  createPossibleFix
};
