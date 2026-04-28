const { execFile } = require("node:child_process");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const DEFAULT_MODEL = process.env.JARVIS_MODEL || "qwen3:14b";
const CHAT_MODEL = process.env.JARVIS_CHAT_MODEL || DEFAULT_MODEL;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/chat";
const MODEL_CACHE_TTL_MS = 30_000;
const CLI_EXTRA_PATHS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".local", "bin"),
  path.join(os.homedir(), ".npm-global", "bin"),
  path.join(os.homedir(), ".bun", "bin")
];
const CLAUDE_CODE_COMMAND = pickFirstNonEmpty(
  process.env.CLAUDE_CODE_BIN,
  resolveCliCommand("claude", buildCommonCliCandidates("claude"))
);
const CLAUDE_CODE_ALLOWED_TOOLS = "Read,Grep,Glob";
const CLAUDE_CODE_TIMEOUT_MS = 120_000;
const CLAUDE_CODE_MAX_TURNS = 6;
const OPENAI_CLI_COMMAND = pickFirstNonEmpty(
  process.env.CODEX_CLI_BIN,
  process.env.OPENAI_CLI_BIN,
  resolveCliCommand("codex", buildCodexCliCandidates())
);
const GEMINI_CLI_COMMAND = pickFirstNonEmpty(
  process.env.GEMINI_CLI_BIN,
  resolveCliCommand("gemini", buildCommonCliCandidates("gemini"))
);
const CLI_LLM_TIMEOUT_MS = 180_000;

function fileExists(filePath = "") {
  try {
    return Boolean(filePath) && fsSync.existsSync(filePath);
  } catch (_error) {
    return false;
  }
}

function buildCliPath() {
  return [
    process.env.PATH,
    ...CLI_EXTRA_PATHS
  ]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join(path.delimiter);
}

function buildCliEnv() {
  return {
    ...process.env,
    PATH: buildCliPath()
  };
}

function buildCommonCliCandidates(command = "") {
  return CLI_EXTRA_PATHS.map((dir) => path.join(dir, command));
}

function buildCodexCliCandidates() {
  const extensionRoot = path.join(os.homedir(), ".vscode", "extensions");
  const extensionCandidates = [];

  try {
    const extensions = fsSync.readdirSync(extensionRoot, { withFileTypes: true });
    extensions
      .filter((entry) => entry.isDirectory() && /^openai\.chatgpt-/i.test(entry.name))
      .forEach((entry) => {
        const base = path.join(extensionRoot, entry.name, "bin");
        ["macos-aarch64", "macos-x64", "linux-x64", "linux-arm64"].forEach((platform) => {
          extensionCandidates.push(path.join(base, platform, "codex"));
        });
      });
  } catch (_error) {
    // VS Code extension fallback is best-effort; PATH and env overrides still work.
  }

  return [
    ...buildCommonCliCandidates("codex"),
    ...extensionCandidates
  ];
}

function resolveCliCommand(command = "", candidates = []) {
  const requested = String(command || "").trim();
  if (!requested) {
    return "";
  }

  if (requested.includes(path.sep) || path.isAbsolute(requested)) {
    return requested;
  }

  for (const dir of buildCliPath().split(path.delimiter)) {
    const candidate = path.join(dir, requested);
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return candidates.find(fileExists) || requested;
}

function normalizeProvider(value = "", fallback = "auto") {
  const normalized = String(value || "").trim().toLowerCase();
  const aliases = {
    auto: "auto",
    google: "gemini",
    gemini: "gemini",
    ollama: "ollama",
    openai: "openai-compatible",
    "openai-compatible": "openai-compatible",
    "local-openai": "openai-compatible",
    lmstudio: "openai-compatible",
    "lm-studio": "openai-compatible",
    jan: "openai-compatible",
    anythingllm: "openai-compatible",
    openwebui: "openai-compatible",
    "openai-cli": "openai-cli",
    "gpt-cli": "openai-cli",
    "codex-cli": "openai-cli",
    codex: "openai-cli",
    "gemini-cli": "gemini-cli",
    "claude-code": "claude-code",
    anthropic: "anthropic",
    claude: "anthropic"
  };

  return aliases[normalized] || fallback;
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();

    if (normalized) {
      return normalized;
    }
  }

  return "";
}

let externalApiKeyProvider = null;
let externalLlmSettingsProvider = null;

function setExternalApiKeyProvider(fn) {
  externalApiKeyProvider = fn;
}

function setExternalLlmSettingsProvider(fn) {
  externalLlmSettingsProvider = fn;
}

function getExternalLlmSettings() {
  if (!externalLlmSettingsProvider) {
    return null;
  }

  try {
    return externalLlmSettingsProvider() || null;
  } catch (_error) {
    return null;
  }
}

function getGeminiApiKey() {
  const settings = getExternalLlmSettings();
  if (settings?.gemini?.apiKey) {
    return settings.gemini.apiKey;
  }

  if (externalApiKeyProvider) {
    const key = externalApiKeyProvider("gemini");
    if (key) return key;
  }
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

function getOpenAICompatibleApiKey() {
  const settings = getExternalLlmSettings();
  if (settings?.openai?.apiKey) {
    return settings.openai.apiKey;
  }

  if (externalApiKeyProvider) {
    const key = externalApiKeyProvider("openai-compatible") || externalApiKeyProvider("openai");
    if (key) return key;
  }

  return String(process.env.JARVIS_COMPLEX_LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim();
}

function getAnthropicApiKey() {
  const settings = getExternalLlmSettings();
  if (settings?.anthropic?.apiKey) {
    return settings.anthropic.apiKey;
  }

  if (externalApiKeyProvider) {
    const key = externalApiKeyProvider("anthropic") || externalApiKeyProvider("claude");
    if (key) return key;
  }

  return String(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
}

function normalizeOpenAICompatibleUrl(value = "") {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw);
    const cleanPath = parsed.pathname.replace(/\/+$/g, "");

    if (/\/chat\/completions$/i.test(cleanPath)) {
      parsed.pathname = cleanPath;
      return parsed.toString();
    }

    if (!cleanPath || cleanPath === "/") {
      parsed.pathname = "/v1/chat/completions";
      return parsed.toString();
    }

    if (/\/v1$/i.test(cleanPath)) {
      parsed.pathname = `${cleanPath}/chat/completions`;
      return parsed.toString();
    }

    parsed.pathname = `${cleanPath}/chat/completions`;
    return parsed.toString();
  } catch (_error) {
    return raw;
  }
}

function looksLikeOllamaUrl(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return /\/api\/chat\/?$/i.test(normalized) || /127\.0\.0\.1:11434/i.test(normalized);
}

function hasGeminiConfig() {
  return Boolean(getGeminiApiKey());
}

function hasOpenAICompatibleConfig() {
  const settings = getExternalLlmSettings();
  const explicitUrl = pickFirstNonEmpty(
    settings?.openai?.baseUrl,
    process.env.JARVIS_COMPLEX_LLM_URL,
    process.env.OPENAI_BASE_URL
  );

  return Boolean(
    getOpenAICompatibleApiKey() ||
      (explicitUrl && !looksLikeOllamaUrl(explicitUrl))
  );
}

function hasAnthropicConfig() {
  return Boolean(getAnthropicApiKey());
}

function getRequestedProviderForTier(tier = "complex", requestedProvider = "") {
  const settings = getExternalLlmSettings();
  const settingsProvider = normalizeProvider(settings?.provider, "auto");

  return normalizeProvider(
    requestedProvider || (settingsProvider !== "auto" ? settingsProvider : "") || (tier === "fast"
      ? process.env.JARVIS_FAST_LLM_PROVIDER || "auto"
      : process.env.JARVIS_COMPLEX_LLM_PROVIDER || "auto"),
    "auto"
  );
}

function resolveProviderForTier(tier = "complex", requestedProvider = "") {
  const requested = getRequestedProviderForTier(tier, requestedProvider);

  if (requested !== "auto") {
    return requested;
  }

  if (hasGeminiConfig()) {
    return "gemini";
  }

  if (hasOpenAICompatibleConfig()) {
    return "openai-compatible";
  }

  if (hasAnthropicConfig()) {
    return "anthropic";
  }

  return "ollama";
}

function isUnconfiguredAutoFallback({ tier = "complex", provider } = {}) {
  const requested = getRequestedProviderForTier(tier, provider);

  return (
    requested === "auto" &&
    !hasGeminiConfig() &&
    !hasOpenAICompatibleConfig() &&
    !hasAnthropicConfig()
  );
}

function defaultModelForProvider(provider = "ollama") {
  const settings = getExternalLlmSettings();

  if (provider === "gemini") {
    return settings?.gemini?.model || process.env.GEMINI_LLM_MODEL || "gemini-2.5-flash";
  }

  if (provider === "openai-compatible") {
    return settings?.openai?.model || process.env.OPENAI_LLM_MODEL || "gpt-4o-mini";
  }

  if (provider === "openai-cli") {
    return settings?.openai?.model || process.env.OPENAI_LLM_MODEL || "gpt-4o-mini";
  }

  if (provider === "gemini-cli") {
    return settings?.gemini?.model || process.env.GEMINI_LLM_MODEL || "gemini-2.5-flash";
  }

  if (provider === "anthropic") {
    return settings?.anthropic?.model || process.env.ANTHROPIC_LLM_MODEL || process.env.CLAUDE_LLM_MODEL || "claude-haiku-4-5";
  }

  if (provider === "claude-code") {
    return settings?.anthropic?.model || process.env.CLAUDE_LLM_MODEL || process.env.ANTHROPIC_LLM_MODEL || "claude-haiku-4-5";
  }

  return settings?.ollama?.model || CHAT_MODEL;
}

function defaultUrlForProvider(provider = "ollama") {
  const settings = getExternalLlmSettings();

  if (provider === "openai-compatible") {
    const preferredUrl = pickFirstNonEmpty(settings?.openai?.baseUrl, process.env.JARVIS_COMPLEX_LLM_URL, process.env.OPENAI_BASE_URL);

    return (
      normalizeOpenAICompatibleUrl(looksLikeOllamaUrl(preferredUrl) ? process.env.OPENAI_BASE_URL : preferredUrl) ||
      "https://api.openai.com/v1/chat/completions"
    );
  }

  if (provider === "anthropic") {
    return pickFirstNonEmpty(settings?.anthropic?.baseUrl, process.env.ANTHROPIC_BASE_URL, "https://api.anthropic.com/v1/messages");
  }

  if (provider === "claude-code") {
    return "";
  }

  if (provider === "openai-cli" || provider === "gemini-cli") {
    return "";
  }

  return settings?.ollama?.url || OLLAMA_URL;
}

function defaultApiKeyForProvider(provider = "ollama") {
  if (provider === "gemini") {
    return getGeminiApiKey();
  }

  if (provider === "openai-compatible") {
    return getOpenAICompatibleApiKey();
  }

  if (provider === "anthropic") {
    return getAnthropicApiKey();
  }

  if (provider === "claude-code") {
    return "";
  }

  if (provider === "openai-cli" || provider === "gemini-cli") {
    return "";
  }

  return "";
}

function buildCliPrompt({ systemPrompt = "", history = [], userPrompt = "" } = {}) {
  const blocks = [];

  if (systemPrompt) {
    blocks.push(`System:\n${String(systemPrompt).trim()}`);
  }

  const conversation = history
    .filter((message) => String(message?.content || "").trim())
    .map((message) => {
      const role = message.role === "assistant" ? "Assistant" : "User";
      return `${role}:\n${String(message.content).trim()}`;
    })
    .join("\n\n");

  if (conversation) {
    blocks.push(conversation);
  }

  blocks.push(`User:\n${String(userPrompt || "").trim()}`);
  return blocks.filter(Boolean).join("\n\n");
}

function extractCliText(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map(extractCliText).filter(Boolean).join("\n").trim();
  }

  if (typeof value === "object") {
    for (const key of ["result", "response", "text", "content", "message", "output", "structured_output"]) {
      const text = extractCliText(value[key]);
      if (text) {
        return text;
      }
    }
  }

  return "";
}

function parseCliOutput(stdout = "") {
  const text = String(stdout || "").trim();

  if (!text) {
    return "";
  }

  try {
    const parsed = JSON.parse(text);
    return extractCliText(parsed) || text;
  } catch (_error) {
    // Fall back to plain text output if the CLI did not emit JSON.
  }

  return text;
}

async function withTempFile(prefix, callback) {
  const filePath = path.join(
    os.tmpdir(),
    `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  );

  try {
    return await callback(filePath);
  } finally {
    await fs.rm(filePath, { force: true }).catch(() => {});
  }
}

function buildCliError(label, error) {
  if (error?.code === "ENOENT") {
    return new Error(`${label} CLI is not installed or is not on PATH.`);
  }

  if (error?.killed || error?.signal === "SIGTERM") {
    return new Error(`${label} CLI timed out while generating a reply.`);
  }

  const detail = pickFirstNonEmpty(error?.stderr, error?.stdout, error?.message, `Unknown ${label} CLI error`);
  return new Error(`${label} CLI request failed: ${detail}`);
}

async function chatWithOpenAICli({
  systemPrompt,
  userPrompt,
  history = [],
  model = defaultModelForProvider("openai-cli")
}) {
  const prompt = buildCliPrompt({
    systemPrompt,
    history,
    userPrompt
  });

  if (!prompt) {
    throw new Error("OpenAI CLI prompt is empty.");
  }

  return withTempFile("jarvis-codex-reply", async (outputPath) => {
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--output-last-message",
      outputPath,
      "-C",
      process.cwd()
    ];

    if (model) {
      args.push("--model", String(model));
    }

    args.push(prompt);

    try {
      const { stdout } = await execFileAsync(OPENAI_CLI_COMMAND, args, {
        cwd: process.cwd(),
        env: buildCliEnv(),
        timeout: CLI_LLM_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024
      });
      const fileText = await fs.readFile(outputPath, "utf8").catch(() => "");
      const text = parseCliOutput(fileText || stdout);

      if (!text) {
        throw new Error("OpenAI CLI returned an empty response.");
      }

      return text;
    } catch (error) {
      throw buildCliError("OpenAI/Codex", error);
    }
  });
}

async function chatWithGeminiCli({
  systemPrompt,
  userPrompt,
  history = [],
  model = defaultModelForProvider("gemini-cli")
}) {
  const prompt = buildCliPrompt({
    systemPrompt,
    history,
    userPrompt
  });

  if (!prompt) {
    throw new Error("Gemini CLI prompt is empty.");
  }

  const args = ["--prompt", prompt, "--output-format", "json"];

  if (model) {
    args.push("--model", String(model));
  }

  try {
    const { stdout } = await execFileAsync(GEMINI_CLI_COMMAND, args, {
      cwd: process.cwd(),
      env: buildCliEnv(),
      timeout: CLI_LLM_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024
    });
    const text = parseCliOutput(stdout);

    if (!text) {
      throw new Error("Gemini CLI returned an empty response.");
    }

    return text;
  } catch (error) {
    throw buildCliError("Gemini", error);
  }
}

async function chatWithClaudeCode({
  systemPrompt,
  userPrompt,
  history = [],
  model = defaultModelForProvider("claude-code")
}) {
  const prompt = buildCliPrompt({
    history,
    userPrompt
  });

  if (!prompt) {
    throw new Error("Claude Code prompt is empty.");
  }

  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--max-turns",
    String(CLAUDE_CODE_MAX_TURNS),
    "--tools",
    CLAUDE_CODE_ALLOWED_TOOLS,
    "--permission-mode",
    "dontAsk"
  ];

  if (systemPrompt) {
    args.push("--append-system-prompt", String(systemPrompt));
  }

  if (model) {
    args.push("--model", String(model));
  }

  try {
    const { stdout } = await execFileAsync(CLAUDE_CODE_COMMAND, args, {
      cwd: process.cwd(),
      env: buildCliEnv(),
      timeout: CLAUDE_CODE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024
    });
    const text = parseClaudeCodeOutput(stdout);

    if (!text) {
      throw new Error("Claude Code returned an empty response.");
    }

    return text;
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "Claude Code CLI is not installed. Install Claude Code and sign in with `claude auth login` or run `claude` once."
      );
    }

    if (error?.killed || error?.signal === "SIGTERM") {
      throw new Error("Claude Code CLI timed out while generating a reply.");
    }

    const detail = pickFirstNonEmpty(error?.stderr, error?.stdout, error?.message, "Unknown Claude Code error");
    throw new Error(`Claude Code request failed: ${detail}`);
  }
}

const FAST_LLM_PROVIDER = resolveProviderForTier("fast");
const FAST_LLM_MODEL = process.env.JARVIS_FAST_LLM_MODEL || defaultModelForProvider(FAST_LLM_PROVIDER);
const FAST_ROUTER_MODEL =
  process.env.JARVIS_FAST_ROUTER_MODEL ||
  (FAST_LLM_PROVIDER === "ollama" ? process.env.JARVIS_ROUTER_MODEL || FAST_LLM_MODEL : FAST_LLM_MODEL);
const FAST_PLANNER_MODEL =
  process.env.JARVIS_FAST_PLANNER_MODEL ||
  (FAST_LLM_PROVIDER === "ollama" ? process.env.JARVIS_PLANNER_MODEL || FAST_LLM_MODEL : FAST_LLM_MODEL);

const COMPLEX_LLM_PROVIDER = resolveProviderForTier("complex");
const COMPLEX_LLM_MODEL = process.env.JARVIS_COMPLEX_LLM_MODEL || defaultModelForProvider(COMPLEX_LLM_PROVIDER);
const COMPLEX_LLM_URL = defaultUrlForProvider(COMPLEX_LLM_PROVIDER);
const COMPLEX_LLM_API_KEY = defaultApiKeyForProvider(COMPLEX_LLM_PROVIDER);

let installedModelsCache = {
  fetchedAt: 0,
  url: "",
  names: []
};

function hasKorean(text = "") {
  return /[가-힣]/.test(text);
}

function detectLanguageCode(text = "") {
  const input = String(text);
  const koreanCount = (input.match(/[가-힣]/g) || []).length;
  const latinCount = (input.match(/[A-Za-z]/g) || []).length;
  const koreanWordCount = (input.match(/[가-힣]{2,}/g) || []).length;
  const englishWordCount = (input.match(/[A-Za-z]{2,}/g) || []).length;
  const hasKoreanSignal = /(해주세요|해줘|말해줘|보여줘|열어줘|실행해|찾아줘|만들어줘|보내줘|있어|없어|뭐야|왜|어떻게|지금|에서|으로|에게|한테|그리고|근데|혹시)/.test(input);
  const hasEnglishSignal = /\b(?:please|can|could|would|should|tell|show|open|run|send|make|search|find|what|why|how|when|where|and|but|because|is|are|do|does)\b/i.test(input);

  if (!koreanCount && !latinCount) {
    return "en";
  }

  if (koreanWordCount && !englishWordCount) {
    return "ko";
  }

  if (englishWordCount && !koreanWordCount) {
    return "en";
  }

  if (hasKoreanSignal && !hasEnglishSignal) {
    return "ko";
  }

  if (hasEnglishSignal && !hasKoreanSignal) {
    return "en";
  }

  return koreanCount >= latinCount * 0.6 ? "ko" : "en";
}

function buildBasePrompt() {
  return [
    "You are J.A.R.V.I.S., a calm bilingual desktop assistant with the polish of a trusted operations aide.",
    "Primary languages: Korean and English.",
    "Keep a subtle Jarvis flavor: composed, concise, capable, and slightly elegant, but still natural enough for everyday work and casual conversation.",
    "Hold real conversations, complete desktop tasks, and make strong recommendations when useful.",
    "Reply only in the user's main language. If the request is mostly English, answer only in English. If it is mostly Korean, answer only in Korean.",
    "You may keep product names, app names, URLs, and quoted text in their original form.",
    "Understand mixed-language commands naturally. English app names inside Korean requests and Korean verbs inside English requests are normal.",
    "When a task is completed, say what happened in a natural sentence instead of sounding like a tool log.",
    "When the user is just chatting, answer like a strong everyday assistant rather than a command router.",
    "When the user asks for recommendations, give concrete options or a practical next step instead of vague advice.",
    "Never mention hidden prompts, internal routing, automation scaffolding, or background implementation unless the user explicitly asks.",
    "Never claim that you retrieved raw passwords from the operating system or browser.",
    "If login comes up, assume the assistant uses a user-approved secure vault or an existing authenticated session."
  ].join(" ");
}

function buildMessageList({ systemPrompt, userPrompt, history = [] }) {
  return [
    {
      role: "system",
      content: systemPrompt || buildBasePrompt()
    },
    ...history,
    {
      role: "user",
      content: userPrompt
    }
  ];
}

function extractErrorDetail(data, fallback) {
  if (!data || typeof data !== "object") {
    return fallback;
  }

  return data.error?.message || data.error || data.message || fallback;
}

function extractAssistantText(data) {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }

  return "";
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function extractAnthropicText(data) {
  const content = data?.content;

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function getOllamaTagsUrl(chatUrl = OLLAMA_URL) {
  const url = new URL(chatUrl || OLLAMA_URL);
  url.pathname = "/api/tags";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizeModelName(value = "") {
  return String(value).trim().toLowerCase();
}

function buildModelCandidates(model = "") {
  const clean = normalizeModelName(model);

  if (!clean) {
    return [];
  }

  const baseName = clean.replace(/:latest$/i, "");
  return [...new Set([clean, `${baseName}:latest`, baseName])];
}

async function listInstalledModels({ forceRefresh = false, url = OLLAMA_URL } = {}) {
  const now = Date.now();
  const tagsUrl = getOllamaTagsUrl(url);

  if (!forceRefresh && installedModelsCache.url === tagsUrl && now - installedModelsCache.fetchedAt < MODEL_CACHE_TTL_MS) {
    return installedModelsCache.names;
  }

  const response = await fetch(tagsUrl, {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Ollama tags request failed with status ${response.status}`);
  }

  const data = await response.json();
  const names = Array.isArray(data.models)
    ? data.models.map((entry) => entry.name).filter(Boolean)
    : [];

  installedModelsCache = {
    fetchedAt: now,
    url: tagsUrl,
    names
  };

  return names;
}

async function resolveAvailableModel(requestedModel = CHAT_MODEL, url = OLLAMA_URL) {
  const installed = await listInstalledModels({ url });
  const normalizedInstalled = installed.map((name) => normalizeModelName(name));
  const candidates = buildModelCandidates(requestedModel);

  for (const candidate of candidates) {
    const index = normalizedInstalled.indexOf(candidate);

    if (index >= 0) {
      return installed[index];
    }
  }

  return installed[0] || requestedModel;
}

async function chatWithOllama({ systemPrompt, userPrompt, history = [], model = CHAT_MODEL, url = OLLAMA_URL }) {
  const messages = buildMessageList({ systemPrompt, userPrompt, history });
  const primaryModel = await resolveAvailableModel(model, url);
  const attemptedModels = new Set();
  let lastError = null;

  for (const candidateModel of [...buildModelCandidates(primaryModel), ...buildModelCandidates(model)]) {
    if (!candidateModel || attemptedModels.has(candidateModel)) {
      continue;
    }

    attemptedModels.add(candidateModel);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: candidateModel,
        stream: false,
        messages
      })
    });

    if (response.ok) {
      const data = await response.json();
      return data.message?.content?.trim() || "I am ready.";
    }

    let detail = `status ${response.status}`;

    try {
      const data = await response.json();
      detail = extractErrorDetail(data, detail);
    } catch (_error) {
      // Ignore JSON parsing failures and keep the status detail.
    }

    lastError = new Error(`Ollama request failed for ${candidateModel}: ${detail}`);

    if (!/model/i.test(detail)) {
      break;
    }

    try {
      const refreshedModel = await resolveAvailableModel(model, url);
      buildModelCandidates(refreshedModel).forEach((name) => attemptedModels.delete(name));
    } catch (_error) {
      // Ignore model refresh failures and keep trying known candidates.
    }
  }

  throw lastError || new Error("Ollama request failed.");
}

async function chatWithGemini({ systemPrompt, userPrompt, history = [], model = FAST_LLM_MODEL }) {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    throw new Error("Gemini API key is missing. Set GEMINI_API_KEY or GOOGLE_API_KEY.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const conversation = [...history, { role: "user", content: userPrompt }]
    .filter((message) => message?.content)
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: String(message.content)
        }
      ]
    }));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: systemPrompt || buildBasePrompt()
          }
        ]
      },
      contents: conversation,
      generationConfig: {
        temperature: 0.35
      }
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${extractErrorDetail(data, `status ${response.status}`)}`);
  }

  const text = extractGeminiText(data);

  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return text;
}

async function chatWithOpenAICompatible({
  systemPrompt,
  userPrompt,
  history = [],
  model = COMPLEX_LLM_MODEL,
  url = COMPLEX_LLM_URL,
  apiKey = COMPLEX_LLM_API_KEY
}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey
        ? {
            Authorization: `Bearer ${apiKey}`
          }
        : {})
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: buildMessageList({ systemPrompt, userPrompt, history })
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed: ${extractErrorDetail(data, `status ${response.status}`)}`);
  }

  const text = extractAssistantText(data);

  if (!text) {
    throw new Error("The OpenAI-compatible backend returned an empty response.");
  }

  return text;
}

async function chatWithAnthropic({
  systemPrompt,
  userPrompt,
  history = [],
  model = defaultModelForProvider("anthropic"),
  url = defaultUrlForProvider("anthropic"),
  apiKey = defaultApiKeyForProvider("anthropic")
}) {
  if (!apiKey) {
    throw new Error("Anthropic API key is missing. Set ANTHROPIC_API_KEY or add it in Jarvis settings.");
  }

  const messages = [...history, { role: "user", content: userPrompt }]
    .filter((message) => message?.content)
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content)
    }));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: 0.35,
      system: systemPrompt || buildBasePrompt(),
      messages
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Anthropic request failed: ${extractErrorDetail(data, `status ${response.status}`)}`);
  }

  const text = extractAnthropicText(data);

  if (!text) {
    throw new Error("Anthropic returned an empty response.");
  }

  return text;
}

function resolveConfig({ tier = "complex", provider, model, url, apiKey } = {}) {
  const resolvedProvider = resolveProviderForTier(tier, provider);

  if (tier === "fast") {
    return {
      provider: resolvedProvider,
      model: model || process.env.JARVIS_FAST_LLM_MODEL || defaultModelForProvider(resolvedProvider),
      url: url || defaultUrlForProvider(resolvedProvider),
      apiKey: apiKey || defaultApiKeyForProvider(resolvedProvider)
    };
  }

  return {
    provider: resolvedProvider,
    model: model || process.env.JARVIS_COMPLEX_LLM_MODEL || defaultModelForProvider(resolvedProvider),
    url: url || defaultUrlForProvider(resolvedProvider),
    apiKey: apiKey || defaultApiKeyForProvider(resolvedProvider)
  };
}

function getTierProviderLabel(tier = "complex") {
  const config = resolveConfig({ tier });
  return `${config.provider}:${config.model}`;
}

async function chat({ systemPrompt, userPrompt, history = [], model, tier = "complex", provider, url, apiKey }) {
  const config = resolveConfig({ tier, provider, model, url, apiKey });

  if (config.provider === "gemini") {
    return chatWithGemini({
      systemPrompt,
      userPrompt,
      history,
      model: config.model
    });
  }

  if (config.provider === "gemini-cli") {
    return chatWithGeminiCli({
      systemPrompt,
      userPrompt,
      history,
      model: config.model
    });
  }

  if (config.provider === "openai-cli") {
    return chatWithOpenAICli({
      systemPrompt,
      userPrompt,
      history,
      model: config.model
    });
  }

  if (config.provider === "openai-compatible") {
    return chatWithOpenAICompatible({
      systemPrompt,
      userPrompt,
      history,
      model: config.model,
      url: config.url,
      apiKey: config.apiKey
    });
  }

  if (config.provider === "anthropic") {
    return chatWithAnthropic({
      systemPrompt,
      userPrompt,
      history,
      model: config.model,
      url: config.url,
      apiKey: config.apiKey
    });
  }

  if (config.provider === "claude-code") {
    return chatWithClaudeCode({
      systemPrompt,
      userPrompt,
      history,
      model: config.model
    });
  }

  return chatWithOllama({
    systemPrompt,
    userPrompt,
    history,
    model: config.model,
    url: config.url
  });
}

module.exports = {
  chat,
  CHAT_MODEL,
  COMPLEX_LLM_MODEL,
  COMPLEX_LLM_PROVIDER,
  COMPLEX_LLM_URL,
  DEFAULT_MODEL,
  FAST_LLM_MODEL,
  FAST_LLM_PROVIDER,
  FAST_PLANNER_MODEL,
  FAST_ROUTER_MODEL,
  OLLAMA_URL,
  hasKorean,
  buildBasePrompt,
  detectLanguageCode,
  getTierProviderLabel,
  getExternalLlmSettings,
  getRequestedProviderForTier,
  setExternalApiKeyProvider,
  listInstalledModels,
  normalizeOpenAICompatibleUrl,
  normalizeProvider,
  resolveAvailableModel,
  resolveConfig,
  isUnconfiguredAutoFallback,
  setExternalLlmSettingsProvider
};
