const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const SUPPORTED_BROWSER_ACTIONS = new Set([
  "open_url",
  "search_google",
  "search_youtube",
  "click_text",
  "click_search_result",
  "site_search",
  "read_page"
]);

function normalizeWhitespace(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function safeJsonParse(raw = "") {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const match = String(raw).match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (__error) {
      return null;
    }
  }
}

function cleanupText(value = "") {
  return normalizeWhitespace(value);
}

function normalizePlanStep(step = {}) {
  if (!step || typeof step !== "object") {
    return null;
  }

  const action = cleanupText(step.action).toLowerCase();

  if (!SUPPORTED_BROWSER_ACTIONS.has(action)) {
    return null;
  }

  const normalized = { action };

  if (action === "open_url" && step.target) {
    normalized.target = cleanupText(step.target);
  }

  if ((action === "search_google" || action === "search_youtube" || action === "site_search") && step.query) {
    normalized.query = cleanupText(step.query);
  }

  if (action === "click_text" && step.text) {
    normalized.text = cleanupText(step.text);
  }

  if (action === "click_search_result") {
    const index = Number(step.index || 1);
    normalized.index = Number.isFinite(index) && index > 0 ? Math.floor(index) : 1;
  }

  if (action === "read_page") {
    const limit = Number(step.limit || 4000);
    normalized.limit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 4000;
  }

  if (
    (action === "open_url" && !normalized.target) ||
    ((action === "search_google" || action === "search_youtube" || action === "site_search") && !normalized.query) ||
    (action === "click_text" && !normalized.text)
  ) {
    return null;
  }

  return normalized;
}

function normalizeLogin(login = null) {
  if (!login || typeof login !== "object") {
    return null;
  }

  if (!login.required) {
    return null;
  }

  return {
    required: true,
    mode: cleanupText(login.mode || "manual") || "manual",
    site: cleanupText(login.site || "")
  };
}

function normalizeOpenClawBrowserPlan(rawPlan = {}) {
  const candidate =
    rawPlan && typeof rawPlan === "object" && !Array.isArray(rawPlan)
      ? rawPlan.plan && typeof rawPlan.plan === "object"
        ? rawPlan.plan
        : rawPlan
      : {};

  const steps = Array.isArray(candidate.steps)
    ? candidate.steps.map(normalizePlanStep).filter(Boolean).slice(0, 6)
    : [];

  return {
    reply: cleanupText(candidate.reply || ""),
    rationale: cleanupText(candidate.rationale || candidate.reasoning || ""),
    steps,
    login: normalizeLogin(candidate.login)
  };
}

function buildBrowserPlannerPrompt(input, context = {}) {
  return [
    "You are the OpenClaw browser planner embedded inside Jarvis Desktop.",
    "Return JSON only. Do not wrap the answer in Markdown.",
    'Use this schema: {"reply":"","rationale":"","steps":[{"action":"open_url","target":"https://..."},{"action":"site_search","query":"..."},{"action":"read_page","limit":4000}],"login":{"required":true,"mode":"manual","site":"GitHub"}}',
    "Allowed actions only: open_url, search_google, search_youtube, click_text, click_search_result, site_search, read_page.",
    "Keep steps short and deterministic. Prefer direct official sites over app-store detours when the user wants an official page or a download page.",
    "If the user is already inside the relevant browser context, keep working inside that context instead of restarting from a generic homepage.",
    "For mailbox follow-ups, stay inside the current mailbox context unless the user explicitly asks to leave it.",
    "If a login is needed, include the post-login steps and set login.required=true.",
    `Context JSON:\n${JSON.stringify(
      {
        userGoal: input,
        currentBrowserUrl: context.currentBrowserUrl || "",
        currentBrowserLabel: context.currentBrowserLabel || "",
        mailboxContext: Boolean(context.mailboxContext),
        pendingContinuation: Boolean(context.pendingContinuation),
        preferredSite: context.preferredSite || "",
        officialSiteRequested: Boolean(context.officialSiteRequested),
        downloadRequested: Boolean(context.downloadRequested)
      },
      null,
      2
    )}`
  ].join("\n\n");
}

class OpenClawService {
  constructor({ workspaceRoot, clawRoot, logger, commandTimeoutMs } = {}) {
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.clawRoot =
      clawRoot ||
      path.resolve(__dirname, "../../claw-code-main 복사본/rust");
    this.logger = logger || console;
    this.commandTimeoutMs = Number(commandTimeoutMs || process.env.JARVIS_OPENCLAW_TIMEOUT_MS || 120000);
    this.binaryPath = path.join(this.clawRoot, "target", "debug", "claw");
  }

  async pathExists(targetPath) {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async isAvailable() {
    if (String(process.env.JARVIS_OPENCLAW_ENABLED || "1").trim() === "0") {
      return false;
    }

    if (await this.pathExists(this.binaryPath)) {
      return true;
    }

    return this.pathExists(path.join(this.clawRoot, "Cargo.toml"));
  }

  async hasSavedSession() {
    const sessionsDir = path.join(this.workspaceRoot, ".claw", "sessions");

    try {
      const entries = await fs.readdir(sessionsDir, {
        withFileTypes: true
      });
      return entries.some((entry) => entry.isFile() && entry.name.endsWith(".jsonl"));
    } catch (_error) {
      return false;
    }
  }

  async resolveCommandArgs(prompt, { model = "", permissionMode = "read-only" } = {}) {
    const promptArgs = [
      "--output-format",
      "json",
      "--permission-mode",
      permissionMode
    ];

    if (model) {
      promptArgs.push("--model", model);
    }

    if (await this.hasSavedSession()) {
      promptArgs.push("--resume", "latest");
    }

    promptArgs.push("prompt", prompt);

    if (await this.pathExists(this.binaryPath)) {
      return {
        command: this.binaryPath,
        args: promptArgs,
        cwd: this.workspaceRoot
      };
    }

    const manifestPath = path.join(this.clawRoot, "Cargo.toml");

    return {
      command: "cargo",
      args: [
        "run",
        "--manifest-path",
        manifestPath,
        "-p",
        "rusty-claude-cli",
        "--",
        ...promptArgs
      ],
      cwd: this.workspaceRoot
    };
  }

  async runPrompt(prompt, options = {}) {
    const invocation = await this.resolveCommandArgs(prompt, options);
    const result = await execFileAsync(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      timeout: this.commandTimeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env
      }
    });

    const parsed = safeJsonParse(result.stdout || "");

    if (!parsed || typeof parsed.message !== "string") {
      throw new Error(
        `OpenClaw returned an unreadable response.${result.stderr ? ` ${String(result.stderr).trim()}` : ""}`
      );
    }

    return {
      ...parsed,
      commandLine: [invocation.command, ...invocation.args].join(" "),
      stderr: String(result.stderr || "")
    };
  }

  async planBrowserTask(input, context = {}) {
    if (!(await this.isAvailable())) {
      throw new Error("OpenClaw CLI is not available in this workspace.");
    }

    const prompt = buildBrowserPlannerPrompt(input, context);
    const response = await this.runPrompt(prompt, {
      permissionMode: "read-only"
    });
    const plan = normalizeOpenClawBrowserPlan(response.message);

    if (!plan.steps.length) {
      throw new Error("OpenClaw returned no supported browser steps.");
    }

    return {
      plan,
      sessionRef: "latest",
      rawMessage: response.message,
      usage: response.usage || null,
      toolUses: Array.isArray(response.tool_uses) ? response.tool_uses : [],
      commandLine: response.commandLine
    };
  }
}

module.exports = {
  OpenClawService,
  buildBrowserPlannerPrompt,
  normalizeOpenClawBrowserPlan
};
