const DEFAULT_MODEL = process.env.JARVIS_MODEL || "qwen3:14b";
const CHAT_MODEL = process.env.JARVIS_CHAT_MODEL || DEFAULT_MODEL;
const ROUTER_MODEL = process.env.JARVIS_ROUTER_MODEL || CHAT_MODEL;
const PLANNER_MODEL = process.env.JARVIS_PLANNER_MODEL || CHAT_MODEL;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/chat";
const MODEL_CACHE_TTL_MS = 30_000;

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

async function chat({ systemPrompt, userPrompt, history = [], model = CHAT_MODEL }) {
  const systemMessage = {
    role: "system",
    content: systemPrompt || buildBasePrompt()
  };
  const userMessage = {
    role: "user",
    content: userPrompt
  };
  const messages = [systemMessage, ...history, userMessage];
  const primaryModel = await resolveAvailableModel(model);
  const attemptedModels = new Set();
  let lastError = null;

  for (const candidateModel of [...buildModelCandidates(primaryModel), ...buildModelCandidates(model)]) {
    if (!candidateModel || attemptedModels.has(candidateModel)) {
      continue;
    }

    attemptedModels.add(candidateModel);

    const response = await fetch(OLLAMA_URL, {
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
      detail = data.error || data.message || detail;
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

module.exports = {
  chat,
  DEFAULT_MODEL,
  CHAT_MODEL,
  ROUTER_MODEL,
  PLANNER_MODEL,
  OLLAMA_URL,
  hasKorean,
  buildBasePrompt,
  detectLanguageCode,
  listInstalledModels,
  resolveAvailableModel
};
