const DEFAULT_MODEL = process.env.JARVIS_MODEL || "qwen3:14b";
const CHAT_MODEL = process.env.JARVIS_CHAT_MODEL || DEFAULT_MODEL;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/chat";
const MODEL_CACHE_TTL_MS = 30_000;

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
    openwebui: "openai-compatible"
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

function setExternalApiKeyProvider(fn) {
  externalApiKeyProvider = fn;
}

function getGeminiApiKey() {
  if (externalApiKeyProvider) {
    const key = externalApiKeyProvider("gemini");
    if (key) return key;
  }
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

function getOpenAICompatibleApiKey() {
  return String(process.env.JARVIS_COMPLEX_LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim();
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
  const explicitUrl = String(process.env.JARVIS_COMPLEX_LLM_URL || process.env.OPENAI_BASE_URL || "").trim();

  return Boolean(
    getOpenAICompatibleApiKey() ||
      (explicitUrl && !looksLikeOllamaUrl(explicitUrl))
  );
}

function resolveProviderForTier(tier = "complex", requestedProvider = "") {
  const requested = normalizeProvider(
    requestedProvider || (tier === "fast"
      ? process.env.JARVIS_FAST_LLM_PROVIDER || "auto"
      : process.env.JARVIS_COMPLEX_LLM_PROVIDER || "auto"),
    "auto"
  );

  if (requested !== "auto") {
    return requested;
  }

  if (hasGeminiConfig()) {
    return "gemini";
  }

  if (hasOpenAICompatibleConfig()) {
    return "openai-compatible";
  }

  return "ollama";
}

function defaultModelForProvider(provider = "ollama") {
  if (provider === "gemini") {
    return process.env.GEMINI_LLM_MODEL || "gemini-2.0-flash";
  }

  if (provider === "openai-compatible") {
    return process.env.OPENAI_LLM_MODEL || "gpt-4o-mini";
  }

  return CHAT_MODEL;
}

function defaultUrlForProvider(provider = "ollama") {
  if (provider === "openai-compatible") {
    const preferredUrl = pickFirstNonEmpty(process.env.JARVIS_COMPLEX_LLM_URL, process.env.OPENAI_BASE_URL);

    return (
      normalizeOpenAICompatibleUrl(looksLikeOllamaUrl(preferredUrl) ? process.env.OPENAI_BASE_URL : preferredUrl) ||
      "https://api.openai.com/v1/chat/completions"
    );
  }

  return OLLAMA_URL;
}

function defaultApiKeyForProvider(provider = "ollama") {
  if (provider === "gemini") {
    return getGeminiApiKey();
  }

  if (provider === "openai-compatible") {
    return getOpenAICompatibleApiKey();
  }

  return "";
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

function getOllamaTagsUrl() {
  const url = new URL(OLLAMA_URL);
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

async function listInstalledModels({ forceRefresh = false } = {}) {
  const now = Date.now();

  if (!forceRefresh && now - installedModelsCache.fetchedAt < MODEL_CACHE_TTL_MS) {
    return installedModelsCache.names;
  }

  const response = await fetch(getOllamaTagsUrl(), {
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
    names
  };

  return names;
}

async function resolveAvailableModel(requestedModel = CHAT_MODEL) {
  const installed = await listInstalledModels();
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
  const primaryModel = await resolveAvailableModel(model);
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
      const refreshedModel = await resolveAvailableModel(model);
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
  setExternalApiKeyProvider,
  listInstalledModels,
  normalizeOpenAICompatibleUrl,
  normalizeProvider,
  resolveAvailableModel,
  resolveConfig
};
