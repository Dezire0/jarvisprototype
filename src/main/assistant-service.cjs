const {
  chat: officialChat,
  buildBasePrompt,
  detectLanguageCode,
  FAST_PLANNER_MODEL,
  getTierProviderLabel,
  getExternalLlmSettings,
  getRequestedProviderForTier,
  resolveConfig,
  isUnconfiguredAutoFallback
} = require("./ollama-service.cjs");

const osAutomation = require("./os-automation.cjs");
const piiManager = require("./pii-manager.cjs");
const JARVIS_CLOUD_API_BASE =
  String(process.env.JARVIS_CLOUD_API_BASE || "").trim() ||
  "https://jarvis-auth-service.dexproject.workers.dev";
const ENABLE_CLOUD_AI_FALLBACK =
  String(process.env.JARVIS_ENABLE_CLOUD_AI_FALLBACK || "").trim() === "1";
let electronNetFetch = null;

try {
  const electronModule = require("electron");
  if (
    electronModule &&
    typeof electronModule === "object" &&
    electronModule.net &&
    typeof electronModule.net.fetch === "function"
  ) {
    electronNetFetch = electronModule.net.fetch.bind(electronModule.net);
  }
} catch (_error) {
  electronNetFetch = null;
}

function formatFetchError(error, url = "") {
  const cause = error?.cause;
  const details = [
    cause?.code,
    cause?.errno,
    cause?.syscall,
    cause?.hostname,
    cause?.message,
    error?.message
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);

  const unique = [...new Set(details)];
  const host = (() => {
    try {
      return new URL(url).host;
    } catch (_error) {
      return "";
    }
  })();

  return unique.length
    ? `${host ? `${host} · ` : ""}${unique.join(" / ")}`
    : host || "unknown network error";
}

async function fetchWithRuntime(url, options = {}) {
  if (electronNetFetch) {
    try {
      return await electronNetFetch(url, options);
    } catch (electronError) {
      try {
        return await fetch(url, options);
      } catch (fallbackError) {
        fallbackError.message = formatFetchError(fallbackError, url);
        throw fallbackError;
      }
    }
  }

  try {
    return await fetch(url, options);
  } catch (error) {
    error.message = formatFetchError(error, url);
    throw error;
  }
}

function buildModelConnectionReply(text = "") {
  return detectLanguageCode(text) === "ko"
    ? "대화 모델이 아직 연결되어 있지 않아요. 왼쪽 위의 AI 모델 관리에서 GPT/Gemini API 키를 저장하거나, GPT/Codex CLI 또는 Gemini CLI로 로그인하거나, Ollama 로컬 모델을 선택해 주세요."
    : "No conversation model is connected yet. Open AI Model Management in the upper-left and save a GPT/Gemini API key, sign in with GPT/Codex CLI or Gemini CLI, or choose an Ollama local model.";
}

function buildModelFailureReply(text = "", error, config = {}) {
  const message = String(error?.message || error || "").trim();
  const isKo = detectLanguageCode(text) === "ko";
  const providerLabel = config.provider === "gemini"
    ? "Gemini"
    : config.provider === "gemini-cli"
      ? "Gemini CLI"
    : config.provider === "openai-cli"
      ? "GPT/Codex CLI"
      : config.provider === "openai-compatible"
        ? "GPT/OpenAI"
        : "로컬 모델";
  const modelLabel = config.model ? ` ${config.model}` : "";

  if (config.provider === "gemini" && /high demand|try again later|overloaded|temporar/i.test(message)) {
    return isKo
      ? `Gemini${modelLabel} 모델이 지금 요청이 많아서 일시적으로 응답하지 못하고 있어요. API 키나 저장 설정 문제는 아니고, Google 쪽 모델 수요/용량 문제에 가깝습니다. 잠시 뒤 다시 시도하거나 AI 모델 관리에서 Gemini 3 Flash Preview, Gemini 2.5 Pro, 또는 다른 연결 모델로 바꿔 주세요.`
      : `Gemini${modelLabel} is temporarily unable to respond because the model is under high demand. This is not an API key or saved-settings issue. Please try again later or switch to Gemini 3 Flash Preview, Gemini 2.5 Pro, or another connected model in AI Model Management.`;
  }

  if (config.provider === "openai-cli" || config.provider === "gemini-cli") {
    const label = config.provider === "openai-cli" ? "GPT/Codex CLI" : "Gemini CLI";
    const loginHintKo = config.provider === "openai-cli"
      ? "`codex login` 또는 Codex 확장/CLI 로그인"
      : "`gemini` 실행 후 Google 로그인";
    const loginHintEn = config.provider === "openai-cli"
      ? "`codex login` or the Codex extension/CLI login"
      : "Google login after running `gemini`";
    return isKo
      ? `${label}${modelLabel} 연결 중 문제가 있었어요. 이 경로는 API 키가 아니라 로컬 CLI의 로그인 상태를 사용합니다. CLI가 설치되어 있고 ${loginHintKo}이 완료되어 있는지 확인해 주세요.\n\n${message}`
      : `${label}${modelLabel} ran into a connection problem. This path uses the local CLI login session instead of an API key. Check that the CLI is installed and signed in via ${loginHintEn}.\n\n${message}`;
  }

  return isKo
    ? `${providerLabel}${modelLabel} 연결 중 문제가 있었어요. AI 모델 관리에서 API 키와 모델 선택을 확인해 주세요.\n\n${message}`
    : `${providerLabel}${modelLabel} ran into a connection problem. Check the API key and selected model in AI Model Management.\n\n${message}`;
}

const chat = async (options) => {
  let config = null;
  try {
    const effectiveOptions = options.localOnly
      ? {
          ...options,
          provider: "ollama",
          apiKey: ""
        }
      : options;
    config = resolveConfig({
      tier: effectiveOptions.tier || "complex",
      provider: effectiveOptions.provider,
      model: effectiveOptions.model,
      url: effectiveOptions.url,
      apiKey: effectiveOptions.apiKey
    });
    const requestedProvider = getRequestedProviderForTier(
      effectiveOptions.tier || "complex",
      effectiveOptions.provider
    );
    const directApiSelected = ["gemini", "openai-compatible"].includes(config.provider);
    const directApiReady = directApiSelected && Boolean(config.apiKey);
    const needsModelConnection =
      !effectiveOptions.localOnly &&
      (isUnconfiguredAutoFallback({
        tier: effectiveOptions.tier || "complex",
        provider: effectiveOptions.provider
      }) ||
        (directApiSelected && !directApiReady));

    if (needsModelConnection) {
      return buildModelConnectionReply(effectiveOptions.userPrompt);
    }
    return await officialChat(effectiveOptions);
  } catch (err) {
    console.error("Conversation model failed:", err.message);
    return buildModelFailureReply(options.userPrompt, err, config || {});
  }
};

const LONG_TERM_MEMORY_SYSTEM_PROMPT = [
  "You extract durable long-term user memory for a desktop assistant.",
  "Return valid JSON only.",
  'Schema: {"identity":{},"preferences":{},"projects":{},"relationships":{},"wishes":{},"notes":{}}',
  'Each saved fact should use the shape {"value":"..."} inside the category object.',
  "Store only facts that will still be useful later: identity, preferences, recurring habits, ongoing projects, important relationships, future plans, or stable personal context.",
  "Do not store temporary web content, raw URLs, one-off commands, current machine state, passwords, API keys, tokens, secrets, or other sensitive credentials.",
  "Keep values concise. Use English when practical, even if the conversation is Korean.",
  "If nothing is worth saving, return {}."
].join(" ");

const WEB_TARGET_ALIASES = new Set([
  "google",
  "구글",
  "youtube",
  "유튜브",
  "github",
  "깃허브",
  "gmail",
  "지메일",
  "naver",
  "네이버",
  "daum",
  "다음",
  "instagram",
  "인스타그램",
  "facebook",
  "페이스북",
  "twitter",
  "트위터",
  "x",
  "spotify",
  "스포티파이"
]);

const DIRECT_WEB_TARGETS = [
  {
    label: "Google",
    url: "https://www.google.com/",
    tokens: ["google", "구글"]
  },
  {
    label: "YouTube",
    url: "https://www.youtube.com/",
    tokens: ["youtube", "유튜브"]
  },
  {
    label: "GitHub",
    url: "https://github.com/",
    tokens: ["github", "깃허브"]
  },
  {
    label: "Gmail",
    url: "https://mail.google.com/",
    tokens: ["gmail", "지메일"]
  },
  {
    label: "Naver",
    url: "https://www.naver.com/",
    tokens: ["naver", "네이버"]
  },
  {
    label: "Daum",
    url: "https://www.daum.net/",
    tokens: ["daum", "다음"]
  },
  {
    label: "Instagram",
    url: "https://www.instagram.com/",
    tokens: ["instagram", "인스타그램"]
  },
  {
    label: "Facebook",
    url: "https://www.facebook.com/",
    tokens: ["facebook", "페이스북"]
  },
  {
    label: "X",
    url: "https://x.com/",
    tokens: ["x", "twitter", "트위터"]
  },
  {
    label: "Spotify",
    url: "https://open.spotify.com/",
    tokens: ["spotify", "스포티파이"]
  }
];

const DIRECT_APP_TARGETS = [
  {
    label: "Google Chrome",
    tokens: ["google chrome", "chrome", "구글 크롬", "구글크롬", "크롬"]
  },
  {
    label: "Safari",
    tokens: ["safari", "사파리"]
  },
  {
    label: "Arc",
    tokens: ["arc", "아크"]
  },
  {
    label: "Slack",
    tokens: ["slack", "슬랙"]
  },
  {
    label: "Discord",
    tokens: ["discord", "디스코드"]
  },
  {
    label: "Notion",
    tokens: ["notion", "노션"]
  },
  {
    label: "Spotify",
    tokens: ["spotify", "스포티파이"]
  },
  {
    label: "Steam",
    tokens: ["steam", "스팀"]
  },
  {
    label: "Epic Games Launcher",
    tokens: ["epic games launcher", "epic games", "epic", "에픽게임즈런처", "에픽게임즈", "에픽"]
  },
  {
    label: "Finder",
    tokens: ["finder", "파인더"]
  },
  {
    label: "Terminal",
    tokens: ["terminal", "터미널"]
  },
  {
    label: "Notes",
    tokens: ["notes", "메모"]
  },
  {
    label: "Visual Studio Code",
    tokens: ["visual studio code", "vs code", "vscode", "code", "비주얼스튜디오코드", "브이에스코드"]
  },
  {
    label: "Mail",
    tokens: ["mail", "메일"]
  }
];

const OFFICIAL_APP_FALLBACKS = [
  {
    label: "Discord",
    aliases: ["discord", "디스코드"],
    webUrl: "https://discord.com/app",
    installUrl: "https://discord.com/download",
    webRunnable: true
  },
  {
    label: "Slack",
    aliases: ["slack", "슬랙"],
    webUrl: "https://app.slack.com/client",
    installUrl: "https://slack.com/downloads",
    webRunnable: true
  },
  {
    label: "Notion",
    aliases: ["notion", "노션"],
    webUrl: "https://www.notion.so/login",
    installUrl: "https://www.notion.com/desktop",
    webRunnable: true
  },
  {
    label: "Spotify",
    aliases: ["spotify", "스포티파이"],
    webUrl: "https://open.spotify.com/",
    installUrl: "https://www.spotify.com/download/",
    webRunnable: true
  },
  {
    label: "Visual Studio Code",
    aliases: ["visual studio code", "vs code", "vscode", "code", "브이에스코드", "비주얼스튜디오코드"],
    webUrl: "https://vscode.dev/",
    installUrl: "https://code.visualstudio.com/download",
    webRunnable: true
  },
  {
    label: "Figma",
    aliases: ["figma", "피그마"],
    webUrl: "https://www.figma.com/files/",
    installUrl: "https://www.figma.com/downloads/",
    webRunnable: true
  },
  {
    label: "GitHub Desktop",
    aliases: ["github desktop", "깃허브 데스크톱", "깃허브 데스크탑"],
    webUrl: "https://github.com/",
    installUrl: "https://desktop.github.com/download/",
    webRunnable: true
  },
  {
    label: "OpenClaw",
    aliases: ["openclaw", "open claw", "오픈클로", "오픈 클로"],
    webUrl: "https://openclaw.ai/",
    installUrl: "https://openclawdoc.com/docs/getting-started/installation/",
    webRunnable: false,
    kind: "cli",
    installCommands: [
      "curl -fsSL https://openclaw.ai/install.sh | bash",
      "npm install -g openclaw@latest && openclaw onboard --install-daemon",
      "git clone https://github.com/openclaw/openclaw.git && cd openclaw && pnpm install && pnpm ui:build && pnpm build && pnpm link --global"
    ],
    runCommands: ["openclaw doctor", "openclaw status", "openclaw dashboard"]
  }
];

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s]+|(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i);
  return match ? match[0] : "";
}

function extractAfterWakeWord(text) {
  return String(text)
    .replace(/^\s*(jarvis|자비스)\s*[,:]?\s*/i, "")
    .trim();
}

function looksLikeActionableCommandStart(text = "") {
  return /^(?:open|go to|visit|search|browse|launch|run|start|play|watch|listen|find|click|type|press|switch|focus|show|open app|open the app|열어|들어가|검색|찾아|실행|켜|재생|틀어|들려|보여|이동|유튜브|youtube|구글|google|스포티파이|spotify)/i.test(
    String(text).trim()
  );
}

function stripCorrectionLeadIn(text = "") {
  const original = String(text).trim();
  const stripped = original
    .replace(/^(?:no[, ]+|nah[, ]+)?(?:i said|i mean|i meant|what i said was|that(?:'s| is) not what i said)\s+/i, "")
    .replace(/^(?:아니[, ]*|아니야[, ]*|내 말은[, ]*|정정하면[, ]*|정정[, ]*|아까 말한 건[, ]*)/i, "")
    .trim();

  if (!stripped || stripped === original) {
    return original;
  }

  return looksLikeActionableCommandStart(stripped) ? stripped : original;
}

function normalizePlanText(text) {
  return stripCorrectionLeadIn(extractAfterWakeWord(text))
    .replace(/[.?!]+$/g, "")
    .trim();
}

function normalizeWhitespace(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function safeJsonParse(raw) {
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

function hasLongTermMemoryContent(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value).some(
        (section) =>
          section &&
          typeof section === "object" &&
          !Array.isArray(section) &&
          Object.keys(section).length
      )
  );
}

function looksPotentiallyMemorableConversation(userText = "", assistantText = "") {
  const combined = `${normalizeWhitespace(userText)}\n${normalizeWhitespace(assistantText)}`.trim();

  if (!combined || combined.length < 8) {
    return false;
  }

  return /(?:\b(?:my name|i am|i'm|i live|i work|i study|i prefer|i like|i love|i hate|my favorite|favorite|my project|my goal|my friend|my family|my partner|i want|i plan|usually|often)\b|저는|나는|내 이름|살아요|살고 있어|일해|학생|좋아해|싫어해|취향|선호|프로젝트|목표|계획|친구|가족|연인|사고 싶|가고 싶|하고 싶|자주|보통)/i.test(
    combined
  );
}

function normalizeEntityToken(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function findOfficialAppFallback(appName = "") {
  const normalized = normalizeEntityToken(appName);

  if (!normalized) {
    return null;
  }

  return (
    OFFICIAL_APP_FALLBACKS.find((entry) =>
      [entry.label, ...(entry.aliases || [])].some((alias) => normalizeEntityToken(alias) === normalized)
    ) ||
    OFFICIAL_APP_FALLBACKS.find((entry) =>
      [entry.label, ...(entry.aliases || [])].some((alias) => {
        const token = normalizeEntityToken(alias);
        return token && (normalized.includes(token) || token.includes(normalized));
      })
    ) ||
    null
  );
}

function textMentionsToken(text = "", token = "") {
  const normalizedText = String(text).toLowerCase();
  const normalizedToken = String(token).toLowerCase().trim();

  if (!normalizedText || !normalizedToken) {
    return false;
  }

  if (/^[a-z0-9 ]+$/i.test(normalizedToken)) {
    return new RegExp(`(^|[^a-z0-9])${normalizedToken.replace(/\s+/g, "\\s+")}([^a-z0-9]|$)`, "i").test(
      normalizedText
    );
  }

  return normalizedText.includes(normalizedToken);
}

function findDirectTargets(text = "", definitions = []) {
  const normalized = normalizePlanText(text);
  const found = [];
  const seen = new Set();

  for (const definition of definitions) {
    if (!definition.tokens.some((token) => textMentionsToken(normalized, token))) {
      continue;
    }

    const key = definition.url || definition.label;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    found.push({
      label: definition.label,
      url: definition.url || "",
      tokens: definition.tokens
    });
  }

  return found;
}

function extractDirectOpenTargets(input = "") {
  const normalized = normalizePlanText(input);
  const hasOpenVerb = /(open|launch|run|start|visit|go to|열어|켜|실행|시작|들어가)/i.test(normalized);
  const hasJoiner = /(?:그리고|및|와|과|랑|하고|열고|켜고|실행하고|한\s*번에|동시에|,|&|\+|\band\b|\btogether\b)/i.test(
    normalized
  );

  if (!hasOpenVerb) {
    return null;
  }

  const apps = findDirectTargets(normalized, DIRECT_APP_TARGETS);
  const web = findDirectTargets(normalized, DIRECT_WEB_TARGETS)
    .filter((target) => !apps.some((app) => normalizeEntityToken(app.label) === normalizeEntityToken(target.label)));

  if (apps.length + web.length < 2 || !hasJoiner) {
    return null;
  }

  return {
    apps,
    web
  };
}

function stripCommandPrefix(text) {
  return normalizePlanText(text)
    .replace(
      /^(open|go to|visit|search|browse|launch|run|open app|open the app|브라우저|열어|검색해|검색해서|찾아|찾아서|실행해|실행해줘|켜줘|켜)\s*/i,
      ""
    )
    .trim();
}

function guessSiteName(text) {
  const normalized = normalizePlanText(text);

  if (/(youtube|유튜브)/i.test(normalized)) {
    return "YouTube";
  }

  if (/(google|구글)/i.test(normalized)) {
    return "Google";
  }

  if (/(github|깃허브)/i.test(normalized)) {
    return "GitHub";
  }

  const domain = extractUrl(normalized);

  if (domain) {
    return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }

  const firstPhrase = normalized.match(/([A-Za-z0-9가-힣_-]{2,})/);
  return firstPhrase ? firstPhrase[1] : "";
}

function getKnownSiteUrl(siteName = "") {
  const lowered = siteName.toLowerCase();
  const directTarget = DIRECT_WEB_TARGETS.find((target) =>
    target.tokens.some((token) => lowered === token.toLowerCase())
  );

  if (directTarget) {
    return directTarget.url;
  }

  if (lowered === "youtube" || lowered === "유튜브") {
    return "https://www.youtube.com/";
  }

  if (lowered === "github" || lowered === "깃허브") {
    return "https://github.com/";
  }

  if (lowered === "google" || lowered === "구글") {
    return "https://www.google.com/";
  }

  return "";
}

function getLocalizedKnownSiteLabel(siteName = "", language = "en") {
  const lowered = String(siteName || "").trim().toLowerCase();

  if (lowered === "google" || lowered === "구글") {
    return language === "ko" ? "구글" : "Google";
  }

  if (lowered === "youtube" || lowered === "유튜브") {
    return language === "ko" ? "유튜브" : "YouTube";
  }

  if (lowered === "github" || lowered === "깃허브") {
    return language === "ko" ? "깃허브" : "GitHub";
  }

  if (lowered === "gmail" || lowered === "지메일") {
    return language === "ko" ? "지메일" : "Gmail";
  }

  return "";
}

function buildDirectSiteUrl(siteName = "") {
  const known = getKnownSiteUrl(siteName);

  if (known) {
    return known;
  }

  const explicitUrl = extractUrl(siteName);

  if (explicitUrl) {
    return /^https?:\/\//i.test(explicitUrl) ? explicitUrl : `https://${explicitUrl}`;
  }

  const clean = cleanupParsedText(siteName);

  if (/^[\w.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(clean)) {
    return clean.startsWith("http://") || clean.startsWith("https://") ? clean : `https://${clean}`;
  }

  return "";
}

function normalizeBrowserOpenUrl(target = "") {
  const value = cleanupParsedText(target);

  if (!value) {
    return "";
  }

  const directSiteUrl = buildDirectSiteUrl(value);

  if (directSiteUrl) {
    return directSiteUrl;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (/^[\w.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(value)) {
    return `https://${value}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function inferFriendlyBrowserLabel(target = "", language = "en") {
  const cleanTarget = cleanupParsedText(target);

  if (!cleanTarget) {
    return "";
  }

  try {
    const parsedTarget = new URL(normalizeBrowserOpenUrl(cleanTarget));
    const directMatch = DIRECT_WEB_TARGETS.find((knownTarget) => {
      try {
        return new URL(knownTarget.url).hostname === parsedTarget.hostname;
      } catch (_error) {
        return false;
      }
    });

    if (directMatch) {
      return getLocalizedKnownSiteLabel(directMatch.label, language) || directMatch.label;
    }
  } catch (_error) {
    // Fall through to token-based labels.
  }

  const guessedSite = guessSiteName(cleanTarget);
  const localizedKnownSite = getLocalizedKnownSiteLabel(guessedSite, language);

  if (localizedKnownSite) {
    return localizedKnownSite;
  }

  if (guessedSite && !/^https?:\/\//i.test(guessedSite)) {
    return guessedSite.replace(/^www\./i, "");
  }

  try {
    const parsed = new URL(normalizeBrowserOpenUrl(cleanTarget));
    return parsed.hostname.replace(/^www\./i, "");
  } catch (_error) {
    return cleanTarget
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split(/[/?#]/)[0];
  }
}

function buildExternalBrowserTarget(step = {}) {
  if (step.action === "search_google") {
    return `https://www.google.com/search?q=${encodeURIComponent(step.query || "")}`;
  }

  if (step.action === "search_youtube") {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(step.query || "")}`;
  }

  if (step.action === "open_url") {
    return normalizeBrowserOpenUrl(step.target || "");
  }

  return "";
}

function isSimpleExternalBrowserPlan(plan = {}) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];

  return (
    steps.length === 1 &&
    ["open_url", "search_google", "search_youtube"].includes(steps[0]?.action)
  );
}

function shouldUseAssistantBrowserForSimplePlan(input = "", plan = {}) {
  const normalized = normalizePlanText(input);
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const target = `${steps[0]?.target || ""} ${steps[0]?.query || ""}`;

  return /(?:공식|설치|다운로드|실행\s*가능|웹에서|웹으로|확인|판단|official|install|download|run online|web app|check|verify)/i.test(
    `${normalized} ${target}`
  );
}

function cleanupMediaQuery(value = "") {
  return cleanupParsedText(
    String(value)
      .replace(/^(?:and|then)\b\s*/i, "")
      .replace(/^(?:some|any|a|the|something)\s+/i, "")
      .replace(/\b(?:please|for me|right now)\b/gi, "")
      .replace(/\s+(?:on|in)\s+(?:youtube|유튜브)\b/gi, "")
      .trim()
  );
}

function isGenericMediaQuery(value = "") {
  return /^(?:music|songs?|playlist|playlists|video|videos|mix|something|anything|some music|any music|음악|노래|플레이리스트|영상)$/i.test(
    cleanupParsedText(value)
  );
}

function hasDirectMediaActionSignal(text = "") {
  const lowered = normalizePlanText(text).toLowerCase();

  return hasAny(lowered, [
    "play",
    "watch",
    "listen",
    "search",
    "find",
    "open",
    "go to",
    "visit",
    "pause",
    "resume",
    "continue",
    "skip",
    "next track",
    "previous track",
    "틀어",
    "재생",
    "검색",
    "찾아",
    "열어",
    "들어가",
    "일시정지",
    "다시 재생",
    "계속 재생",
    "다음 곡",
    "이전 곡"
  ]);
}

function looksLikeRecommendationStyleMediaQuestion(text = "") {
  const lowered = normalizePlanText(text).toLowerCase();

  return (
    /(?:추천|recommend|suggest|없나|없을까|들을만한|볼만한|what should i|anything good|something good|what's good|what is good)/i.test(
      lowered
    ) &&
    !hasDirectMediaActionSignal(lowered)
  );
}

function looksLikeYouTubePlaybackRequest(text = "") {
  const lowered = normalizePlanText(text).toLowerCase();

  if (looksLikeRecommendationStyleMediaQuestion(lowered)) {
    return false;
  }

  return (
    /(youtube|유튜브)/i.test(lowered) &&
    hasDirectMediaActionSignal(lowered) &&
    hasAny(lowered, [
      "play",
      "watch",
      "listen",
      "search",
      "find",
      "open",
      "go to",
      "music",
      "song",
      "playlist",
      "mix",
      "video",
      "재생",
      "틀어",
      "들려",
      "음악",
      "노래",
      "플레이리스트",
      "영상"
    ])
  );
}

function extractYouTubePlaybackQuery(text = "") {
  const normalized = normalizePlanText(text);
  const quoted = extractQuotedText(normalized);

  if (quoted && /(play|watch|listen|music|song|playlist|재생|틀어|들려|음악|노래|플레이리스트)/i.test(normalized)) {
    const cleanedQuoted = cleanupMediaQuery(quoted);

    if (cleanedQuoted && !isGenericMediaQuery(cleanedQuoted)) {
      return cleanedQuoted;
    }
  }

  const patterns = [
    /(?:play|watch|listen to)\s+(.+?)\s+(?:on|in)\s+(?:youtube|유튜브)/i,
    /(?:go to|open|visit)\s+(?:youtube|유튜브)\s+(?:and|then)?\s*(?:play|watch|listen to)\s+(.+)$/i,
    /(?:youtube|유튜브)(?:에서|에서만)?\s+(.+?)\s*(?:틀어줘|틀어|재생해줘|재생해|재생|play|watch|listen)/i,
    /(?:youtube|유튜브).*(?:play|watch|listen to)\s+(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const cleaned = cleanupMediaQuery(match?.[1] || "");

    if (cleaned && !isGenericMediaQuery(cleaned)) {
      return cleaned;
    }
  }

  if (/(music|song|playlist|음악|노래|플레이리스트)/i.test(normalized)) {
    return "music mix";
  }

  return "";
}

function extractComplexBrowserIntent(input = "") {
  const normalized = normalizePlanText(input);
  const wantsLogin = /(로그인|login|log in|sign in)/i.test(normalized);
  const wantsRead = /(활동|activity|recent|latest|무슨 내용|상태|보여줘|읽어줘|요약|summarize|read|show me|what(?:'s| is) on)/i.test(
    normalized
  );
  const koreanSiteSearch =
    normalized.match(/(.+?)에서\s+(.+?)\s*(?:검색(?:해줘|해|하고)?|찾아(?:줘|봐)?)/i) ||
    normalized.match(/(.+?)에서\s+(.+?)\s*(?:search|find)/i);
  const englishSiteSearch =
    normalized.match(
      /(?:search|find)\s+(.+?)\s+(?:on|in)\s+(.+?)(?=\s+(?:and|then|after|before|login|log in|sign in|activity|show|read|summarize)|$)/i
    ) ||
    normalized.match(
      /(?:on|in)\s+(.+?)\s+(?:search|find)\s+(.+?)(?=\s+(?:and|then|after|before|login|log in|sign in|activity|show|read|summarize)|$)/i
    );

  let site = "";
  let query = "";

  if (koreanSiteSearch?.[1] && koreanSiteSearch?.[2]) {
    site = cleanupParsedText(koreanSiteSearch[1]);
    query = cleanupParsedText(koreanSiteSearch[2].replace(/에서$/i, ""));
  } else if (englishSiteSearch?.[1] && englishSiteSearch?.[2]) {
    if (/^(search|find)$/i.test(englishSiteSearch[1])) {
      site = cleanupParsedText(englishSiteSearch[2]);
    } else if (/(?:on|in)\s/i.test(englishSiteSearch[0])) {
      site = cleanupParsedText(englishSiteSearch[1]);
      query = cleanupParsedText(englishSiteSearch[2]);
    } else {
      query = cleanupParsedText(englishSiteSearch[1]);
      site = cleanupParsedText(englishSiteSearch[2]);
    }
  }

  if (!site && (wantsLogin || wantsRead)) {
    site = cleanupParsedText(guessSiteName(normalized));
  }

  if (!site || (!query && !wantsLogin && !wantsRead)) {
    return null;
  }

  return {
    site,
    query,
    wantsLogin,
    wantsRead
  };
}

function looksLikeSystemBriefingRequest(text = "") {
  const normalized = normalizePlanText(text);

  return /(?:컴퓨터|pc|mac|맥북|시스템|desktop|machine).*(?:상태|상황|브리핑|요약|정리|현황)|(?:what(?:'s| is) going on|overview|status report|system briefing|computer briefing|current machine status)/i.test(
    normalized
  );
}

function buildHeuristicBrowserPlan(input) {
  const normalized = normalizePlanText(input);
  const plan = {
    reply: "",
    steps: [],
    login: null
  };
  const complexSiteIntent = extractComplexBrowserIntent(normalized);

  if (complexSiteIntent) {
    const directSiteUrl = buildDirectSiteUrl(complexSiteIntent.site);

    if (directSiteUrl) {
      plan.steps.push({
        action: "open_url",
        target: directSiteUrl
      });
    }

    if (complexSiteIntent.wantsLogin) {
      plan.login = {
        required: true,
        mode: "manual",
        site: complexSiteIntent.site
      };
    }

    if (complexSiteIntent.query) {
      plan.steps.push({
        action: "site_search",
        query: complexSiteIntent.query
      });
    }

    if (complexSiteIntent.wantsRead) {
      plan.steps.push({
        action: "read_page",
        limit: 4000
      });
    }

    if (plan.steps.length) {
      return plan;
    }
  }

  const explicitUrl = extractUrl(normalized);

  if (explicitUrl) {
    plan.steps.push({
      action: "open_url",
      target: explicitUrl
    });
    return plan;
  }

  if (looksLikeYouTubePlaybackRequest(normalized)) {
    const query = extractYouTubePlaybackQuery(normalized);

    if (query) {
      plan.steps.push({
        action: "search_youtube",
        query
      });
    } else {
      plan.steps.push({
        action: "open_url",
        target: "https://www.youtube.com/"
      });
    }

    return plan;
  }

  if (/(유튜브에서|youtube.*search|search youtube)/i.test(normalized)) {
    const query = normalized
      .replace(/.*?(유튜브에서|youtube(?:에서)?)/i, "")
      .replace(/(검색.*|search.*)$/i, "")
      .trim();

    if (query) {
      plan.steps.push({
        action: "search_youtube",
        query
      });
    } else {
      plan.steps.push({
        action: "open_url",
        target: "https://www.youtube.com/"
      });
    }

    return plan;
  }

  const wantsSearch = /(검색|search|find|찾아)/i.test(normalized);
  const wantsEnter = /(들어가|들어가줘|열어줘|visit|go in|go there|open it|들어가서)/i.test(normalized);
  const mentionsGoogle = /(google|구글)/i.test(normalized);
  const siteName = guessSiteName(normalized);
  const knownSiteUrl = getKnownSiteUrl(siteName);

  if (mentionsGoogle && wantsSearch) {
    const queryMatch =
      normalized.match(/(?:구글에서|google(?:에서)?)(.+?)(?:검색|search)/i) ||
      normalized.match(/(.+?)(?:검색|search)/i);
    const query = queryMatch?.[1]?.replace(/에서/g, "").trim() || siteName;

    plan.steps.push({
      action: "search_google",
      query
    });

    if (wantsEnter) {
      if (knownSiteUrl) {
        plan.steps.push({
          action: "open_url",
          target: knownSiteUrl
        });
      } else if (siteName && query.length <= 24) {
        plan.steps.push({
          action: "click_text",
          text: siteName
        });
      } else {
        plan.steps.push({
          action: "click_search_result",
          index: 1
        });
      }
    }

    return plan;
  }

  if (wantsSearch) {
    const query = stripCommandPrefix(normalized);

    plan.steps.push({
      action: "search_google",
      query
    });

    if (wantsEnter) {
      plan.steps.push({
        action: "click_search_result",
        index: 1
      });
    }

    return plan;
  }

  if (knownSiteUrl) {
    plan.steps.push({
      action: "open_url",
      target: knownSiteUrl
    });
    return plan;
  }

  if (/(유튜브|youtube)/i.test(normalized) && wantsEnter) {
    plan.steps.push({
      action: "open_url",
      target: "https://www.youtube.com/"
    });
    return plan;
  }

  plan.steps.push({
    action: "open_url",
    target: stripCommandPrefix(normalized)
  });

  return plan;
}

function wantsSavedBrowserLogin(text = "") {
  return /(?:자동 로그인|저장된 (?:계정|로그인|자격 증명)|saved (?:login|credential|credentials)|autofill|auto[- ]?login|use (?:my )?saved (?:login|credential|credentials))/i.test(
    normalizePlanText(text)
  );
}

function looksLikeBrowserContinuationResponse(text = "") {
  return /^(?:계속|계속해|계속해줘|이어가|이어서|다음|다음으로|로그인했어|로그인 완료|완료했어|됐어|다 했어|continue|go on|resume|done|i(?:'m| am) logged in|logged in|finished)$/i.test(
    normalizePlanText(text)
  );
}

function detectBrowserSpecialCases(finalPage = {}) {
  const haystack = normalizeWhitespace(
    `${finalPage.title || ""}\n${finalPage.url || ""}\n${finalPage.text || ""}`
  ).toLowerCase();
  const notices = [];

  if (
    /(captcha|not a robot|human verification|verify (?:you'?re|you are) human|robot check|security check|보안문자|자동화된 요청|로봇 인증)/i.test(
      haystack
    )
  ) {
    notices.push("captcha");
  }

  if (
    /(two[- ]factor|two step|two-step|2fa|otp|verification code|authenticator|인증 코드|보안 코드|일회용 코드|2단계 인증|이중 인증)/i.test(
      haystack
    )
  ) {
    notices.push("verification");
  }

  if (/(access denied|forbidden|blocked|access blocked|접근 거부|권한이 없습니다|차단됨)/i.test(haystack)) {
    notices.push("access_denied");
  }

  if (
    /(continue with google|continue with apple|enter your password|sign in|sign-in|signin|log in|login|로그인|사인인)/i.test(
      haystack
    ) &&
    /(login|signin|sign-in|auth|account|session|password|continue with)/i.test(haystack)
  ) {
    notices.push("login_required");
  }

  if (/(404|page not found|not found|찾을 수 없습니다|존재하지 않는 페이지)/i.test(haystack)) {
    notices.push("not_found");
  }

  return [...new Set(notices)];
}

function localizeBrowserNotice(code, language = "en") {
  if (code === "captcha") {
    return language === "ko"
      ? "캡차나 사람 확인 화면이 보여요."
      : "the page is asking for CAPTCHA or human verification.";
  }

  if (code === "verification") {
    return language === "ko"
      ? "인증 코드나 2단계 인증이 필요해 보여요."
      : "it looks like a verification code or two-factor check is required.";
  }

  if (code === "access_denied") {
    return language === "ko"
      ? "접근이 막혔거나 권한이 부족해 보여요."
      : "access appears to be blocked or restricted.";
  }

  if (code === "login_required") {
    return language === "ko"
      ? "아직 로그인 완료가 필요해 보여요."
      : "it still looks like the site wants a login.";
  }

  if (code === "not_found") {
    return language === "ko"
      ? "요청한 페이지를 찾지 못한 것 같아요."
      : "the page looks like a not-found result.";
  }

  return "";
}

function appendBrowserNotices(reply = "", notices = [], language = "en") {
  const localized = notices.map((code) => localizeBrowserNotice(code, language)).filter(Boolean);

  if (!localized.length) {
    return reply;
  }

  const prefix = language === "ko" ? "특이사항:" : "Heads up:";
  const suffix = localized.join(language === "ko" ? " " : " ");

  return [reply, `${prefix} ${suffix}`].filter(Boolean).join(" ").trim();
}

function buildLanguageName(languageCode) {
  return languageCode === "ko" ? "Korean" : "English";
}

function detectReplyLanguage(input) {
  return detectLanguageCode(input) === "ko" ? "ko" : "en";
}

function buildCommandFallback(language, message) {
  if (message) {
    return message;
  }

  return language === "ko" ? "처리했어요." : "Done.";
}

function looksComplexChainedRequest(text = "") {
  const normalized = normalizePlanText(text);

  return (
    /(?:그리고|그다음|다음에|이어서|한 다음|한 뒤|한 후|하고 나서|동시에|먼저|그 후|after that|and then|then|next|followed by|once|before|while)/i.test(
      normalized
    ) || normalized.length > 90
  );
}

function chooseChatModelTier(input = "", history = []) {
  const normalized = normalizePlanText(input);
  const lowered = normalized.toLowerCase();
  const historyDepth = Array.isArray(history) ? history.length : 0;

  if (!normalized) {
    return "fast";
  }

  if (normalized.length > 180) {
    return "complex";
  }

  if (historyDepth >= 6 && normalized.length > 70) {
    return "complex";
  }

  if (/\n/.test(input)) {
    return "complex";
  }

  if (
    /(코드|디버그|버그|리팩터링|설계|아키텍처|분석|비교|장단점|전략|초안|보고서|문서|요약해석|깊게|자세히|단계별|왜 그런지|원인|구현|최적화|debug|bug|refactor|architecture|analy[sz]e|compare|trade[- ]?off|strategy|draft|report|document|deep|detailed|step by step|root cause|implement|optimi[sz]e)/i.test(
      lowered
    )
  ) {
    return "complex";
  }

  return "fast";
}

function looksLikeModelIdentityQuestion(input = "") {
  const normalized = normalizePlanText(input).toLowerCase();

  return /(?:무슨|어떤|뭐|뭔|현재|지금|선택|연결|사용|정확|정확한|명칭|이름|알려|궁금|확인|버전).{0,32}(?:모델|model|버전|version)|(?:모델|model|버전|version).{0,32}(?:무슨|어떤|뭐|뭔|현재|지금|선택|연결|사용|정확|정확한|명칭|이름|알려|궁금|확인)|which model|what model|model name|model id/i.test(normalized);
}

function formatConfiguredConversationModel(settings = {}) {
  const provider = settings.provider || "auto";

  if (provider === "gemini") {
    return {
      label: "Gemini API",
      model: settings.gemini?.model || "gemini-2.5-flash"
    };
  }

  if (provider === "openai" || provider === "openai-compatible") {
    return {
      label: "GPT / OpenAI API",
      model: settings.openai?.model || "gpt-4o-mini"
    };
  }

  if (provider === "openai-cli") {
    return {
      label: "GPT / Codex CLI",
      model: settings.openai?.model || "gpt-4o-mini"
    };
  }

  if (provider === "gemini-cli") {
    return {
      label: "Gemini CLI",
      model: settings.gemini?.model || "gemini-2.5-flash"
    };
  }

  if (provider === "ollama") {
    return {
      label: "Ollama 로컬 모델",
      model: settings.ollama?.model || "qwen3:14b"
    };
  }

  if (settings.gemini?.configured) {
    return {
      label: "자동 선택 / Gemini API",
      model: settings.gemini?.model || "gemini-2.5-flash"
    };
  }

  if (settings.openai?.configured) {
    return {
      label: "자동 선택 / GPT API",
      model: settings.openai?.model || "gpt-4o-mini"
    };
  }

  return {
    label: "자동 선택",
    model: "연결된 대화 모델 없음"
  };
}

function buildConfiguredModelIdentityResult(input = "", language = detectReplyLanguage(input), settings = {}) {
  const configuredModel = formatConfiguredConversationModel(settings);

  return {
    reply: language === "ko"
      ? `현재 앱에 설정된 대화 모델은 ${configuredModel.label}의 ${configuredModel.model}입니다. 모델 자체가 자기 이름을 추측해서 답한 것이 아니라, Jarvis 설정에 저장된 연결값을 기준으로 확인한 정보예요.`
      : `The conversation model currently configured in the app is ${configuredModel.label}: ${configuredModel.model}. This is based on the saved Jarvis connection settings, not on the model guessing its own identity.`,
    actions: [],
    provider: "model-settings",
    language
  };
}

function isFastBrowserPlan(plan = {}) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const allowedActions = new Set([
    "open_url",
    "search_google",
    "search_youtube",
    "click_text",
    "click_search_result",
    "site_search",
    "read_page"
  ]);

  return Boolean(steps.length) && steps.length <= 4 && steps.every((step) => allowedActions.has(step.action));
}

function isFastAppPlan(plan = {}) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const allowedActions = new Set([
    "open_app",
    "open_url",
    "app_type",
    "app_key",
    "app_shortcut",
    "app_menu_click"
  ]);

  return Boolean(steps.length) && steps.length <= 4 && steps.every((step) => allowedActions.has(step.action));
}

function shouldUseFallbackRouteDirectly(input, route = {}) {
  return false;
}

function shouldSkipCommandPolish(input, result = {}) {
  const actions = Array.isArray(result.actions) ? result.actions : [];

  if (!actions.length) {
    return true;
  }

  if (looksComplexChainedRequest(input)) {
    return false;
  }

  return actions.length <= 3;
}

function buildCompactBrowserReply(input, steps = [], finalPage = {}) {
  const language = detectReplyLanguage(input);
  const lastStep = steps[steps.length - 1] || {};
  const friendlyOpenLabel =
    inferFriendlyBrowserLabel(finalPage.title || lastStep.target || finalPage.url || "", language) ||
    (language === "ko" ? "페이지" : "the page");

  if (lastStep.action === "search_youtube" && looksLikeYouTubePlaybackRequest(input)) {
    return language === "ko"
      ? "유튜브에서 바로 틀 수 있게 결과를 열어뒀어요."
      : "I opened YouTube results so you can play something right away.";
  }

  if (lastStep.action === "search_google" || lastStep.action === "search_youtube") {
    return language === "ko"
      ? `${lastStep.query || "요청한 내용"} 검색했어요.`
      : `I searched for ${lastStep.query || "that"}.`;
  }

  if (lastStep.action === "click_search_result") {
    return language === "ko"
      ? `${inferFriendlyBrowserLabel(finalPage.title || finalPage.url || "", language) || "검색 결과"} 열었어요.`
      : `I opened ${inferFriendlyBrowserLabel(finalPage.title || finalPage.url || "", language) || "the result"}.`;
  }

  if (lastStep.action === "open_url") {
    return language === "ko"
      ? `${friendlyOpenLabel} 열었어요.`
      : `I opened ${friendlyOpenLabel}.`;
  }

  return language === "ko" ? "브라우저 작업을 처리했어요." : "I handled the browser task.";
}

function browserWorkflowNeedsContentAnswer(input = "", steps = [], finalPage = {}) {
  if (!finalPage?.text) {
    return false;
  }

  if (steps.some((step) => step.action === "read_page")) {
    return true;
  }

  return /(활동|activity|요약|정리|읽어|보여줘|무슨 내용|상태|read|summarize|show me|what(?:'s| is) on|what happened)/i.test(
    normalizePlanText(input)
  );
}

function buildLocalRecommendationReply(input, language) {
  const lowered = normalizePlanText(input).toLowerCase();

  if (/(공부|study|learn|영어|english|시험|test)/i.test(lowered)) {
    return language === "ko"
      ? "이럴 때는 짧게 끊어서 가는 게 좋아요. 먼저 15분짜리 한 주제를 정하고, Notes에 핵심 표현 5개만 적은 뒤, 마지막에 제가 짧게 복습 질문을 드리는 흐름을 추천해요."
      : "A short focused loop usually works best here. Pick one 15-minute topic, write down five key phrases in Notes, and then let me quiz you briefly at the end.";
  }

  if (/(생산성|집중|focus|productive|work|todo|task|일정)/i.test(lowered)) {
    return language === "ko"
      ? "지금 바로 효율을 올리려면 세 가지가 좋아요. 오늘 가장 중요한 일 3개 정리, 필요한 앱만 먼저 열기, 그리고 집중 음악이나 타이머를 같이 켜는 흐름을 추천해요."
      : "Three things would help most right now: narrow today down to three important tasks, open only the apps you actually need, and pair that with focus music or a timer.";
  }

  if (/(음악|music|playlist|spotify|노래)/i.test(lowered)) {
    return language === "ko"
      ? "분위기에 따라 다르게 가는 게 좋아요. 집중용이면 lo-fi나 focus playlist, 기분 전환이면 upbeat pop, 밤에는 jazz나 ambient 쪽을 추천해요."
      : "It depends on the mood. For focus, I would go with a lo-fi or focus playlist. For a lift, upbeat pop works well, and for late-night work, jazz or ambient usually feels better.";
  }

  return language === "ko"
    ? "원하시면 이렇게 시작해볼 수 있어요. 먼저 지금 필요한 걸 짧게 정리하고, 그다음 바로 실행할 항목 하나를 정한 뒤, 제가 이어서 추천이나 실행까지 도와드릴게요."
    : "A good way to start is to quickly clarify what you need most, pick one thing to do first, and then let me either recommend the next step or carry it out for you.";
}

function buildLocalCapabilityReply(language) {
  return language === "ko"
    ? "저는 자연스럽게 대화하면서도 실제 작업까지 이어서 처리할 수 있어요. 앱 실행, 웹 탐색, 메시지 작성, 파일 읽기와 편집, 화면 이해, 추천 정리까지 한 흐름으로 도와드릴 수 있습니다."
    : "I can keep up a real conversation and also carry things through into desktop actions. That includes opening apps, navigating the web, drafting messages, handling files, understanding the screen, and giving useful recommendations.";
}

function buildLocalChatReply(input, history = []) {
  const language = detectReplyLanguage(input);
  const normalized = normalizePlanText(input);
  const lowered = normalized.toLowerCase();
  const lastAssistantMessage =
    history
      .slice()
      .reverse()
      .find((entry) => entry.role === "assistant")?.content || "";

  if (!normalized) {
    return language === "ko"
      ? "편하게 말씀해 주세요. 같이 정리해도 좋고, 바로 실행할 일부터 시작해도 괜찮습니다."
      : "Talk to me naturally. We can think it through together or move straight into the task.";
  }

  if (/(안녕|반가워|하이|hello|hi|hey)/i.test(normalized)) {
    return language === "ko"
      ? "안녕하세요. 무엇을 도와드릴까요? 편하게 대화하셔도 되고, 필요하면 바로 작업으로 이어서 처리하겠습니다."
      : "Hello. What can I help you with? We can talk naturally, and when you are ready I can carry the task out as well.";
  }

  if (/(고마워|감사|thanks|thank you)/i.test(normalized)) {
    return language === "ko"
      ? "언제든지요. 이어서 필요한 일이 있으면 바로 도와드리겠습니다."
      : "Anytime. If there is another step you want to take, I am ready.";
  }

  if (/(너 누구|누구야|정체|who are you|what are you)/i.test(lowered)) {
    return language === "ko"
      ? "저는 자비스예요. 자연스럽게 대화하면서도, 필요할 때는 바로 앱과 웹 작업까지 이어서 처리하도록 설계된 비서입니다."
      : "I am Jarvis. The idea is to feel conversational while still being able to carry real app and web actions through when needed.";
  }

  if (/(대화할 수 있|얘기할 수 있|말동무|chat with me|can you chat|can we talk|talk to me)/i.test(lowered)) {
    return language === "ko"
      ? "네, 가능합니다. 편하게 말 걸어 주시면 대화도 자연스럽게 이어가고, 필요할 때는 바로 작업으로 전환할 수 있어요."
      : "Yes. You can talk to me naturally, ask questions, or switch straight into getting something done.";
  }

  if (/(뭐 할 수|무엇을 할 수|할 수 있어|도움말|help|capabilities|what can you do)/i.test(lowered)) {
    return buildLocalCapabilityReply(language);
  }

  if (/(추천|recommend|suggest|idea|어떨까|어때)/i.test(lowered)) {
    return buildLocalRecommendationReply(input, language);
  }

  if (/(잘 지내|어때|how are you|how's it going)/i.test(lowered)) {
    return language === "ko"
      ? "좋습니다. 바로 도와드릴 준비가 되어 있어요. 지금은 대화로 정리해도 되고, 실행할 일부터 바로 시작해도 괜찮습니다."
      : "Doing well, and ready to help. We can talk things through first or jump straight into something concrete.";
  }

  if (/(계속|이어|then|next|follow up|follow-up)/i.test(lowered) && lastAssistantMessage) {
    return language === "ko"
      ? `좋아요. 방금 흐름을 이어가겠습니다. ${lastAssistantMessage}에서 바로 다음 단계로 넘어갈 수 있게 도와드릴게요.`
      : `Certainly. We can continue from the last step and move forward without losing the thread.`;
  }

  if (/[?？]$/.test(normalized) || /(왜|어떻게|뭐야|무슨|가능해|can you|could you|would you|how|why|what|which)/i.test(lowered)) {
    return language === "ko"
      ? "네, 같이 풀어볼 수 있어요. 원하시면 핵심만 짧게 설명드리거나, 바로 실전 쪽으로 이어질 수 있게 정리해드릴게요."
      : "Yes, we can work through that. If you want, I can keep it short and direct or turn it into a practical next step.";
  }

  return language === "ko"
    ? `${normalized} 방향으로 이어가면 되겠어요. 원하시면 제가 핵심을 정리하거나 다음 행동을 바로 추천해드릴게요.`
    : `We can keep going in that direction. If you want, I can tighten it up for you or suggest the best next move.`;
}

function looksLikeAppListRequest(text = "") {
  return /(앱 목록|앱 리스트|설치된 앱|사용 가능한 앱|list apps|installed apps|available apps)/i.test(normalizePlanText(text));
}

function extractQuotedText(text = "") {
  const match = String(text).match(/["“'`](.+?)["”'`]/);
  return match?.[1]?.trim() || "";
}

function refersToCurrentAppContext(text = "") {
  return /(거기|그 앱|그 안|that app|there|inside there|current app|방금 연 앱|현재 앱)/i.test(normalizePlanText(text));
}

function extractAppActionTarget(text = "") {
  const normalized = normalizePlanText(text);
  const patterns = [
    /^(.+?)\s*(?:앱에서|에서)\s+/i,
    /^(.+?)\s*(?:앱에|에)\s+/i,
    /(?:in|inside|within|on)\s+(.+?)(?=\s+(?:type|press|click|search|find|save|copy|paste|new|close|quit|focus)|$)/i,
    /^([A-Za-z0-9가-힣 .&+_-]+?)\s+(?:(?:type|press|click|search|find|save|copy|paste|new|close|quit|focus)|(?:입력|눌러|클릭|검색|저장|복사|붙여넣|새|닫아|종료))/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      if (refersToCurrentAppContext(candidate) || candidate.length > 60) {
        return "";
      }

      return candidate;
    }
  }

  return "";
}

function stripAppActionPrefix(text = "") {
  const normalized = normalizePlanText(text);
  const fromMatch = normalized.match(/^(.+?)\s*(?:앱에서|에서)\s+(.+)$/i);

  if (fromMatch?.[2]) {
    return fromMatch[2].trim();
  }

  const toMatch = normalized.match(/^(.+?)\s*(?:앱에|에)\s+(.+)$/i);

  if (toMatch?.[2]) {
    return toMatch[2].trim();
  }

  return normalized.replace(/^(?:in|inside|within|on)\s+.+?\s+/i, "").trim();
}

function looksLikeAppAction(text = "") {
  if (looksLikeYouTubePlaybackRequest(text)) {
    return false;
  }

  const lowered = normalizePlanText(text).toLowerCase();
  
  // 너무 긴 문장은 대화일 가능성이 높음
  if (lowered.length > 50) return false;

  const hasAction = hasAny(lowered, [
    "열어", "실행", "보여", "이동", "입력", "붙여넣", "클릭", "검색",
    "open", "run", "launch", "show", "switch", "type", "paste", "click", "press"
  ]);

  const hasTarget = hasAny(lowered, [
    "앱", "app", "창", "window", "tab", "폴더", "folder", "파일", "file",
    "chrome", "finder", "terminal", "slack", "discord", "spotify", "notion"
  ]);

  return hasAction && hasTarget;
}


function wantsEnterAfterTyping(text = "") {
  return /(엔터|enter|return|검색 실행|search it|run search|확인해|실행해)$/i.test(normalizePlanText(text));
}

function mentionsSearchField(text = "") {
  return /(검색창|search box|search field|find box)/i.test(text);
}

function extractTypeText(text = "") {
  const quoted = extractQuotedText(text);
  if (quoted) {
    return quoted;
  }

  const stripped = stripAppActionPrefix(text);
  const patterns = [
    /(?:type|paste)\s+(.+)$/i,
    /(.+?)\s*(?:라고|을|를)?\s*(?:입력해줘|입력해|입력|붙여넣어줘|붙여넣어)$/i,
    /(?:입력해줘|입력해|입력)\s+(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = stripped.match(pattern);
    if (match?.[1]) {
      return match[1]
        .trim()
        .replace(/^(?:새\s*(?:탭|창|노트|문서|메모)\s*(?:만들어|만들고|열어|열고|create|open)\s*(?:주고|하고|한 다음|then|and)?\s*)+/i, "")
        .replace(/^(?:검색창\s*(?:열고|띄우고)\s*)+/i, "")
        .trim();
    }
  }

  return "";
}

function extractSearchQueryInApp(text = "") {
  const quoted = extractQuotedText(text);
  if (quoted && /(검색|search|find|찾아)/i.test(text)) {
    return quoted;
  }

  const stripped = stripAppActionPrefix(text);
  const patterns = [
    /(?:search(?: for)?|find)\s+(.+)$/i,
    /(.+?)\s*(?:검색해줘|검색해|검색|찾아줘|찾아)$/i
  ];

  for (const pattern of patterns) {
    const match = stripped.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return "";
}

function extractMenuPath(text = "") {
  const match = normalizePlanText(text).match(/(?:menu|메뉴)\s+(.+)$/i);

  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split(/>|\/|→|›/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function inferShortcutIntent(text = "") {
  const lowered = normalizePlanText(text).toLowerCase();

  if (/(새\s*탭|new tab)/i.test(lowered)) {
    return {
      key: "t",
      modifiers: ["command"],
      description: "new tab"
    };
  }

  if (/(새\s*폴더|new folder)/i.test(lowered)) {
    return {
      key: "n",
      modifiers: ["command", "shift"],
      description: "new folder"
    };
  }

  if (/(새\s*(창|문서|노트)|new (window|document|note))/i.test(lowered)) {
    return {
      key: "n",
      modifiers: ["command"],
      description: "new item"
    };
  }

  if (/(저장|save)/i.test(lowered)) {
    return {
      key: "s",
      modifiers: ["command"],
      description: "save"
    };
  }

  if (/(복사|copy)/i.test(lowered)) {
    return {
      key: "c",
      modifiers: ["command"],
      description: "copy"
    };
  }

  if (/(붙여넣|paste)/i.test(lowered) && !extractTypeText(text)) {
    return {
      key: "v",
      modifiers: ["command"],
      description: "paste"
    };
  }

  if (/(잘라내|cut)/i.test(lowered)) {
    return {
      key: "x",
      modifiers: ["command"],
      description: "cut"
    };
  }

  if (/(전체 선택|select all)/i.test(lowered)) {
    return {
      key: "a",
      modifiers: ["command"],
      description: "select all"
    };
  }

  if (/(되돌리기|undo)/i.test(lowered)) {
    return {
      key: "z",
      modifiers: ["command"],
      description: "undo"
    };
  }

  if (/(다시 실행|redo)/i.test(lowered)) {
    return {
      key: "z",
      modifiers: ["command", "shift"],
      description: "redo"
    };
  }

  if (/(닫아|close)/i.test(lowered)) {
    return {
      key: "w",
      modifiers: ["command"],
      description: "close"
    };
  }

  if (/(종료|quit)/i.test(lowered)) {
    return {
      key: "q",
      modifiers: ["command"],
      description: "quit"
    };
  }

  if (/(검색|search|find|찾기)/i.test(lowered)) {
    return {
      key: "f",
      modifiers: ["command"],
      description: "find"
    };
  }

  return null;
}

function inferKeyPress(text = "") {
  const lowered = normalizePlanText(text).toLowerCase();

  const keyMap = [
    { pattern: /(엔터|enter|return)/i, key: "enter" },
    { pattern: /\btab\b|탭/i, key: "tab" },
    { pattern: /(escape|esc|취소)/i, key: "escape" },
    { pattern: /(spacebar|space|스페이스)/i, key: "space" },
    { pattern: /(backspace|delete|삭제)/i, key: "delete" },
    { pattern: /(왼쪽|left)/i, key: "left" },
    { pattern: /(오른쪽|right)/i, key: "right" },
    { pattern: /(위로|up)/i, key: "up" },
    { pattern: /(아래로|down)/i, key: "down" }
  ];

  for (const item of keyMap) {
    if (item.pattern.test(lowered)) {
      return {
        key: item.key,
        modifiers: []
      };
    }
  }

  return null;
}

function buildFallbackAppPlan(input, appName) {
  const typingText = extractTypeText(input);
  const searchQuery = extractSearchQueryInApp(input);
  const menuPath = extractMenuPath(input);
  const shortcutIntent = inferShortcutIntent(input);
  const keyPress = inferKeyPress(input);
  const steps = [
    {
      action: "open_app",
      target: appName
    }
  ];

  if (menuPath.length) {
    steps.push({
      action: "app_menu_click",
      target: appName,
      menuPath
    });

    return {
      reply: "",
      steps
    };
  }

  if (searchQuery || (mentionsSearchField(input) && typingText)) {
    const query = searchQuery || typingText;

    if (/spotify/i.test(appName)) {
      const spotifyTargets = buildSpotifyTargets(query);
      steps.push({
        action: "open_url",
        target: spotifyTargets.uri,
        fallbackTarget: spotifyTargets.webUrl
      });

      return {
        reply: "",
        steps
      };
    }

    steps.push({
      action: "app_shortcut",
      target: appName,
      key: "f",
      modifiers: ["command"]
    });
    steps.push({
      action: "app_type",
      target: appName,
      text: query
    });
    steps.push({
      action: "app_key",
      target: appName,
      key: "enter"
    });

    return {
      reply: "",
      steps
    };
  }

  if (shortcutIntent) {
    steps.push({
      action: "app_shortcut",
      target: appName,
      key: shortcutIntent.key,
      modifiers: shortcutIntent.modifiers
    });
  }

  if (typingText) {
    steps.push({
      action: "app_type",
      target: appName,
      text: typingText
    });

    if (wantsEnterAfterTyping(input)) {
      steps.push({
        action: "app_key",
        target: appName,
        key: "enter"
      });
    }
  } else if (keyPress) {
    steps.push({
      action: "app_key",
      target: appName,
      key: keyPress.key,
      modifiers: keyPress.modifiers
    });
  }

  return {
    reply: "",
    steps
  };
}

function isLikelyWebTarget(text = "") {
  const normalized = normalizePlanText(text).toLowerCase();
  const stripped = stripCommandPrefix(text).toLowerCase();
  const appLike = extractAppName(text).toLowerCase();

  return (
    Boolean(extractUrl(normalized)) ||
    WEB_TARGET_ALIASES.has(normalized) ||
    WEB_TARGET_ALIASES.has(stripped) ||
    WEB_TARGET_ALIASES.has(appLike) ||
    /\b(?:website|site|url|browser|search|검색|브라우저|홈페이지|페이지)\b/i.test(text)
  );
}

function looksLikeAppLaunch(text) {
  const lowered = normalizePlanText(text).toLowerCase();
  const hasLaunchVerb = hasAny(lowered, [
    "open ",
    "launch",
    "run ",
    "start ",
    "execute",
    "켜",
    "실행",
    "열어",
    "시작해"
  ]);
  const looksWebLike =
    isLikelyWebTarget(text) ||
    hasAny(lowered, ["website", "site", "browser", "브라우저", "검색", "search", "google", "youtube"]);

  return hasLaunchVerb && !looksWebLike;
}

function looksLikeWebOpen(text) {
  const lowered = normalizePlanText(text).toLowerCase();
  const hasOpenVerb = hasAny(lowered, ["open", "visit", "go to", "열어", "들어가", "켜"]);

  return hasOpenVerb && isLikelyWebTarget(text);
}

function extractAppName(text) {
  const quoted = extractQuotedText(text);

  if (quoted) {
    return cleanupParsedText(quoted);
  }

  const directTarget = findDirectTargets(text, DIRECT_APP_TARGETS)[0];
  return directTarget?.label || "";
}

function extractFileWriteParts(input) {
  const match = input.match(/(?:write|edit|save)\s+file\s+(.+?)\s*:::\s*([\s\S]+)/i);

  if (!match) {
    return null;
  }

  return {
    path: match[1].trim(),
    content: match[2]
  };
}

function extractFileReadPath(input) {
  const match =
    input.match(/(?:read|open)\s+file\s+(.+)/i) ||
    input.match(/파일\s+(.+?)\s*(?:읽어|열어|보여줘)/i);

  return match?.[1]?.trim() || "";
}

function extractFileListPath(input) {
  const match =
    input.match(/(?:list|show)\s+(?:files?|directory|dir)\s*(.*)/i) ||
    input.match(/(.+?)\s*(?:폴더|디렉터리)\s*(?:목록|보여줘)/i);

  return match?.[1]?.trim() || ".";
}

function extractSceneName(input) {
  const match =
    input.match(/scene\s+(.+)/i) ||
    input.match(/씬\s+(.+?)\s*(?:로|으로)?\s*(?:바꿔|전환|변경)/i);

  return match?.[1]?.trim() || "";
}

function detectGamePlatform(input = "") {
  const normalized = normalizePlanText(input);
  const mentionsSteam = /(steam|스팀)/i.test(normalized);
  const mentionsEpic = /(epic|에픽)/i.test(normalized);

  if (mentionsSteam && !mentionsEpic) {
    return "steam";
  }

  if (mentionsEpic && !mentionsSteam) {
    return "epic";
  }

  return "both";
}

function looksLikeInstalledGameListRequest(input = "") {
  return /(?:설치된\s*게임|게임\s*목록|보유\s*게임|installed games|game list|steam games|epic games)/i.test(
    normalizePlanText(input)
  );
}

function extractGameName(input = "") {
  const normalized = normalizePlanText(input);

  if (!normalized || looksLikeInstalledGameListRequest(normalized)) {
    return "";
  }

  const patterns = [
    /(?:steam|스팀|epic|에픽(?:\s*게임즈)?)(?:에서)?\s+(.+?)\s*(?:게임\s*)?(?:설치해줘|설치|install(?: it)?|업데이트해줘|업데이트|update)$/i,
    /(?:install|update)\s+(.+?)\s+(?:on|from)\s+(?:steam|epic)/i,
    /(?:install|update)\s+(.+)$/i,
    /(.+?)\s*(?:게임\s*)?(?:설치해줘|설치|업데이트해줘|업데이트)$/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (match?.[1]) {
      const cleaned = cleanupParsedText(
        match[1]
          .replace(/^(?:the|a|an)\s+/i, "")
          .replace(/\s+(?:game|게임)\s*$/i, "")
      );

      if (cleaned && !/^(?:steam|스팀|epic|에픽|game|게임)$/i.test(cleaned)) {
        return cleaned;
      }
    }
  }

  return "";
}

function looksLikeGameInstallRequest(input = "") {
  const normalized = normalizePlanText(input);

  return /(install|설치)/i.test(normalized) && /(steam|epic|스팀|에픽|game|게임)/i.test(normalized);
}

function looksLikeGameUpdateRequest(input = "") {
  const normalized = normalizePlanText(input);

  return /(update|업데이트|패치)/i.test(normalized) && /(steam|epic|스팀|에픽|game|게임)/i.test(normalized);
}

function looksLikeCodeProjectRequest(input = "") {
  const normalized = normalizePlanText(input);
  const hasCreationVerb = /(make|build|create|generate|scaffold|write|code|program|develop|만들어|생성|구현|코드\s*짜|코드\s*써)/i.test(
    normalized
  );
  const hasProjectTarget = /(project|app|website|site|game|script|tool|prototype|snake|todo|프로젝트|앱|웹사이트|게임|스크립트|도구|스네이크|할 일)/i.test(
    normalized
  );

  if (!hasCreationVerb || !hasProjectTarget) {
    return false;
  }

  return !/(read file|open file|edit file|파일\s*(읽어|열어|수정)|directory|폴더\s*목록)/i.test(normalized);
}

function isSpotifyRequest(text = "") {
  return /(spotify|스포티파이)/i.test(normalizePlanText(text));
}

function looksLikeSpotifyPlayback(text = "") {
  const lowered = normalizePlanText(text).toLowerCase();

  if (looksLikeRecommendationStyleMediaQuestion(lowered)) {
    return false;
  }

  return (
    isSpotifyRequest(lowered) &&
    hasDirectMediaActionSignal(lowered) &&
    hasAny(lowered, [
      "play",
      "playlist",
      "search",
      "find",
      "pause",
      "resume",
      "skip",
      "open",
      "틀어",
      "재생",
      "검색",
      "찾아",
      "열어",
      "일시정지",
      "다음 곡",
      "이전 곡",
      "플레이리스트"
    ])
  );
}

function extractSpotifyQuery(input = "") {
  const query = normalizePlanText(input)
    .replace(/.*?(spotify|스포티파이)(?:에서|에서는|에서도|에서만)?\s*/i, "")
    .replace(
      /\s*(틀어줘|틀어|재생해줘|재생해|재생|play it|play this|play|들려줘|들려|켜줘|켜)\s*$/i,
      ""
    )
    .trim();

  if (!query) {
    return "";
  }

  if (/^(music|song|songs|track|playlist|음악|노래|플레이리스트)$/i.test(query)) {
    return "";
  }

  return query;
}

function detectWorkspaceAppName(text = "") {
  const normalized = normalizePlanText(text);

  if (/(slack|슬랙)/i.test(normalized)) {
    return "Slack";
  }

  if (/(discord|디스코드)/i.test(normalized)) {
    return "Discord";
  }

  return "";
}

function looksLikeFreshWorkspaceCommand(text = "") {
  return Boolean(detectWorkspaceAppName(text)) &&
    /(메시지|message|reply|답장|send|보내|dm|대화|conversation|채널|channel|열어|open|이동|switch|focus)/i.test(
      normalizePlanText(text)
    );
}

function buildSpotifyTargets(query = "") {
  const normalizedQuery = normalizeWhitespace(query);

  if (!normalizedQuery) {
    return {
      uri: "spotify:",
      webUrl: "https://open.spotify.com/"
    };
  }

  const encodedQuery = encodeURIComponent(normalizedQuery);
  return {
    uri: `spotify:search:${encodedQuery}`,
    webUrl: `https://open.spotify.com/search/${encodedQuery}`
  };
}

function cleanupParsedText(value = "") {
  return String(value)
    .trim()
    .replace(/^["“'`]+|["”'`]+$/g, "")
    .replace(/^[,:-]+|[,:-]+$/g, "")
    .replace(/[.?!]+$/g, "")
    .trim();
}

function cleanupWorkspaceMessage(value = "") {
  return cleanupParsedText(
    String(value)
      .replace(/\s*라고\s*$/i, "")
      .replace(/\s*라는\s*메시지\s*$/i, "")
  );
}

function getSpecializedAppSkill(appName = "") {
  const normalized = normalizePlanText(appName).toLowerCase();

  if (/(spotify|스포티파이)/i.test(normalized)) {
    return "spotify";
  }

  if (/(finder|파인더)/i.test(normalized)) {
    return "finder";
  }

  if (/(notes|메모)/i.test(normalized)) {
    return "notes";
  }

  if (/(google chrome|chrome|크롬|구글크롬)/i.test(normalized)) {
    return "chrome";
  }

  if (/(slack|슬랙)/i.test(normalized)) {
    return "slack";
  }

  if (/(discord|디스코드)/i.test(normalized)) {
    return "discord";
  }

  return "";
}

function parseSpotifySkill(input = "", route = {}) {
  const normalized = normalizePlanText(input);
  const query = normalizeWhitespace(route.query || extractSpotifyQuery(input));

  if (/(다음\s*곡|skip|next(?: track)?)/i.test(normalized)) {
    return {
      intent: "next"
    };
  }

  if (/(이전\s*곡|previous(?: track)?|prev(?: track)?)/i.test(normalized)) {
    return {
      intent: "previous"
    };
  }

  if (/(일시정지|pause|멈춰|정지해)/i.test(normalized)) {
    return {
      intent: "pause"
    };
  }

  if (/(다시\s*재생|재생\s*다시|resume|continue|keep playing)/i.test(normalized)) {
    return {
      intent: "resume"
    };
  }

  if (query) {
    return {
      intent: "search",
      query
    };
  }

  if (/(play|재생|틀어|들려|음악|노래|playlist|song|track)/i.test(normalized)) {
    return {
      intent: "resume"
    };
  }

  return {
    intent: "open"
  };
}

function extractFinderLocation(text = "") {
  const quoted = extractQuotedText(text);

  if (quoted && /(폴더|folder|path|directory|경로|finder|파인더|open|show|reveal|go to|열어|보여|이동)/i.test(text)) {
    return cleanupParsedText(quoted);
  }

  const stripped = stripAppActionPrefix(text)
    .replace(/^(?:새\s*창(?:을)?\s*(?:열고|열어|만들고|만들어)\s*)+/i, "")
    .replace(/^(?:new window\s*(?:and\s*)?)+/i, "")
    .trim();
  const patterns = [
    /(?:open|show|reveal|go to)\s+(.+?)\s*(?:folder|path|directory)?$/i,
    /(.+?)\s*(?:폴더|경로|디렉터리)?\s*(?:열어줘|열어|보여줘|보여|이동해줘|이동해)$/i
  ];

  for (const pattern of patterns) {
    const match = stripped.match(pattern);

    if (match?.[1]) {
      return cleanupParsedText(match[1]);
    }
  }

  return "";
}

function parseFinderSkill(text = "") {
  const normalized = normalizePlanText(text);

  if (/(검색|search|find|찾아)/i.test(normalized)) {
    const query = cleanupParsedText(extractSearchQueryInApp(text));

    if (query) {
      return {
        intent: "search",
        query
      };
    }
  }

  if (/(새\s*창|new window)/i.test(normalized)) {
    return {
      intent: "new_window",
      location: extractFinderLocation(text)
    };
  }

  const location = extractFinderLocation(text);

  if (location) {
    return {
      intent: "open_path",
      location
    };
  }

  return null;
}

function extractNotesTitle(text = "") {
  const stripped = stripAppActionPrefix(text);
  const explicit = stripped.match(/(?:제목(?:은|:)?|title(?: is|:)?)(.+?)(?=(?:내용(?:은|:)?|본문(?:은|:)?|body(?: is|:)?|text(?: is|:)?|$))/i);

  if (explicit?.[1]) {
    return cleanupParsedText(explicit[1]);
  }

  if (/(새\s*(노트|메모)|new (note|memo))/i.test(text) && extractQuotedText(text) && !/(내용|body|본문|text)/i.test(text)) {
    return cleanupParsedText(extractQuotedText(text));
  }

  return "";
}

function extractNotesBody(text = "") {
  const stripped = stripAppActionPrefix(text);
  const explicit = stripped.match(/(?:내용(?:은|:)?|본문(?:은|:)?|body(?: is|:)?|text(?: is|:)?)(.+)$/i);

  if (explicit?.[1]) {
    return cleanupParsedText(explicit[1]);
  }

  if (/(새\s*(노트|메모)|new (note|memo))/i.test(text)) {
    return cleanupParsedText(extractTypeText(text));
  }

  return "";
}

function parseNotesSkill(text = "") {
  const normalized = normalizePlanText(text);

  if (/(검색|search|find|찾아)/i.test(normalized)) {
    const query = cleanupParsedText(extractSearchQueryInApp(text));

    if (query) {
      return {
        intent: "search",
        query
      };
    }
  }

  if (/(새\s*(노트|메모)|new (note|memo))/i.test(normalized)) {
    return {
      intent: "create",
      title: extractNotesTitle(text),
      body: extractNotesBody(text)
    };
  }

  return null;
}

function extractChromeSearchQuery(text = "") {
  const quoted = extractQuotedText(text);

  if (quoted && /(검색|search|find|look up|찾아)/i.test(text)) {
    return cleanupParsedText(quoted);
  }

  const stripped = stripAppActionPrefix(text)
    .replace(/^(?:새\s*탭(?:을)?\s*(?:열고|열어|만들고|만들어|띄우고)\s*)+/i, "")
    .replace(/^(?:new tab\s*(?:and\s*)?)+/i, "")
    .trim();
  const patterns = [
    /(?:search(?: for)?|find|look up)\s+(.+)$/i,
    /(.+?)\s*(?:검색해줘|검색해|검색|찾아줘|찾아)$/i
  ];

  for (const pattern of patterns) {
    const match = stripped.match(pattern);

    if (match?.[1]) {
      return cleanupParsedText(match[1]);
    }
  }

  return "";
}

function extractChromeTarget(text = "") {
  const explicitUrl = extractUrl(text);

  if (explicitUrl) {
    return explicitUrl.startsWith("http") ? explicitUrl : `https://${explicitUrl}`;
  }

  const searchQuery = extractChromeSearchQuery(text);

  if (searchQuery) {
    return searchQuery;
  }

  const stripped = stripAppActionPrefix(text)
    .replace(/^(?:새\s*탭(?:을)?\s*(?:열고|열어|만들고|만들어|띄우고)\s*)+/i, "")
    .replace(/^(?:new tab\s*(?:and\s*)?)+/i, "")
    .trim();
  const match =
    stripped.match(/(?:open|go to|visit)\s+(.+)$/i) ||
    stripped.match(/(.+?)\s*(?:열어줘|열어|들어가줘|이동해줘|이동해)$/i);
  const candidate = cleanupParsedText(match?.[1] || "");

  if (!candidate || /^(?:새\s*탭|new tab)$/i.test(candidate)) {
    return "";
  }

  return candidate;
}

function parseChromeSkill(text = "") {
  const normalized = normalizePlanText(text);
  const wantsNewTab = /(새\s*탭|new tab)/i.test(normalized);

  if (/(뒤로|go back|\bback\b)/i.test(normalized)) {
    return {
      intent: "back"
    };
  }

  if (/(앞으로|go forward|forward)/i.test(normalized)) {
    return {
      intent: "forward"
    };
  }

  if (/(새로고침|refresh|reload)/i.test(normalized)) {
    return {
      intent: "refresh"
    };
  }

  const target = extractChromeTarget(text);

  if (target) {
    return {
      intent: "navigate",
      target,
      newTab: wantsNewTab
    };
  }

  if (wantsNewTab) {
    return {
      intent: "new_tab"
    };
  }

  return null;
}

function cleanupWorkspaceTarget(value = "") {
  return cleanupParsedText(
    String(value)
      .replace(/^[@#]/, "")
      .replace(/\s*(?:에|에게|한테)\s*$/i, "")
      .replace(/\s*(?:채널|channel|dm|direct message|대화|conversation)\s*$/i, "")
  );
}

function isCurrentWorkspaceReference(value = "") {
  return /^(?:여기|거기|지금\s*(?:대화|채팅|방)?|현재\s*(?:대화|채팅|방)?|이\s*(?:대화|채팅|방)|current|current\s+(?:chat|conversation)|here|this\s+(?:chat|conversation))$/i.test(
    cleanupParsedText(value)
  );
}

function parseWorkspaceSkill(text = "") {
  const stripped = stripAppActionPrefix(text).trim();
  const withoutWorkspaceApp = stripped.replace(/^(?:discord|디스코드|slack|슬랙)\s*/i, "").trim();
  const quoted = extractQuotedText(stripped);

  if (/^(?:dm\s*)?(?:메시지\s*)?(?:보내줘|보내|send(?:\s+a)?(?:\s+message)?|message|reply|답장해줘|답장)$/i.test(withoutWorkspaceApp)) {
    return {
      intent: "compose_message",
      target: "",
      message: ""
    };
  }

  if (
    /(read|check|show|latest|recent|누가|누구|읽어|알려|확인|최근|새로\s*온|온)/i.test(withoutWorkspaceApp) &&
    /(dm|디엠|메시지|message|messages|대화|conversation)/i.test(stripped) &&
    !/(보내|send|reply|답장)/i.test(stripped)
  ) {
    return {
      intent: "read_messages"
    };
  }

  if (quoted && /(보내|send|message|reply|답장)/i.test(stripped)) {
    const withoutQuoted = stripped.replace(/["“'`](.+?)["”'`]/, " ").replace(/\s+/g, " ").trim();
    const targetMatch =
      withoutQuoted.match(/^(.+?)\s*(?:에|에게|한테)\s*(?:라고\s*)?(?:메시지\s*)?(?:보내줘|보내|답장해줘|답장)$/i) ||
      withoutQuoted.match(/^(.+?)\s*(?:에|에게|한테)\s*(?:라고\s*)?(?:send|message|reply)$/i) ||
      withoutQuoted.match(/(?:to)\s+(.+?)\s*(?:send|message|reply).*$/i);

    return {
      intent: "send_message",
      target: isCurrentWorkspaceReference(targetMatch?.[1] || "") ? "" : cleanupWorkspaceTarget(targetMatch?.[1] || ""),
      message: cleanupWorkspaceMessage(quoted)
    };
  }

  const koreanMessage = stripped.match(/^(.+?)\s*(?:에|에게|한테)\s+(.+?)\s*(?:메시지\s*)?(?:보내줘|보내|답장해줘|답장)$/i);

  if (koreanMessage?.[1] && koreanMessage?.[2]) {
    return {
      intent: "send_message",
      target: isCurrentWorkspaceReference(koreanMessage[1]) ? "" : cleanupWorkspaceTarget(koreanMessage[1]),
      message: cleanupWorkspaceMessage(koreanMessage[2])
    };
  }

  const englishMessage = stripped.match(/^(?:send(?: a message)?|message|reply)\s+(.+?)\s+to\s+(.+)$/i);

  if (englishMessage?.[1] && englishMessage?.[2]) {
    return {
      intent: "send_message",
      target: isCurrentWorkspaceReference(englishMessage[2]) ? "" : cleanupWorkspaceTarget(englishMessage[2]),
      message: cleanupWorkspaceMessage(englishMessage[1])
    };
  }

  const bareMessage = stripped.match(/^(.+?)\s*(?:메시지\s*)?(?:보내줘|보내|send|reply)$/i);
  const bareCandidate = cleanupParsedText(bareMessage?.[1] || "");

  if (
    bareMessage?.[1] &&
    !/^(message|메시지|discord|디스코드|slack|슬랙)$/i.test(bareCandidate) &&
    !/(채널|channel|dm|대화|conversation|open|열어|이동)/i.test(bareMessage[1])
  ) {
    return {
      intent: "send_message",
      target: "",
      message: cleanupWorkspaceMessage(bareCandidate)
    };
  }

  const openMatch =
    stripped.match(/(?:open|switch to|go to|focus)\s+(.+?)\s*(?:channel|dm|conversation)?$/i) ||
    stripped.match(/(.+?)\s*(?:채널|dm|대화)?\s*(?:열어줘|열어|이동해줘|이동해|전환해줘|전환해|포커스해줘|포커스해)$/i);

  if (openMatch?.[1]) {
    return {
      intent: "open_target",
      target: cleanupWorkspaceTarget(openMatch[1])
    };
  }

  return null;
}

function parseWorkspaceFollowUp(text = "") {
  const normalized = normalizePlanText(text);

  if (!normalized) {
    return null;
  }

  if (/^(취소|cancel|그만|멈춰|stop)$/i.test(normalized)) {
    return {
      cancel: true
    };
  }

  const quoted = extractQuotedText(normalized);

  if (quoted) {
    const withoutQuoted = normalized.replace(/["“'`](.+?)["”'`]/, " ").replace(/\s+/g, " ").trim();
    const targetMatch =
      withoutQuoted.match(/^(.+?)\s*(?:에|에게|한테|to)$/i) ||
      withoutQuoted.match(/^(?:to)\s+(.+)$/i);

    return {
      target: cleanupWorkspaceTarget(targetMatch?.[1] || ""),
      message: cleanupWorkspaceMessage(quoted)
    };
  }

  const koreanPair = normalized.match(/^(.+?)\s*(?:에|에게|한테)\s+(.+)$/i);

  if (koreanPair?.[1] && koreanPair?.[2]) {
    return {
      target: cleanupWorkspaceTarget(koreanPair[1]),
      message: cleanupWorkspaceMessage(koreanPair[2])
    };
  }

  const englishPair = normalized.match(/^(.+?)\s+to\s+(.+)$/i);

  if (englishPair?.[1] && englishPair?.[2]) {
    return {
      message: cleanupWorkspaceMessage(englishPair[1]),
      target: cleanupWorkspaceTarget(englishPair[2])
    };
  }

  return null;
}

function buildRouteFallback(input) {
  const lowered = normalizePlanText(input).toLowerCase();
  const writeParts = extractFileWriteParts(input);
  const readPath = extractFileReadPath(input);
  const workspaceApp = detectWorkspaceAppName(input);
  const complexBrowserIntent = extractComplexBrowserIntent(input);
  const directOpenTargets = extractDirectOpenTargets(input);

  if (looksLikeAppListRequest(input)) {
    return {
      route: "app_list",
      language: detectReplyLanguage(input)
    };
  }

  if (looksLikeSystemBriefingRequest(input)) {
    return {
      route: "system_briefing",
      language: detectReplyLanguage(input)
    };
  }

  if (looksLikeInstalledGameListRequest(input)) {
    return {
      route: "game_list",
      language: detectReplyLanguage(input),
      platform: detectGamePlatform(input)
    };
  }

  if (looksLikeGameInstallRequest(input)) {
    return {
      route: "game_install",
      language: detectReplyLanguage(input),
      platform: detectGamePlatform(input),
      query: extractGameName(input)
    };
  }

  if (looksLikeGameUpdateRequest(input)) {
    return {
      route: "game_update",
      language: detectReplyLanguage(input),
      platform: detectGamePlatform(input),
      query: extractGameName(input)
    };
  }

  if (looksLikeCodeProjectRequest(input)) {
    return {
      route: "code_project",
      language: detectReplyLanguage(input)
    };
  }

  if (directOpenTargets) {
    return {
      route: "open_targets",
      language: detectReplyLanguage(input),
      targets: directOpenTargets
    };
  }

  if (
    hasAny(lowered, ["academic", "study", "explain", "solve", "tutor", "문법", "grammar", "proofread", "rewrite"]) &&
    hasAny(lowered, ["screen", "화면", "ocr", "스크린"])
  ) {
    return {
      route: "screen_academic",
      language: detectReplyLanguage(input)
    };
  }

  if (hasAny(lowered, ["screen", "화면", "ocr", "스크린", "summarize screen"])) {
    return {
      route: "screen_summary",
      language: detectReplyLanguage(input)
    };
  }

  if (complexBrowserIntent && (complexBrowserIntent.query || complexBrowserIntent.wantsRead)) {
    return {
      route: "browser",
      language: detectReplyLanguage(input)
    };
  }

  if (hasAny(lowered, ["login", "log in", "로그인"])) {
    return {
      route: "browser_login",
      language: detectReplyLanguage(input),
      siteOrUrl: extractUrl(input) || stripCommandPrefix(input)
    };
  }

  if (looksLikeYouTubePlaybackRequest(input)) {
    return {
      route: "browser",
      language: detectReplyLanguage(input)
    };
  }

  if (looksLikeSpotifyPlayback(input)) {
    return {
      route: "spotify_play",
      language: detectReplyLanguage(input),
      query: extractSpotifyQuery(input)
    };
  }

  if (
    workspaceApp &&
    (
      /(메시지|message|reply|답장|dm|대화|conversation|채널|channel|보내|send)/i.test(input) ||
      /(?:discord|디스코드|slack|슬랙)\s*(?:에서|안에서).*(?:열어|이동|switch|focus|open)/i.test(input)
    )
  ) {
    return {
      route: "app_action",
      language: detectReplyLanguage(input),
      appName: workspaceApp
    };
  }

  if (
    looksLikeAppAction(input) &&
    (Boolean(extractAppActionTarget(input)) || /(거기|그 앱|that app|there|방금 연 앱|현재 앱)/i.test(input))
  ) {
    return {
      route: "app_action",
      language: detectReplyLanguage(input),
      appName: extractAppActionTarget(input)
    };
  }

  if (hasAny(lowered, ["obs", "scene", "stream status", "방송", "씬"])) {
    if (hasAny(lowered, ["connect", "연결"])) {
      return {
        route: "obs_connect",
        language: detectReplyLanguage(input)
      };
    }

    if (hasAny(lowered, ["start stream", "방송 시작"])) {
      return {
        route: "obs_start",
        language: detectReplyLanguage(input)
      };
    }

    if (hasAny(lowered, ["stop stream", "방송 종료"])) {
      return {
        route: "obs_stop",
        language: detectReplyLanguage(input)
      };
    }

    if (hasAny(lowered, ["switch scene", "scene ", "씬"])) {
      return {
        route: "obs_scene",
        language: detectReplyLanguage(input),
        sceneName: extractSceneName(input)
      };
    }

    return {
      route: "obs_status",
      language: detectReplyLanguage(input)
    };
  }

  if (writeParts) {
    return {
      route: "file_write",
      language: detectReplyLanguage(input),
      path: writeParts.path,
      content: writeParts.content
    };
  }

  if (readPath) {
    return {
      route: "file_read",
      language: detectReplyLanguage(input),
      path: readPath
    };
  }

  if (hasAny(lowered, ["list files", "show files", "directory", "dir", "파일 목록", "폴더"])) {
    return {
      route: "file_list",
      language: detectReplyLanguage(input),
      path: extractFileListPath(input)
    };
  }

  if (
    complexBrowserIntent ||
    hasAny(lowered, ["browser", "search", "open website", "go to", "브라우저", "검색"]) ||
    Boolean(extractUrl(input))
  ) {
    return {
      route: "browser",
      language: detectReplyLanguage(input)
    };
  }

  if (looksLikeWebOpen(input)) {
    return {
      route: "browser",
      language: detectReplyLanguage(input)
    };
  }

  if (hasAny(lowered, ["stream", "스트리밍"])) {
    return {
      route: "stream_prep",
      language: detectReplyLanguage(input)
    };
  }

  if (looksLikeAppLaunch(input)) {
    return {
      route: "app_open",
      language: detectReplyLanguage(input),
      appName: extractAppName(input)
    };
  }

  return {
    route: "chat",
    language: detectReplyLanguage(input)
  };
}

class AssistantService {
  constructor({ automation, browser, codeProjects, credentials, extensions, files, games, memory, obs, screen, tts, settings }) {
    this.automation = automation;
    this.browser = browser;
    this.codeProjects = codeProjects || null;
    this.credentials = credentials;
    this.extensions = extensions || null;
    this.files = files;
    this.games = games || null;
    this.memory = memory || null;
    this.obs = obs;
    this.screen = screen;
    this.tts = tts;
    this.settings = settings;
    this.history = [];
    this.lastActiveApp = "";
    this.lastMemoryFingerprint = "";
    this.pendingWorkspaceMessage = null;
    this.pendingClarification = null;
    this.pendingBrowserContinuation = null;
  }

  normalizeRequestedAppName(appName = "") {
    const cleanName = String(appName || "").trim();

    if (!cleanName) {
      return "";
    }

    return this.extensions?.resolveConnectorAppName?.(cleanName) || cleanName;
  }

  getExtensionPlanningHints(appName = "") {
    return this.extensions?.getAppPlanningHints?.(appName) || [];
  }

  async maybeHandleExtensionWebhook(input) {
    if (!this.extensions?.maybeHandleWebhook) {
      return null;
    }

    return this.extensions.maybeHandleWebhook(input, {
      language: detectReplyLanguage(input),
      history: this.getRecentHistory(8),
      lastActiveApp: this.lastActiveApp
    });
  }

  makeAction(type, target, status = "executed", extra = {}) {
    return {
      type,
      target,
      status,
      ...extra
    };
  }

  async completeLocalCommand(input, actions, details, fallback) {
    const result = {
      actions,
      details
    };

    return {
      reply: shouldSkipCommandPolish(input, result)
        ? buildCommandFallback(detectReplyLanguage(input), fallback)
        : await this.polishCommandReply(input, result, fallback),
      actions,
      provider: "local",
      details
    };
  }

  async polishCommandReply(input, result, fallback) {
    return buildCommandFallback(detectReplyLanguage(input), fallback);
  }

  isCancelResponse(input = "") {
    return /(취소|그만|아니야|됐어|cancel|stop|never mind|forget it)/i.test(normalizePlanText(input));
  }

  buildClarificationQuestion(language, prompt, candidates = []) {
    if (!candidates.length) {
      return prompt;
    }

    const optionList = candidates
      .slice(0, 4)
      .map((candidate, index) => `${index + 1}. ${candidate.name}`)
      .join(language === "ko" ? " / " : " / ");

    return language === "ko"
      ? `${prompt} 후보는 ${optionList}예요. 번호나 이름으로 말씀해 주세요.`
      : `${prompt} The closest options are ${optionList}. Reply with a number or the app name.`;
  }

  beginClarification(originalInput, route, question, extra = {}) {
    this.pendingClarification = {
      originalInput,
      route,
      question,
      ...extra
    };

    return {
      reply: question,
      actions: [],
      provider: "local-clarify",
      details: {
        pendingClarification: true,
        kind: extra.kind || route.route
      }
    };
  }

  pickCandidateFromAnswer(input = "", candidates = []) {
    const numberMatch = normalizePlanText(input).match(/\b(\d+)\b/);

    if (numberMatch) {
      const index = Number(numberMatch[1]) - 1;

      if (index >= 0 && index < candidates.length) {
        return candidates[index];
      }
    }

    const normalizedInput = normalizeEntityToken(input);

    if (!normalizedInput) {
      return null;
    }

    return (
      candidates.find((candidate) => normalizeEntityToken(candidate.name) === normalizedInput) ||
      candidates.find((candidate) => normalizeEntityToken(candidate.name).includes(normalizedInput)) ||
      null
    );
  }

  async continuePendingClarification(input) {
    if (!this.pendingClarification) {
      return null;
    }

    const pending = this.pendingClarification;
    const language = pending.language || detectReplyLanguage(input);

    if (this.isCancelResponse(input)) {
      this.pendingClarification = null;

      return {
        reply: language === "ko" ? "알겠습니다. 그 요청은 취소할게요." : "Understood. I will cancel that request.",
        actions: [],
        provider: "local"
      };
    }

    if (pending.kind === "app_missing_recovery") {
      const normalizedAnswer = normalizePlanText(input).toLowerCase();
      let choice = "";

      if (/(웹|web|browser|브라우저|online|온라인|사이트|site)/i.test(normalizedAnswer)) {
        choice = "web";
      } else if (/(설치|install|download|다운로드|setup|셋업)/i.test(normalizedAnswer)) {
        choice = "install";
      } else if (/(명령|command|terminal|터미널|cli|doctor|dashboard|대시보드|status)/i.test(normalizedAnswer)) {
        choice = "commands";
      }

      if (!choice) {
        return {
          reply: pending.question,
          actions: [],
          provider: "local-clarify",
          details: {
            pendingClarification: true,
            kind: pending.kind
          }
        };
      }

      this.pendingClarification = null;

      return this.executeRoute(pending.originalInput || input, {
        ...(pending.route || {}),
        appRecoveryChoice: choice
      });
    }

    let resolvedValue = cleanupParsedText(input);

    if (Array.isArray(pending.candidates) && pending.candidates.length) {
      const selected = this.pickCandidateFromAnswer(input, pending.candidates);

      if (!selected) {
        return {
          reply: this.buildClarificationQuestion(language, pending.retryPrompt || pending.question, pending.candidates),
          actions: [],
          provider: "local-clarify",
          details: {
            pendingClarification: true,
            kind: pending.kind || pending.route?.route || "clarification"
          }
        };
      }

      resolvedValue = selected.name;
    }

    if (!resolvedValue) {
      return {
        reply: pending.question,
        actions: [],
        provider: "local-clarify",
        details: {
          pendingClarification: true,
          kind: pending.kind || pending.route?.route || "clarification"
        }
      };
    }

    this.pendingClarification = null;

    const mergedRoute = {
      ...(pending.route || {})
    };

    if (pending.field) {
      mergedRoute[pending.field] = resolvedValue;
    }

    return this.executeRoute(pending.originalInput || input, mergedRoute);
  }

  async openBrowserTargetForUser(targetUrl, options = {}) {
    if (!targetUrl) {
      throw new Error("A browser target is required.");
    }

    if (options.preferAssistant && this.browser?.navigate) {
      try {
        const page = await this.browser.navigate(targetUrl);

        return {
          url: page.url || targetUrl,
          title: page.title || "",
          openMode: "assistant-browser",
          provider: this.browser.getProviderLabel?.() || "playwright"
        };
      } catch (_error) {
        // Fall through to the system browser below.
      }
    }

    try {
      await this.automation.execute({
        type: "open_url",
        target: targetUrl
      });

      return {
        url: targetUrl,
        title: "",
        openMode: "system-browser"
      };
    } catch (_error) {
      const page = this.browser?.navigate
        ? await this.browser.navigate(targetUrl)
        : await this.browser.open(targetUrl);

      return {
        ...page,
        openMode: "assistant-browser"
      };
    }
  }

  buildMissingAppRecoveryQuestion(input, requestedApp, officialFallback = null) {
    const language = detectReplyLanguage(input);
    const label = officialFallback?.label || requestedApp;

    if (officialFallback?.webRunnable && officialFallback.webUrl) {
      return language === "ko"
        ? `"${label}" 앱을 이 컴퓨터에서 찾지 못했어요. 대신 공식 웹에서 실행할 수 있어요: ${officialFallback.webUrl}\n앱 설치 페이지를 열까요, 아니면 웹으로 열까요?`
        : `I could not find "${label}" on this computer. It can run from its official web app: ${officialFallback.webUrl}\nShould I open the install page or open the web app?`;
    }

    if (officialFallback?.kind === "cli") {
      const installPreview = (officialFallback.installCommands || []).slice(0, 2).join(" / ");
      const runPreview = (officialFallback.runCommands || []).join(" / ");

      return language === "ko"
        ? `"${label}" 명령을 이 컴퓨터에서 찾지 못했어요. 공식 실행 흐름상 먼저 설치와 온보딩이 필요합니다.\n설치 예: ${installPreview}\n설치 후 점검/실행: ${runPreview}\n공식 설치 문서를 열까요, 아니면 명령만 다시 보여드릴까요?`
        : `I could not find the "${label}" command on this computer. The official flow requires installation and onboarding first.\nInstall examples: ${installPreview}\nAfter install: ${runPreview}\nShould I open the official install docs or show the commands again?`;
    }

    if (officialFallback?.installUrl) {
      return language === "ko"
        ? `"${label}" 앱을 이 컴퓨터에서 찾지 못했어요. 공식 웹 실행 경로는 확인되지 않았고, 설치 페이지는 확인돼요.\n설치 페이지를 열까요?`
        : `I could not find "${label}" on this computer. I do not have a verified web-app route for it, but I found an official install page.\nShould I open the install page?`;
    }

    return language === "ko"
      ? `"${requestedApp}" 앱을 이 컴퓨터에서 찾지 못했어요. 공식 웹 실행 가능 여부도 아직 확인된 목록에 없어요.\n공식 사이트나 다운로드 페이지를 Playwright로 찾아볼까요?`
      : `I could not find "${requestedApp}" on this computer, and it is not in the verified web-app list yet.\nShould I use Playwright to look for its official site or download page?`;
  }

  buildCliFallbackReply(input, requestedApp, officialFallback) {
    const language = detectReplyLanguage(input);
    const label = officialFallback?.label || requestedApp;
    const installLines = (officialFallback?.installCommands || []).map((command) => `- ${command}`).join("\n");
    const runLines = (officialFallback?.runCommands || []).map((command) => `- ${command}`).join("\n");

    return language === "ko"
      ? `"${label}"는 아직 로컬에서 실행할 수 없어요. 공식 흐름은 아래 중 하나로 설치한 뒤 온보딩하고 실행 상태를 확인하는 방식입니다.\n\n설치:\n${installLines}\n\n설치 후:\n${runLines}`
      : `"${label}" is not runnable locally yet. The official flow is to install it, onboard it, then verify or open the dashboard.\n\nInstall:\n${installLines}\n\nAfter install:\n${runLines}`;
  }

  async handleMissingAppRecovery(input, route = {}, requestedApp = "") {
    const language = detectReplyLanguage(input);
    const officialFallback = findOfficialAppFallback(requestedApp);
    const label = officialFallback?.label || requestedApp;
    const choice = String(route.appRecoveryChoice || "").trim();

    if (choice === "web" && officialFallback?.webRunnable && officialFallback.webUrl) {
      const opened = await this.openBrowserTargetForUser(officialFallback.webUrl, {
        preferAssistant: true
      });

      return {
        reply:
          language === "ko"
            ? `${label} 앱은 로컬에 없어서 공식 웹 앱을 Playwright 브라우저로 열었어요.`
            : `${label} is not installed locally, so I opened the official web app in the Playwright browser.`,
        actions: [this.makeAction("open_url", opened.url || officialFallback.webUrl)],
        provider: opened.openMode || "assistant-browser",
        details: {
          missingApp: true,
          appName: label,
          recovery: "web",
          officialWebUrl: officialFallback.webUrl,
          title: opened.title || "",
          url: opened.url || officialFallback.webUrl
        }
      };
    }

    if (choice === "commands" && officialFallback?.kind === "cli") {
      return {
        reply: this.buildCliFallbackReply(input, requestedApp, officialFallback),
        actions: [this.makeAction("app_missing", label, "needs-install")],
        provider: "local-clarify",
        details: {
          missingApp: true,
          appName: label,
          recovery: "commands",
          installCommands: officialFallback.installCommands || [],
          runCommands: officialFallback.runCommands || []
        }
      };
    }

    if (choice === "install") {
      const targetUrl = officialFallback?.installUrl || `${requestedApp} 공식 사이트 다운로드`;
      const opened = await this.openBrowserTargetForUser(targetUrl, {
        preferAssistant: true
      });

      return {
        reply:
          language === "ko"
            ? `${label} 앱은 로컬에 없어서 공식 설치 경로를 Playwright 브라우저로 열었어요.${officialFallback?.kind === "cli" ? "\n\n" + this.buildCliFallbackReply(input, requestedApp, officialFallback) : ""}`
            : `${label} is not installed locally, so I opened the official install route in the Playwright browser.${officialFallback?.kind === "cli" ? "\n\n" + this.buildCliFallbackReply(input, requestedApp, officialFallback) : ""}`,
        actions: [this.makeAction("open_url", opened.url || targetUrl)],
        provider: opened.openMode || "assistant-browser",
        details: {
          missingApp: true,
          appName: label,
          recovery: "install",
          installUrl: officialFallback?.installUrl || "",
          title: opened.title || "",
          url: opened.url || targetUrl,
          installCommands: officialFallback?.installCommands || [],
          runCommands: officialFallback?.runCommands || []
        }
      };
    }

    return this.beginClarification(
      input,
      {
        ...route,
        route: "app_open",
        appName: requestedApp
      },
      this.buildMissingAppRecoveryQuestion(input, requestedApp, officialFallback),
      {
        field: "appRecoveryChoice",
        kind: "app_missing_recovery",
        language,
        recovery: officialFallback
          ? {
              appName: label,
              webRunnable: Boolean(officialFallback.webRunnable),
              webUrl: officialFallback.webUrl || "",
              installUrl: officialFallback.installUrl || "",
              kind: officialFallback.kind || "app"
            }
          : {
              appName: requestedApp,
              webRunnable: false
            }
      }
    );
  }

  async beginPendingBrowserContinuation(input, plan) {
    const language = detectReplyLanguage(input);
    const site = cleanupParsedText(plan?.login?.site || guessSiteName(input) || "");
    const fallbackTarget = buildExternalBrowserTarget(plan?.steps?.[0] || {});
    const targetUrl = buildDirectSiteUrl(site) || fallbackTarget || normalizeBrowserOpenUrl(site || input);
    const opened = await this.openBrowserTargetForUser(targetUrl);
    const siteLabel =
      inferFriendlyBrowserLabel(site || opened.title || targetUrl, language) ||
      (language === "ko" ? "사이트" : "the site");

    this.pendingBrowserContinuation = {
      originalInput: input,
      language,
      site: siteLabel,
      targetUrl: opened.url || targetUrl,
      steps: Array.isArray(plan?.steps) ? plan.steps : []
    };

    return {
      reply:
        language === "ko"
          ? `${siteLabel} 로그인 화면을 열어뒀어요. 거기서 로그인만 마치고 "계속"이라고 말해 주세요. 이어서 제가 나머지 작업을 처리할게요.`
          : `I opened ${siteLabel} so you can finish the login there. Once you're in, say "continue" and I will handle the rest.`,
      actions: [this.makeAction("open_url", opened.url || targetUrl)],
      provider: opened.openMode,
      details: {
        title: opened.title || "",
        url: opened.url || targetUrl,
        openMode: opened.openMode,
        pendingBrowserContinuation: true,
        site: siteLabel
      }
    };
  }

  async completeBrowserPlan(input, data) {
    const language = detectReplyLanguage(input);
    const finalPage = data.final || {};
    const actions = data.steps.map((step) =>
      this.makeAction(
        `browser_${step.action}`,
        step.target || step.text || step.query || `result-${step.index || 1}`
      )
    );
    const actionNames = data.steps.map((step) => step.action).join(" -> ");
    const notices = detectBrowserSpecialCases(finalPage);
    const details = {
      title: finalPage.title || "",
      url: finalPage.url || "",
      text: finalPage.text || "",
      executedSteps: data.steps.map((step) => ({
        action: step.action,
        target: step.target || step.text || step.query || step.index || "",
        url: step.result?.url || ""
      })),
      actionNames,
      notices
    };
    const fallback = appendBrowserNotices(
      buildCompactBrowserReply(input, data.steps, finalPage),
      notices,
      language
    );
    const needsContentAnswer = browserWorkflowNeedsContentAnswer(input, data.steps, finalPage);

    if (needsContentAnswer) {
      try {
        const reply = await this.replyWithModel(
          input,
          [
            "The user asked you to interpret the result of a browser workflow.",
            `Reply only in ${buildLanguageName(language)}.`,
            "Summarize the most relevant result from the final page.",
            "If login or search steps happened, mention them briefly and focus on the outcome.",
            `Browser workflow:\n${JSON.stringify(details.executedSteps, null, 2)}`,
            `Final page title: ${details.title || "(untitled)"}`,
            `Final page URL: ${details.url || "(unknown)"}`,
            `Visible page text:\n${details.text.slice(0, 12000) || "(No readable page text was captured.)"}`
          ].join("\n\n"),
          {
            tier: "complex",
            includeHistory: false
          }
        );

        return {
          reply: appendBrowserNotices(reply, notices, language),
          actions,
          provider: getTierProviderLabel("complex"),
          details
        };
      } catch (_error) {
        return {
          reply: fallback,
          actions,
          provider: "local",
          details
        };
      }
    }

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions,
          details
        },
        fallback
      ),
      actions,
      provider: "local",
      details
    };
  }

  async continuePendingBrowserContinuation(input) {
    if (!this.pendingBrowserContinuation) {
      return null;
    }

    const pending = this.pendingBrowserContinuation;
    const language = pending.language || detectReplyLanguage(input);

    if (this.isCancelResponse(input)) {
      this.pendingBrowserContinuation = null;

      return {
        reply:
          language === "ko"
            ? "알겠습니다. 로그인 대기 중이던 브라우저 작업은 취소할게요."
            : "Understood. I will cancel the pending browser workflow.",
        actions: [],
        provider: "local"
      };
    }

    if (!looksLikeBrowserContinuationResponse(input)) {
      return null;
    }

    this.pendingBrowserContinuation = null;

    if (!pending.steps?.length) {
      return {
        reply:
          language === "ko"
            ? "좋아요. 로그인은 그 창에서 계속 유지될 거예요."
            : "Sounds good. The login should stay available in that browser session.",
        actions: [],
        provider: "local"
      };
    }

    try {
      const data = await this.browser.executePlan(pending.steps);
      const result = await this.completeBrowserPlan(pending.originalInput || input, data);
      result.details = {
        ...(result.details || {}),
        resumedBrowserContinuation: true
      };
      return result;
    } catch (error) {
      this.pendingBrowserContinuation = pending;

      return {
        reply:
          language === "ko"
            ? `아직 로그인이나 페이지 준비가 덜 된 것 같아요. ${error.message} 로그인 완료 후 다시 "계속"이라고 말씀해 주세요.`
            : `It looks like the login or page is not ready yet. ${error.message} Finish the login, then say "continue" again.`,
        actions: [],
        provider: "local",
        details: {
          pendingBrowserContinuation: true,
          error: error.message
        }
      };
    }
  }

  async findAppCandidates(query = "", limit = 4) {
    const normalized = cleanupParsedText(query);

    if (!normalized) {
      return [];
    }

    const result = await this.automation.listInstalledApps({
      query: normalized,
      limit
    }).catch(() => ({
      apps: []
    }));

    return Array.isArray(result.apps) ? result.apps : [];
  }

  async maybeClarifyAppTarget(input, route, requestedApp = "", mode = "open") {
    const language = detectReplyLanguage(input);
    const cleanRequestedApp = cleanupParsedText(requestedApp);

    if (!cleanRequestedApp || refersToCurrentAppContext(cleanRequestedApp)) {
      return this.beginClarification(
        input,
        route,
        language === "ko"
          ? mode === "open"
            ? "어느 앱을 열까요?"
            : "어느 앱에서 그 작업을 할까요?"
          : mode === "open"
            ? "Which app should I open?"
            : "Which app should I do that in?",
        {
          field: "appName",
          kind: mode === "open" ? "app_open_name" : "app_action_name",
          language
        }
      );
    }

    const candidates = await this.findAppCandidates(cleanRequestedApp);
    const genericTokens = new Set([
      "adobe",
      "어도비",
      "office",
      "오피스",
      "browser",
      "브라우저",
      "messenger",
      "메신저",
      "music",
      "음악",
      "player",
      "video",
      "editor",
      "에디터"
    ]);
    const normalized = normalizeEntityToken(cleanRequestedApp);

    if (candidates.length > 1 && (normalized.length <= 2 || genericTokens.has(normalized))) {
      return this.beginClarification(
        input,
        route,
        this.buildClarificationQuestion(
          language,
          language === "ko"
            ? `"${cleanRequestedApp}"라고 하면 어느 앱을 뜻하나요?`
            : `Which app did you mean by "${cleanRequestedApp}"?`,
          candidates
        ),
        {
          field: "appName",
          candidates,
          kind: mode === "open" ? "app_open_candidate" : "app_action_candidate",
          language,
          retryPrompt:
            language === "ko"
              ? "후보 중 어떤 앱인지 다시 말씀해 주세요."
              : "Please tell me which app you mean from the options."
        }
      );
    }

    return null;
  }

  async collectSystemBriefingDetails() {
    const currentContextPromise = this.automation.describeCurrentContext
      ? this.automation.describeCurrentContext().catch(() => ({
          appName: "",
          windowTitle: ""
        }))
      : Promise.resolve({
          appName: "",
          windowTitle: ""
        });
    const browserStatusPromise = this.browser.peekStatus
      ? this.browser.peekStatus().catch(() => ({
          provider: this.browser.getProviderLabel(),
          contextActive: false,
          pageActive: false,
          currentPage: null
        }))
      : Promise.resolve({
          provider: "browser unavailable",
          contextActive: false,
          pageActive: false,
          currentPage: null
        });
    const ttsStatusPromise = this.tts && typeof this.tts.status === "function"
      ? this.tts.status().catch(() => null)
      : Promise.resolve(null);
    const screenSnapshotPromise = this.screen && typeof this.screen.captureAndOcr === "function"
      ? this.screen.captureAndOcr()
          .then((capture) => ({
            available: true,
            imagePath: capture.imagePath,
            text: String(capture.text || "").slice(0, 2000)
          }))
          .catch((error) => ({
            available: false,
            imagePath: "",
            text: "",
            message: error.message
          }))
      : Promise.resolve(null);

    const [currentContext, appCatalog, browserStatus, ttsStatus, workspaceSnapshot, screenSnapshot] = await Promise.all([
      currentContextPromise,
      this.automation.listInstalledApps({
        limit: 12
      }).catch(() => ({
        totalCount: 0,
        apps: []
      })),
      browserStatusPromise,
      ttsStatusPromise,
      this.files.listDirectory(".").catch(() => ({
        path: process.cwd(),
        entries: []
      })),
      screenSnapshotPromise
    ]);

    let obsStatus;

    try {
      const data = await this.obs.status();
      obsStatus = {
        connected: true,
        ...data
      };
    } catch (error) {
      obsStatus = {
        connected: false,
        message: error.message
      };
    }

    return {
      currentContext,
      lastAssistantApp: this.lastActiveApp || "",
      platformCapabilities: this.automation.getCapabilities(),
      installedApps: {
        totalCount: appCatalog.totalCount || 0,
        sample: (appCatalog.apps || []).slice(0, 12)
      },
      browser: browserStatus,
      screen: screenSnapshot,
      obs: obsStatus,
      tts: ttsStatus,
      workspace: {
        path: workspaceSnapshot.path,
        entries: (workspaceSnapshot.entries || []).slice(0, 12)
      },
      recentConversation: this.getRecentHistory(6)
    };
  }

  async handleSystemBriefing(input) {
    const language = detectReplyLanguage(input);
    const details = await this.collectSystemBriefingDetails();
    const actions = [
      this.makeAction("system_briefing", "computer")
    ];
    let reply = "";

    try {
      reply = await this.replyWithModel(
        input,
        [
          "The user asked for a direct briefing about the current computer state.",
          `Reply only in ${buildLanguageName(language)}.`,
          "Summarize the most relevant current app context, browser state, OBS state, workspace snapshot, and notable limitations.",
          "Be concrete and practical. If something is unavailable, say that plainly.",
          `System snapshot:\n${JSON.stringify(details, null, 2)}`
        ].join("\n\n"),
        {
          tier: "complex",
          includeHistory: false
        }
      );
    } catch (_error) {
      const frontApp = details.currentContext?.appName || (language === "ko" ? "확인되지 않음" : "not detected");
      const browserSummary = details.browser?.currentPage?.title || details.browser?.provider || "browser unavailable";
      const obsSummary = details.obs?.connected
        ? details.obs.currentScene || "connected"
        : details.obs?.message || "not connected";
      const appCount = details.installedApps?.totalCount || 0;

      reply = language === "ko"
        ? `지금 기준으로 앞에 떠 있는 앱은 ${frontApp} 쪽으로 보이고, 브라우저 상태는 ${browserSummary}, OBS는 ${obsSummary} 상태예요. 설치 앱 카탈로그는 ${appCount}개 정도 확인 가능하고, 작업 폴더도 같이 읽을 수 있어요.`
        : `Right now the frontmost app appears to be ${frontApp}, the browser state is ${browserSummary}, and OBS is ${obsSummary}. I can also see an app catalog of about ${appCount} installed apps and inspect the current workspace.`;
    }

    return {
      reply,
      actions,
      provider: getTierProviderLabel("complex"),
      details
    };
  }

  async executeRoute(cleanInput, route) {
    // 사용자의 입력 의도(Route)에 따라 적절한 핸들러를 호출합니다.
    switch (route.route) {
      case "system_briefing":
        return this.handleSystemBriefing(cleanInput);
      case "screen_academic":
        return this.handleScreenAcademic(cleanInput);
      case "screen_summary":
        return this.handleScreenSummary(cleanInput);
      case "browser_login":
        return this.handleBrowserLogin(cleanInput, route);
      case "browser":
        return this.handleAutonomousTask(cleanInput, route);
      case "open_targets":
        return this.handleOpenTargets(cleanInput, route);
      case "app_action":
        return this.handleAutonomousTask(cleanInput, route);
      case "code_project":
        return this.handleCodeProject(cleanInput, route);
      case "game_install":
      case "game_list":
      case "game_update":
        return this.handleGameRoute(cleanInput, route);
      case "obs_connect":
      case "obs_status":
      case "obs_start":
      case "obs_stop":
      case "obs_scene":
        return this.handleObsRoute(cleanInput, route);
      case "file_read":
      case "file_write":
      case "file_list":
        return this.handleFileRoute(cleanInput, route);
      case "stream_prep":
        return this.handleStreamPrep(cleanInput);
      case "app_open":
        return this.handleAppOpen(cleanInput, route);
      case "app_list":
        return this.handleAppList(cleanInput);
      case "spotify_play":
        return this.handleSpotifyRoute(cleanInput, route);
      case "chat":
      default:
        return this.handleGeneral(cleanInput);
    }
  }

  rememberTurn(role, content) {
    const clean = normalizeWhitespace(content);

    if (!clean) {
      return;
    }

    this.history.push({
      role,
      content: clean
    });

    if (this.history.length > 12) {
      this.history = this.history.slice(-12);
    }
  }

  getRecentHistory(limit = 8) {
    return this.history.slice(-limit);
  }

  buildHistorySnippet(limit = 6) {
    const recent = this.getRecentHistory(limit);

    if (!recent.length) {
      return "No previous conversation.";
    }

    return recent
      .map((entry) => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.content}`)
      .join("\n");
  }

  rememberAppContext(appName = "") {
    if (!appName) {
      return;
    }

    this.lastActiveApp = appName;
  }

  buildLongTermMemorySnippet() {
    if (!this.memory || typeof this.memory.formatForPrompt !== "function") {
      return "";
    }

    return String(this.memory.formatForPrompt() || "").trim();
  }

  async rememberLongTermMemory(userText = "", assistantText = "") {
    if (!this.memory || typeof this.memory.merge !== "function") {
      return;
    }

    const cleanUser = normalizeWhitespace(userText);
    const cleanAssistant = normalizeWhitespace(assistantText);

    if (!looksPotentiallyMemorableConversation(cleanUser, cleanAssistant)) {
      return;
    }

    const fingerprint = `${cleanUser}\n${cleanAssistant}`.slice(0, 800);

    if (!fingerprint || fingerprint === this.lastMemoryFingerprint) {
      return;
    }

    this.lastMemoryFingerprint = fingerprint;

    try {
      const raw = await chat({
        systemPrompt: LONG_TERM_MEMORY_SYSTEM_PROMPT,
        tier: "fast",
        localOnly: true,
        model: FAST_PLANNER_MODEL,
        history: [],
        userPrompt: [
          "Conversation to analyze for long-term memory:",
          `User: ${cleanUser}`,
          `Assistant: ${cleanAssistant || "(none)"}`
        ].join("\n")
      });
      const parsed = safeJsonParse(raw);

      if (!hasLongTermMemoryContent(parsed)) {
        return;
      }

      await this.memory.merge(parsed);
    } catch (_error) {
      // Ignore memory extraction failures so the main request is never blocked.
    }
  }

  buildWorkspacePrompt(language, pending = {}) {
    const appName = pending.appName || "Discord";

    if (!pending.target && !pending.message) {
      return language === "ko"
        ? `${appName}에서 누구에게 어떤 메시지를 보낼까요? 예: w한테 "하이" 보내줘`
        : `Who should I message in ${appName}, and what should I send? Example: send "hi" to w`;
    }

    if (!pending.target) {
      return language === "ko"
        ? `${appName}에서 누구에게 보낼까요?`
        : `Who should I send that to in ${appName}?`;
    }

    return language === "ko"
      ? `${appName}에서 ${pending.target}에게 보낼 내용을 말씀해 주세요.`
      : `What message should I send to ${pending.target} in ${appName}?`;
  }

  buildWorkspaceReadReply(language, data = {}) {
    const appName = data.appName || "Discord";
    const title = cleanupParsedText(String(data.conversationTitle || "").replace(/^@/, ""));
    const messages = Array.isArray(data.messages) ? data.messages.filter((entry) => entry?.author && entry?.text) : [];

    if (!data.isDirectMessage) {
      return language === "ko"
        ? `${appName} 현재 창이 1:1 DM이 아니라서 읽지 않았어요. Discord에서 개인 DM을 열어두면 그 내용은 읽어드릴 수 있어요.`
        : `The current ${appName} window is not a one-on-one DM, so I did not read it. If you open a direct message, I can read what is visible there.`;
    }

    if (!messages.length) {
      return language === "ko"
        ? `${appName} 현재 화면에서 읽을 만한 DM 내용을 찾지 못했어요. 개인 DM을 화면에 보이게 한 뒤 다시 요청해 주세요.`
        : `I could not find readable DM content on the current ${appName} screen. Open the direct message on screen and ask again.`;
    }

    const preview = messages
      .slice(-3)
      .map((entry) => `${entry.author}: ${entry.text}`)
      .join(" / ");

    return language === "ko"
      ? `${appName} 현재 1:1 DM은 ${title || messages[messages.length - 1]?.author || "상대"} 쪽으로 보여요. 최근 보이는 내용은 ${preview}`
      : `The current one-on-one ${appName} DM appears to be with ${title || messages[messages.length - 1]?.author || "that person"}. The recent visible messages are ${preview}`;
  }

  async continuePendingWorkspaceMessage(input) {
    if (!this.pendingWorkspaceMessage) {
      return null;
    }

    const inputLooksLikeSlotOnly = !/(보내|send|message|메시지|reply|답장|취소|cancel|열어|open|이동|switch)/i.test(
      normalizePlanText(input)
    );
    const language = inputLooksLikeSlotOnly
      ? this.pendingWorkspaceMessage.language || detectReplyLanguage(input)
      : detectReplyLanguage(input);
    const parsed = parseWorkspaceSkill(input);
    const followUp = parsed?.intent === "send_message"
      ? {
        target: parsed.target || "",
        message: parsed.message || ""
      }
      : parseWorkspaceFollowUp(input);

    if (followUp?.cancel) {
      const appName = this.pendingWorkspaceMessage.appName || "Discord";
      this.pendingWorkspaceMessage = null;

      return {
        reply: language === "ko"
          ? `${appName} 메시지 보내기를 취소했어요.`
          : `I cancelled the ${appName} message draft.`,
        actions: [],
        provider: "local"
      };
    }

    const appName = detectWorkspaceAppName(input) || this.pendingWorkspaceMessage.appName || "Discord";
    let target = cleanupWorkspaceTarget(this.pendingWorkspaceMessage.target || "");
    let message = cleanupParsedText(this.pendingWorkspaceMessage.message || "");

    if (followUp?.target) {
      target = cleanupWorkspaceTarget(followUp.target);
    }

    if (followUp?.message) {
      message = cleanupParsedText(followUp.message);
    }

    if (!followUp && !target && message) {
      target = cleanupWorkspaceTarget(input);
    } else if (!followUp && target && !message) {
      message = cleanupParsedText(input);
    } else if (!followUp && !target && !message) {
      message = cleanupParsedText(input);
    }

    if (!target || !message) {
      this.pendingWorkspaceMessage = {
        appName,
        target,
        message,
        language
      };

      return {
        reply: this.buildWorkspacePrompt(language, this.pendingWorkspaceMessage),
        actions: [],
        provider: "local"
      };
    }

    const data = await this.automation.execute({
      type: "workspace_send_message",
      targetApp: appName,
      destination: target,
      message
    });
    this.pendingWorkspaceMessage = null;
    this.rememberAppContext(appName);

    return this.completeLocalCommand(
      input,
      [this.makeAction("workspace_send_message", `${appName}:${target}:${message}`)],
      {
        appName,
        mode: "send_message",
        target,
        message,
        lastResult: data
      },
      language === "ko"
        ? `${appName}에서 ${target}에게 메시지를 보냈어요.`
        : `I sent the message to ${target} in ${appName}.`
    );
  }

  async resolveAppContext(input, route = {}, options = {}) {
    const allowDirect = options.allowDirect !== false;
    const candidates = [
      this.normalizeRequestedAppName(route.appName),
      detectWorkspaceAppName(input),
      refersToCurrentAppContext(input) && options.allowLastActive !== false ? this.lastActiveApp : "",
      extractAppActionTarget(input),
      extractAppName(input),
      options.allowLastActive === false ? "" : this.lastActiveApp
    ].filter(Boolean);
    const uniqueCandidates = [...new Set(
      candidates
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .flatMap((item) => {
          const normalized = this.normalizeRequestedAppName(item);
          return normalized && normalized !== item ? [item, normalized] : [item];
        })
    )];

    for (const candidate of uniqueCandidates) {
      const resolved = await this.automation.resolveAppTarget(candidate, {
        allowDirect: false
      });

      if (resolved) {
        return resolved;
      }
    }

    if (uniqueCandidates[0] && allowDirect) {
      return this.automation.resolveAppTarget(uniqueCandidates[0], {
        allowDirect: true
      });
    }

    return null;
  }

  async tryHandleSpecializedAppAction(input, route, appName) {
    const skill = getSpecializedAppSkill(appName);

    if (skill === "spotify") {
      return this.handleSpotifySkill(input, route, appName);
    }

    if (skill === "finder") {
      return this.handleFinderSkill(input, appName);
    }

    if (skill === "notes") {
      return this.handleNotesSkill(input, appName);
    }

    if (skill === "chrome") {
      return this.handleChromeSkill(input, appName);
    }

    if (skill === "slack" || skill === "discord") {
      return this.handleWorkspaceSkill(input, appName);
    }

    return null;
  }

  async handleSpotifySkill(input, route = {}, appName = "Spotify") {
    const parsed = parseSpotifySkill(input, route);
    const actions = [];
    const opened = await this.automation.execute({
      type: "open_app",
      target: appName
    });
    const resolvedName = opened.resolvedTarget || opened.appName || appName;

    actions.push(this.makeAction("open_app", resolvedName));
    this.rememberAppContext(resolvedName);

    if (parsed.intent === "search" && parsed.query) {
      const spotifyTargets = buildSpotifyTargets(parsed.query);
      let mode = "search";

      try {
        await this.automation.execute({
          type: "open_url",
          target: spotifyTargets.uri
        });
        actions.push(this.makeAction("open_url", spotifyTargets.uri));
      } catch (_error) {
        await this.automation.execute({
          type: "open_url",
          target: spotifyTargets.webUrl
        });
        actions.push(this.makeAction("open_url", spotifyTargets.webUrl));
        mode = "web-search";
      }

      const fallback =
        detectReplyLanguage(input) === "ko"
          ? `${resolvedName}에서 ${parsed.query} 검색 결과를 열어뒀어요. 바로 재생할 대상을 고를 수 있어요.`
          : `I opened ${resolvedName} results for ${parsed.query}.`;

      return this.completeLocalCommand(
        input,
        actions,
        {
          appName: resolvedName,
          mode,
          query: parsed.query,
          spotifyTargets
        },
        fallback
      );
    }

    if (parsed.intent === "next" || parsed.intent === "previous" || parsed.intent === "pause" || parsed.intent === "resume") {
      const commandMap = {
        next: "next",
        previous: "previous",
        pause: "pause",
        resume: "resume"
      };

      const data = await this.automation.execute({
        type: "spotify_control",
        command: commandMap[parsed.intent]
      });
      actions.push(this.makeAction("spotify_control", `${resolvedName}:${commandMap[parsed.intent]}`));

      const fallback =
        detectReplyLanguage(input) === "ko"
          ? parsed.intent === "next"
            ? `${resolvedName}에서 다음 곡으로 넘겼어요.`
            : parsed.intent === "previous"
              ? `${resolvedName}에서 이전 곡으로 이동했어요.`
              : parsed.intent === "pause"
                ? `${resolvedName} 재생을 멈췄어요.`
                : `${resolvedName} 재생을 이어봤어요.`
          : parsed.intent === "next"
            ? `I skipped to the next track in ${resolvedName}.`
            : parsed.intent === "previous"
              ? `I moved to the previous track in ${resolvedName}.`
              : parsed.intent === "pause"
                ? `I paused ${resolvedName}.`
                : `I resumed playback in ${resolvedName}.`;

      return this.completeLocalCommand(
        input,
        actions,
        {
          appName: resolvedName,
          mode: parsed.intent,
          lastResult: data
        },
        fallback
      );
    }

    return this.completeLocalCommand(
      input,
      actions,
      {
        appName: resolvedName,
        mode: "opened"
      },
      detectReplyLanguage(input) === "ko"
        ? `${resolvedName}를 앞으로 가져왔어요. 곡 검색이나 재생 제어를 바로 이어서 할 수 있어요.`
        : `I brought ${resolvedName} to the front. I can search or control playback there next.`
    );
  }

  async handleFinderSkill(input, appName = "Finder") {
    const parsed = parseFinderSkill(input);

    if (!parsed) {
      return null;
    }

    let data;
    let actions;
    let fallback;

    if (parsed.intent === "search") {
      data = await this.automation.execute({
        type: "finder_search",
        query: parsed.query
      });
      actions = [this.makeAction("finder_search", parsed.query)];
      fallback =
        detectReplyLanguage(input) === "ko"
          ? `Finder에서 ${parsed.query} 검색을 시작했어요.`
          : `I started a Finder search for ${parsed.query}.`;
    } else if (parsed.intent === "new_window") {
      data = await this.automation.execute({
        type: "finder_new_window",
        target: parsed.location || ""
      });
      actions = [
        this.makeAction("finder_new_window", parsed.location || "default")
      ];
      fallback =
        detectReplyLanguage(input) === "ko"
          ? parsed.location
            ? `Finder에서 ${parsed.location} 위치를 새 창으로 열었어요.`
            : "Finder 새 창을 열었어요."
          : parsed.location
            ? `I opened ${parsed.location} in a new Finder window.`
            : "I opened a new Finder window.";
    } else {
      data = await this.automation.execute({
        type: "finder_open_path",
        target: parsed.location
      });
      actions = [this.makeAction("finder_open_path", parsed.location)];
      fallback =
        detectReplyLanguage(input) === "ko"
          ? `Finder에서 ${parsed.location} 위치를 열었어요.`
          : `I opened ${parsed.location} in Finder.`;
    }

    this.rememberAppContext(appName);
    return this.completeLocalCommand(
      input,
      actions,
      {
        appName,
        mode: parsed.intent,
        lastResult: data
      },
      fallback
    );
  }

  async handleNotesSkill(input, appName = "Notes") {
    const parsed = parseNotesSkill(input);

    if (!parsed) {
      return null;
    }

    if (parsed.intent === "search") {
      const data = await this.automation.execute({
        type: "notes_search",
        query: parsed.query
      });
      this.rememberAppContext(appName);
      return this.completeLocalCommand(
        input,
        [this.makeAction("notes_search", parsed.query)],
        {
          appName,
          mode: "search",
          lastResult: data
        },
        detectReplyLanguage(input) === "ko"
          ? `Notes에서 ${parsed.query} 검색을 열어뒀어요.`
          : `I opened a Notes search for ${parsed.query}.`
      );
    }

    const data = await this.automation.execute({
      type: "notes_create_note",
      title: parsed.title || "",
      body: parsed.body || ""
    });
    this.rememberAppContext(appName);

    return this.completeLocalCommand(
      input,
      [this.makeAction("notes_create_note", parsed.title || parsed.body || "untitled")],
      {
        appName,
        mode: "create",
        title: parsed.title || "",
        body: parsed.body || "",
        lastResult: data
      },
      detectReplyLanguage(input) === "ko"
        ? parsed.title
          ? `Notes에 ${parsed.title} 노트를 만들어뒀어요.`
          : "Notes에 새 노트를 만들어뒀어요."
        : parsed.title
          ? `I created the note ${parsed.title} in Notes.`
          : "I created a new note in Notes."
    );
  }

  async handleChromeSkill(input, appName = "Google Chrome") {
    const parsed = parseChromeSkill(input);

    if (!parsed) {
      return null;
    }

    if (parsed.intent === "navigate") {
      const data = await this.automation.execute({
        type: "chrome_navigate",
        target: parsed.target,
        newTab: Boolean(parsed.newTab)
      });
      this.rememberAppContext(appName);
      return this.completeLocalCommand(
        input,
        [this.makeAction("chrome_navigate", `${parsed.newTab ? "new-tab:" : ""}${parsed.target}`)],
        {
          appName,
          mode: "navigate",
          target: parsed.target,
          newTab: Boolean(parsed.newTab),
          lastResult: data
        },
        detectReplyLanguage(input) === "ko"
          ? `${appName}에서 ${parsed.target} 쪽으로 이동했어요.`
          : `I navigated ${appName} to ${parsed.target}.`
      );
    }

    const shortcutMap = {
      new_tab: {
        key: "t",
        modifiers: ["command"]
      },
      back: {
        key: "[",
        modifiers: ["command"]
      },
      forward: {
        key: "]",
        modifiers: ["command"]
      },
      refresh: {
        key: "r",
        modifiers: ["command"]
      }
    };
    const shortcut = shortcutMap[parsed.intent];

    if (!shortcut) {
      return null;
    }

    const data = await this.automation.execute({
      type: "app_shortcut",
      target: appName,
      key: shortcut.key,
      modifiers: shortcut.modifiers
    });
    this.rememberAppContext(appName);

    return this.completeLocalCommand(
      input,
      [this.makeAction("app_shortcut", `${appName}:${shortcut.modifiers.join("+")}+${shortcut.key}`)],
      {
        appName,
        mode: parsed.intent,
        lastResult: data
      },
      detectReplyLanguage(input) === "ko"
        ? parsed.intent === "new_tab"
          ? `${appName} 새 탭을 열었어요.`
          : parsed.intent === "back"
            ? `${appName}에서 뒤로 이동했어요.`
            : parsed.intent === "forward"
              ? `${appName}에서 앞으로 이동했어요.`
              : `${appName}를 새로고침했어요.`
        : parsed.intent === "new_tab"
          ? `I opened a new tab in ${appName}.`
          : parsed.intent === "back"
            ? `I went back in ${appName}.`
            : parsed.intent === "forward"
              ? `I went forward in ${appName}.`
              : `I refreshed ${appName}.`
    );
  }

  async handleWorkspaceSkill(input, appName) {
    const parsed = parseWorkspaceSkill(input);

    if (!parsed) {
      return null;
    }

    if (parsed.intent === "compose_message") {
      this.pendingWorkspaceMessage = {
        appName,
        target: "",
        message: "",
        language: detectReplyLanguage(input)
      };
      this.rememberAppContext(appName);

      return {
        reply: this.buildWorkspacePrompt(detectReplyLanguage(input), this.pendingWorkspaceMessage),
        actions: [],
        provider: "local"
      };
    }

    if (parsed.intent === "read_messages") {
      const data = await this.automation.execute({
        type: "workspace_read_messages",
        targetApp: appName
      });
      this.rememberAppContext(appName);

      return {
        reply: this.buildWorkspaceReadReply(detectReplyLanguage(input), data),
        actions: [this.makeAction("workspace_read_messages", appName)],
        provider: "local",
        details: data
      };
    }

    if (parsed.intent === "open_target") {
      const data = await this.automation.execute({
        type: "workspace_switch_target",
        targetApp: appName,
        destination: parsed.target
      });
      this.rememberAppContext(appName);

      return this.completeLocalCommand(
        input,
        [this.makeAction("workspace_switch_target", `${appName}:${parsed.target}`)],
        {
          appName,
          mode: "open_target",
          target: parsed.target,
          lastResult: data
        },
        detectReplyLanguage(input) === "ko"
          ? `${appName}에서 ${parsed.target} 대상으로 이동했어요.`
          : `I switched ${appName} to ${parsed.target}.`
      );
    }

    if (parsed.intent === "send_message" && parsed.message) {
      if (!parsed.target) {
        this.pendingWorkspaceMessage = {
          appName,
          target: "",
          message: parsed.message,
          language: detectReplyLanguage(input)
        };
        this.rememberAppContext(appName);

        return {
          reply: this.buildWorkspacePrompt(detectReplyLanguage(input), this.pendingWorkspaceMessage),
          actions: [],
          provider: "local"
        };
      }

      const data = await this.automation.execute({
        type: "workspace_send_message",
        targetApp: appName,
        destination: parsed.target || "",
        message: parsed.message
      });
      this.rememberAppContext(appName);

      return this.completeLocalCommand(
        input,
        [
          this.makeAction(
            "workspace_send_message",
            `${appName}:${parsed.target || "current"}:${parsed.message}`
          )
        ],
        {
          appName,
          mode: "send_message",
          target: parsed.target || "",
          message: parsed.message,
          lastResult: data
        },
        detectReplyLanguage(input) === "ko"
          ? parsed.target
            ? `${appName}에서 ${parsed.target} 대상으로 메시지를 보냈어요.`
            : `${appName} 현재 대화에 메시지를 보냈어요.`
          : parsed.target
            ? `I sent the message to ${parsed.target} in ${appName}.`
            : `I sent the message in the current ${appName} conversation.`
      );
    }

    return null;
  }

  async handleAppList(input) {
    const data = await this.automation.listInstalledApps({
      limit: 400
    });
    const preview = data.apps.slice(0, 18).map((app) => app.name).join(", ");
    const fallback = detectReplyLanguage(input) === "ko"
      ? `설치된 앱을 ${data.totalCount}개 읽어왔어요. 예를 들면 ${preview}${data.totalCount > data.apps.length ? " 등" : ""}이 있어요.`
      : `I found ${data.totalCount} installed apps. Examples include ${preview}${data.totalCount > data.apps.length ? ", and more." : "."}`;

    return {
      reply: fallback,
      actions: [this.makeAction("app_list", `count:${data.totalCount}`)],
      provider: "local",
      details: data
    };
  }

  async handleOpenTargets(input, route = {}) {
    const targets = route.targets || extractDirectOpenTargets(input) || {};
    const apps = Array.isArray(targets.apps) ? targets.apps : [];
    const web = Array.isArray(targets.web) ? targets.web : [];
    const actions = [];
    const openedLabels = [];
    const usesChrome = apps.some((app) => normalizeEntityToken(app.label) === "googlechrome");

    for (const appTarget of apps) {
      const appName = appTarget.label || appTarget.name;

      if (!appName) {
        continue;
      }

      const data = await this.automation.execute({
        type: "open_app",
        target: appName
      });
      const openedName = data.resolvedTarget || data.appName || appName;
      actions.push(this.makeAction("open_app", openedName));
      openedLabels.push(openedName);
      this.rememberAppContext(openedName);
    }

    for (const [index, webTarget] of web.entries()) {
      const targetUrl = webTarget.url || buildDirectSiteUrl(webTarget.label);

      if (!targetUrl) {
        continue;
      }

      if (usesChrome) {
        try {
          await this.automation.execute({
            type: "chrome_navigate",
            target: targetUrl,
            newTab: index > 0
          });
          actions.push(this.makeAction("chrome_navigate", `${index > 0 ? "new-tab:" : ""}${targetUrl}`));
        } catch (_error) {
          await this.automation.execute({
            type: "open_url",
            target: targetUrl
          });
          actions.push(this.makeAction("open_url", targetUrl));
        }
      } else {
        await this.automation.execute({
          type: "open_url",
          target: targetUrl
        });
        actions.push(this.makeAction("open_url", targetUrl));
      }

      openedLabels.push(webTarget.label || inferFriendlyBrowserLabel(targetUrl, detectReplyLanguage(input)));
    }

    const uniqueLabels = [...new Set(openedLabels.filter(Boolean))];
    const fallback = detectReplyLanguage(input) === "ko"
      ? `${uniqueLabels.join(", ")} 열었어요.`
      : `I opened ${uniqueLabels.join(", ")}.`;

    return this.completeLocalCommand(
      input,
      actions,
      {
        mode: "open_targets",
        apps,
        web
      },
      fallback
    );
  }

  async handleAppAction(input, route) {
    const requestedApp = this.normalizeRequestedAppName(
      route.appName ||
      extractAppActionTarget(input) ||
      (refersToCurrentAppContext(input) ? this.lastActiveApp : "")
    );
    const clarification = await this.maybeClarifyAppTarget(
      input,
      {
        ...route,
        appName: requestedApp
      },
      requestedApp,
      "action"
    );

    if (clarification) {
      return clarification;
    }

    const resolved = await this.resolveAppContext(input, {
      ...route,
      appName: requestedApp
    }, {
      allowDirect: false
    });

    if (!resolved?.resolvedTarget) {
      throw new Error(
        detectReplyLanguage(input) === "ko"
          ? "어떤 앱에서 작업해야 하는지 아직 확실하지 않아요. 앱 이름을 같이 말씀해 주세요."
          : "I am not sure which app you want me to control yet. Please include the app name."
      );
    }

    const appName = resolved.resolvedTarget;
    const specialized = await this.tryHandleSpecializedAppAction(input, route, appName);

    if (specialized) {
      return specialized;
    }

    const appPlan = await this.planAppTask(input, appName);
    const actions = [];
    let lastData = {
      appName
    };

    for (const step of appPlan.steps) {
      if (step.action === "open_url" && step.fallbackTarget) {
        try {
          lastData = await this.automation.execute({
            type: "open_url",
            target: step.target
          });
          actions.push(this.makeAction("open_url", step.target));
        } catch (_error) {
          lastData = await this.automation.execute({
            type: "open_url",
            target: step.fallbackTarget
          });
          actions.push(this.makeAction("open_url", step.fallbackTarget));
        }
        continue;
      }

      lastData = await this.automation.execute({
        type: step.action,
        target: step.target || appName,
        key: step.key,
        text: step.text,
        menuPath: step.menuPath,
        modifiers: step.modifiers
      });

      if (step.action === "open_app") {
        this.rememberAppContext(lastData.resolvedTarget || lastData.appName || appName);
      }

      const targetLabel =
        step.action === "app_menu_click"
          ? `${step.target || appName}:${(step.menuPath || []).join(" > ")}`
          : step.action === "app_shortcut"
            ? `${step.target || appName}:${(step.modifiers || []).join("+")}+${step.key}`
            : step.action === "app_type"
              ? `${step.target || appName}:${step.text || ""}`
              : step.action === "app_key"
                ? `${step.target || appName}:${step.key || ""}`
                : step.target || appName;

      actions.push(this.makeAction(step.action, targetLabel));
    }

    const fallback = detectReplyLanguage(input) === "ko"
      ? actions.length > 1
        ? `${appName}에서 요청한 동작을 실행했어요.`
        : `${appName}를 앞으로 가져왔어요.`
      : actions.length > 1
        ? `I carried out the action inside ${appName}.`
        : `I brought ${appName} to the front.`;

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions,
          details: {
            appName,
            plannedSteps: appPlan.steps,
            lastResult: lastData
          }
        },
        fallback
      ),
      actions,
      provider: "local",
      details: {
        appName,
        plannedSteps: appPlan.steps,
        lastResult: lastData
      }
    };
  }

  async replyWithModel(userPrompt, extraContext = "", options = {}) {
    const includeHistory = options.includeHistory !== false;
    const memorySnippet = options.includeMemory === false ? "" : this.buildLongTermMemorySnippet();
    const contextBlocks = [];

    if (memorySnippet) {
      contextBlocks.push(`Known long-term user context:\n${memorySnippet}`);
    }

    if (extraContext) {
      contextBlocks.push(extraContext);
    }

    const finalUserPrompt = contextBlocks.length
      ? `${contextBlocks.join("\n\n")}\n\nUser request:\n${userPrompt}`
      : userPrompt;

    return chat({
      systemPrompt: options.systemPrompt || buildBasePrompt(),
      tier: options.tier || "complex",
      provider: options.provider,
      model: options.model,
      url: options.url,
      apiKey: options.apiKey,
      localOnly: options.localOnly,
      history: includeHistory ? this.getRecentHistory() : [],
      userPrompt: finalUserPrompt
    });
  }

  async routeInput(input) {
    const fallback = buildRouteFallback(input);
    if (shouldUseFallbackRouteDirectly(input, fallback)) {
      return fallback;
    }
    const appCatalog = this.automation?.listInstalledApps
      ? await this.automation.listInstalledApps({
          limit: 80
        }).catch(() => ({
          apps: []
        }))
      : {
          apps: []
        };
    const installedAppNames = Array.isArray(appCatalog?.apps)
      ? appCatalog.apps.map((app) => app.name).filter(Boolean).slice(0, 80)
      : [];
    const routerPrompt = [
      "You are the intent router for a bilingual desktop assistant.",
      "Respond with valid JSON only.",
      'Schema: {"route":"chat|browser|browser_login|screen_summary|screen_academic|system_briefing|obs_connect|obs_status|obs_start|obs_stop|obs_scene|file_read|file_write|file_list|stream_prep|app_open|app_action|app_list|open_targets|spotify_play|game_install|game_update|game_list|code_project","language":"ko|en","appName":"","siteOrUrl":"","path":"","content":"","sceneName":"","query":"","platform":"steam|epic|both","targets":{"apps":[],"web":[]},"reason":"","confidence":0,"missing":[],"requires_automation":false}',
      "Use chat for general conversation, recommendations, ideas, opinions, follow-up discussion, or questions that do not clearly require a desktop action.",
      "Use app_open for opening a local desktop app like Chrome, Finder, Terminal, Slack, Spotify, Notion, Steam, OBS, or VS Code.",
      "For app_open, appName must contain only the app/product name. Never include request verbs, politeness endings, punctuation, or the full user sentence.",
      "Use app_action when the user wants to do something inside a desktop app, such as typing, sending a message in Slack or Discord, pressing a key, running a shortcut, searching, opening a folder or tab, creating a new item, using a menu, or performing a multi-step workflow inside that app.",
      "Use open_targets when the user asks to open multiple local apps or a local app plus one or more websites in the same request. Fill targets.apps with app names and targets.web with URLs or site names.",
      "Use app_list when the user asks to list installed or available desktop apps.",
      "Use spotify_play when the user wants Spotify to play, pause, resume, skip, search, or open a playlist, song, or music request inside Spotify.",
      "Use game_install, game_update, and game_list for Steam or Epic game management requests.",
      "Use code_project when the user asks you to create a coding project, generate an app, scaffold a prototype, or build something like a snake game or todo app.",
      "Use browser for website navigation, URLs, searches, web logins, reading web pages, or multi-step site workflows like open site, log in, search, and show activity.",
      "Use browser_login only for explicit login requests.",
      "Set requires_automation to true ONLY if the user request requires you to read the screen, log in, click buttons, summarize, or perform multi-step workflows. Set to false if they just want to open a page or do a simple search.",
      "When the user names a specific app or website, prioritize that named target over generic nouns like music, song, video, message, or search.",
      "Do not route recommendation-style questions into desktop actions unless the user clearly asks you to play, open, search, or control something.",
      "Use system_briefing when the user asks what is happening on this computer, the current machine status, frontmost app, browser state, or a direct system overview.",
      "Use screen_summary for OCR or screen understanding.",
      "Use screen_academic for tutoring, explanation, grammar correction, or study help about the current screen.",
      "Use obs_* only for OBS connection, status, stream control, or scene switching.",
      "Use file_* only for local file tasks.",
      "If unsure, return chat.",
      "language must be ko if the user is mainly speaking Korean, otherwise en.",
      installedAppNames.length
        ? `Installed app hints: ${installedAppNames.join(", ")}`
        : "Installed app hints are unavailable; infer common app names when the user clearly names one."
    ].join(" ");

    try {
      const raw = await chat({
        systemPrompt: routerPrompt,
        tier: "fast",
        userPrompt: [
          "Recent conversation:",
          this.buildHistorySnippet(),
          "",
          "Weak local fallback route, for reference only. Prefer your own semantic judgment:",
          JSON.stringify(fallback),
          "",
          "Current user input:",
          input
        ].join("\n")
      });

      const parsed = safeJsonParse(raw);

      if (!parsed?.route) {
        return fallback;
      }

      if (fallback.route !== "chat" && parsed.route === "chat") {
        return fallback;
      }

      return {
        ...fallback,
        ...parsed,
        targets: parsed.targets || fallback.targets,
        appName: parsed.appName || fallback.appName || "",
        language: parsed.language === "ko" ? "ko" : fallback.language,
        requires_automation: parsed.requires_automation === true
      };
    } catch (_error) {
      return fallback;
    }
  }

  // ─── v2 ReAct Loop Constants ──────────────────────────────────────────────

  static REACT_MAX_STEPS = 15;

  static REACT_AGENT_SYSTEM_PROMPT = [
    "당신은 자율형 컴퓨터 에이전트 Jarvis입니다. 브라우저(Headless)와 OS 접근성 권한을 사용하여 컴퓨터를 제어합니다.",
    "한 번에 하나의 행동(Action)만 수행하며, 각 행동 후에는 새로운 상태(DOM 요소 또는 OS 컨텍스트)를 전달받습니다.",
    "사용자의 현재 화면을 방해하지 않고 백그라운드(Headless)에서 작업을 완료하는 것을 목표로 합니다.",
    "이 브라우저 작업은 기존 대화의 연장입니다. 최근 대화, 사용자 의도, 로컬 폴백 상태를 새 세션처럼 잊지 말고 유지하세요.",
    "앱이나 CLI 도구가 로컬에 없으면 없다고 말하고, 공식 웹 앱 실행 가능성 또는 공식 설치 문서/명령을 우선 판단하세요.",
    "OpenClaw 관련 요청은 공식 GitHub/문서 흐름 기준으로 Node.js 22+, npm 또는 source 설치, onboard, doctor/status/dashboard 실행이 필요하다고 판단하세요.",
    "",
    "사용 가능한 행동 (JSON 형식으로만 응답):",
    '  {"action":"navigate","url":"https://..."} — 특정 URL로 이동 (Headless)',
    '  {"action":"click","element_id":3,"reason":"..."} — ID를 기반으로 웹 요소 클릭',
    '  {"action":"type","element_id":5,"text":"...","reason":"..."} — 웹 요소에 텍스트 입력',
    '  {"action":"press_key","key":"Enter","reason":"..."} — 키보드 키 입력',
    '  {"action":"scroll","direction":"down","reason":"..."} — 페이지 스크롤',
    '  {"action":"wait","reason":"..."} — 페이지 로딩 대기',
    '  {"action":"ask_pii","field":"password","reason":"..."} — 비밀번호 등 민감한 정보는 추측하지 말고 사용자에게 요청',
    '  {"action":"os_type","text":"...","reason":"..."} — OS 접근성 권한을 사용해 텍스트 직접 입력',
    '  {"action":"os_app","name":"Safari","reason":"..."} — OS 애플리케이션 실행 또는 포커스',
    '  {"action":"os_click","x":100,"y":200,"reason":"..."} — 지정된 OS 화면 좌표 클릭',
    '  {"action":"os_cmd","command":"...","reason":"..."} — OS 쉘 명령어 실행',
    '  {"action":"done","summary":"..."} — 작업 완료 및 요약 제공',
    "",
    "규칙:",
    "1. 한 번에 딱 하나의 JSON 행동만 응답하세요.",
    "2. 항상 'reason' 필드를 포함하여 이유를 설명하세요.",
    "3. 가능하면 실제 화면 조작보다 백그라운드/Headless 동작을 우선시하세요.",
    "4. 절대 비밀번호를 추측하지 마세요. ask_pii를 사용하여 보안 저장소에서 정보를 가져오도록 요청하세요.",
    "5. 목표가 달성되면 'done'을 사용하세요."
  ].join("\n");

  /**
   * v2: Resolve the initial URL to navigate to based on user intent (heuristic).
   * This replaces the old planBrowserTask for the initial navigation step only.
   */
  resolveInitialBrowserUrl(input) {
    const normalized = normalizePlanText(input);

    // Explicit URL in input
    const explicitUrl = extractUrl(normalized);
    if (explicitUrl) {
      return /^https?:\/\//i.test(explicitUrl) ? explicitUrl : `https://${explicitUrl}`;
    }

    // YouTube request
    if (looksLikeYouTubePlaybackRequest(normalized) || /(유튜브|youtube)/i.test(normalized)) {
      const query = extractYouTubePlaybackQuery(normalized);
      if (query) return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      return "https://www.youtube.com/";
    }

    // Known site
    const siteName = guessSiteName(normalized);
    const knownUrl = getKnownSiteUrl(siteName);
    if (knownUrl) return knownUrl;

    // Direct site URL
    const directUrl = buildDirectSiteUrl(siteName || normalized);
    if (directUrl) return directUrl;

    // Fallback: Google search
    const query = stripCommandPrefix(normalized) || normalized;
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }

  /**
   * Format DOM-tagged elements into a compact text table for the AI.
   */
  formatElementsForAI(elements = []) {
    if (!elements.length) return "(No interactive elements found on page)";
    return elements.map(el => {
      const parts = [`[${el.id}]`, el.tag];
      if (el.type) parts.push(`type=${el.type}`);
      if (el.role) parts.push(`role=${el.role}`);
      if (el.text) parts.push(`"${el.text.slice(0, 60)}"`);
      if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
      if (el.ariaLabel) parts.push(`aria="${el.ariaLabel.slice(0, 40)}"`);
      if (el.href) parts.push(`href=${el.href.slice(0, 60)}`);
      if (el.value) parts.push(`value="${el.value}"`);
      return parts.join(" ");
    }).join("\n");
  }

  /**
   * Build the observation message sent to the AI at each ReAct step.
   */
  async buildReActObservation(state, stepNum, errorMessage = "") {
    const activeApp = await this.automation.getActiveApp();
    const lines = [
      `=== Step ${stepNum} Observation ===`,
      `Active OS App: ${activeApp}`,
    ];

    if (state.url || state.title) {
      lines.push(`URL: ${state.url || "N/A"}`);
      lines.push(`Title: ${state.title || "(untitled)"}`);
    }

    if (state.cmd_output) {
      lines.push(`--- Terminal Output ---`);
      lines.push(state.cmd_output.slice(-2000));
      lines.push(`-----------------------`);
    }

    const notifs = notificationMonitor.getAIContextString();
    if (notifs) {
      lines.push(`--- System Notifications ---\n${notifs}\n---------------------------`);
    }

    if (state.anomalies?.length) {
      lines.push(`⚠️ Detected issues: ${state.anomalies.join(", ")}`);
    }
    if (errorMessage) {
      lines.push(`❌ Previous action failed: ${errorMessage}`);
    }

    lines.push("");
    lines.push(`Interactive elements (${state.elementCount} total):`);
    lines.push(this.formatElementsForAI(state.elements));

    if (state.visibleText) {
      lines.push("");
      lines.push(`Visible page text (truncated):`);
      lines.push(state.visibleText.slice(0, 1500));
    }

    return lines.join("\n");
  }

  /**
   * Safely observe browser state, returning a fallback OS state if browser is not active.
   */
  async safeObserve() {
    try {
      if (this.browser && typeof this.browser.observe === 'function') {
        const state = await this.browser.observe();
        if (state) return state;
      }
    } catch {
      // Browser might not be active, which is fine for OS tasks
    }
    return { url: "", title: "", elements: [], elementCount: 0 };
  }

  /**
   * Execute one ReAct action returned by the AI.
   * Returns: { state, error }
   */
  async executeReActAction(action) {
    try {
      switch (action.action) {
        case "navigate":
          return { state: await this.browser.navigate(action.url), error: null };
        case "click":
          return { state: await this.browser.clickElement(action.element_id), error: null };
        case "type":
          return { state: await this.browser.typeText(action.element_id, action.text), error: null };
        case "press_key":
          return { state: await this.browser.pressKey(action.key || "Enter"), error: null };
        case "scroll":
          return { state: await this.browser.scrollPage(action.direction || "down"), error: null };
        case "wait":
          return { state: await this.browser.waitAndObserve(2000), error: null };
        case "ask_pii":
          // Check if we already have it in PII Manager
          const storedPii = piiManager.get(action.field);
          if (storedPii) {
            return { state: { ...await this.safeObserve(), pii_retrieved: storedPii }, error: null };
          }
          // Otherwise, we would prompt the user. For now, simulate missing PII.
          return { state: await this.safeObserve(), error: `Missing PII for ${action.field}. Please ask user to set it.` };
        case "os_type":
          await this.automation.typeText(action.text);
          return { state: await this.safeObserve(), error: null };
        case "os_app":
          await this.automation.execute({ type: "open_app", target: action.name });
          return { state: await this.safeObserve(), error: null };
        case "os_click":
          await this.automation.clickCoordinate(action.x, action.y);
          return { state: await this.safeObserve(), error: null };
        case "os_cmd":
          const output = await this.automation.runShellCommand(action.command);
          return { state: { ...await this.safeObserve(), cmd_output: output }, error: null };
        case "done":
          return { state: null, error: null };
        default:
          return { state: await this.safeObserve(), error: `Unknown action: ${action.action}` };
      }
    } catch (err) {
      // Self-correcting: return the error to AI so it can adapt
      try {
        const recoveryState = await this.safeObserve();
        return { state: recoveryState, error: err.message };
      } catch {
        return { state: null, error: err.message };
      }
    }
  }

  /**
   * v2 ReAct Loop: The core autonomous OS & browser handler.
   * Replaces the old planBrowserTask & handleAppAction.
   */
  async handleAutonomousTask(input, route = { route: "browser" }) {
    const language = detectReplyLanguage(input);
    const actions = [];
    let state = {};

    if (route.route === "browser") {
      const plan = buildHeuristicBrowserPlan(input);
      const normalizedInput = normalizePlanText(input);

      if (plan?.login?.required && plan.login.mode === "manual") {
        return this.beginPendingBrowserContinuation(input, plan);
      }

      // AI router decides if multi-step reasoning is required
      const isComplexBrowserTask = route.requires_automation === true;

      if (!isComplexBrowserTask && isSimpleExternalBrowserPlan(plan)) {
        const targetUrl = buildExternalBrowserTarget(plan.steps[0]);
        const opened = await this.openBrowserTargetForUser(targetUrl, {
          preferAssistant: shouldUseAssistantBrowserForSimplePlan(input, plan)
        });
        const fallback = buildCompactBrowserReply(
          input,
          plan.steps,
          {
            title: opened.title || "",
            url: opened.url || targetUrl
          }
        );

        return {
          reply: fallback,
          actions: [this.makeAction("open_url", opened.url || targetUrl)],
          provider: opened.openMode,
          details: {
            title: opened.title || "",
            url: opened.url || targetUrl,
            openMode: opened.openMode
          }
        };
      }

      // Step 0: Navigate to initial URL
      const initialUrl = this.resolveInitialBrowserUrl(input);
      try {
        state = await this.browser.navigate(initialUrl);
      } catch (navError) {
        // If Playwright fails, try system browser as fallback
        try {
          await this.automation.execute({ type: "open_url", target: initialUrl });
          const label = inferFriendlyBrowserLabel(initialUrl, language) || initialUrl;
          return {
            reply: language === "ko" ? `${label} 열었어요.` : `I opened ${label}.`,
            actions: [this.makeAction("open_url", initialUrl)],
            provider: "system-browser",
            details: { url: initialUrl, openMode: "external-browser" }
          };
        } catch {
          throw navError;
        }
      }
      actions.push(this.makeAction("browser_navigate", initialUrl));

      const isSimpleOpen = /^(open|go to|visit|열어|들어가|켜)/i.test(normalizedInput) && !isComplexBrowserTask;

      if (isSimpleOpen && !state.anomalies?.length) {
        const label = inferFriendlyBrowserLabel(state.title || initialUrl, language) || initialUrl;
        return {
          reply: language === "ko" ? `${label} 열었어요.` : `I opened ${label}.`,
          actions,
          provider: "local",
          details: { url: state.url, title: state.title }
        };
      }
    } else {
      // OS task initial state
      state = { url: "", title: "", elements: [], elementCount: 0 };
    }

    const maxSteps = AssistantService.REACT_MAX_STEPS;

    // Build conversation history for the ReAct agent
    const agentHistory = [];
    let lastError = "";
    let finalSummary = "";

    // ReAct Loop
    for (let step = 1; step <= maxSteps; step++) {
      const observation = await this.buildReActObservation(state, step, lastError);
      lastError = "";

      // Build the user prompt for this step
      const userPrompt = step === 1
        ? `User's goal: ${input}\n\n${observation}\n\nDecide your first action to achieve the user's goal.`
        : `${observation}\n\nContinue working toward the goal: ${input}`;

      agentHistory.push({ role: "user", content: userPrompt });

      // Ask AI for next action
      let aiResponse;
      try {
        aiResponse = await chat({
          systemPrompt: AssistantService.REACT_AGENT_SYSTEM_PROMPT,
          tier: "fast",
          model: FAST_PLANNER_MODEL,
          history: [
            ...this.getRecentHistory(6),
            ...agentHistory.slice(-8)
          ],
          userPrompt: [
            "Keep the user's broader conversation context intact while controlling the browser.",
            "If a local fallback is needed later, it will receive this same context; do not assume a fresh session.",
            userPrompt
          ].join("\n\n")
        });
      } catch {
        finalSummary = language === "ko"
          ? "브라우저 작업 중 AI 응답에 문제가 있었어요."
          : "There was a problem with the AI response during the browser task.";
        break;
      }

      // Parse AI action
      let parsed = safeJsonParse(aiResponse);
      if (!parsed?.action) {
        const localResponse = await chat({
          systemPrompt: AssistantService.REACT_AGENT_SYSTEM_PROMPT,
          tier: "fast",
          model: FAST_PLANNER_MODEL,
          history: agentHistory.slice(-8),
          userPrompt: [
            "The configured API response was not a valid browser action. Continue as a local fallback without losing context.",
            "Recent user conversation:",
            this.buildHistorySnippet(),
            "",
            userPrompt
          ].join("\n"),
          localOnly: true
        }).catch(() => "");
        const localParsed = safeJsonParse(localResponse);

        if (localParsed?.action) {
          aiResponse = localResponse;
          parsed = localParsed;
        }
      }

      agentHistory.push({ role: "assistant", content: aiResponse });

      if (!parsed?.action) {
        lastError = "Invalid AI response (not valid JSON with an action field). Try again.";
        continue;
      }

      // Done?
      if (parsed.action === "done") {
        finalSummary = parsed.summary || "";
        actions.push(this.makeAction("browser_done", parsed.summary || "completed"));
        break;
      }

      // Execute the action
      const result = await this.executeReActAction(parsed);
      actions.push(this.makeAction(`browser_${parsed.action}`,
        parsed.url || parsed.text || `element_${parsed.element_id}` || parsed.key || parsed.direction || ""));

      if (result.error) {
        lastError = result.error;
      }

      if (result.state) {
        state = result.state;
      } else if (!result.error) {
        // done action already handled above
        break;
      }
    }

    // Build final reply
    const finalState = state || {};
    const notices = detectBrowserSpecialCases(finalState);
    let reply = "";

    if (finalSummary) {
      reply = finalSummary;
    } else {
      // Ask AI to summarize what happened
      try {
        reply = await this.replyWithModel(
          input,
          [
            "The user asked you to do something in the browser. Here is the result.",
            `Reply only in ${buildLanguageName(language)}.`,
            "Preserve the existing conversation context; this browser task is part of the same session, not a reset.",
            `Final page URL: ${finalState.url || "(unknown)"}`,
            `Final page title: ${finalState.title || "(untitled)"}`,
            `Actions taken: ${actions.map(a => a.type).join(" → ")}`,
            finalState.visibleText ? `Visible text:\n${finalState.visibleText.slice(0, 2000)}` : ""
          ].join("\n\n"),
          { tier: "fast", includeHistory: true }
        );
      } catch {
        reply = language === "ko"
          ? "브라우저 작업을 처리했어요."
          : "I handled the browser task.";
      }
    }

    reply = appendBrowserNotices(reply, notices, language);

    return {
      reply,
      actions,
      provider: "react-agent",
      details: {
        url: finalState.url || "",
        title: finalState.title || "",
        stepsExecuted: actions.length,
        anomalies: notices
      }
    };
  }

  async handleBrowserLogin(input, route) {
    const language = detectReplyLanguage(input);
    const siteOrUrl = cleanupParsedText(route.siteOrUrl || extractUrl(input) || stripCommandPrefix(input));

    if (!siteOrUrl || /^(?:login|log in|sign in|로그인(?:해줘|해)?|사인인)$/i.test(siteOrUrl)) {
      return this.beginClarification(
        input,
        route,
        language === "ko"
          ? "어느 사이트에 로그인할까요?"
          : "Which site should I log into?",
        {
          field: "siteOrUrl",
          kind: "browser_login_site",
          language
        }
      );
    }

    if (!wantsSavedBrowserLogin(input)) {
      const targetUrl = buildDirectSiteUrl(siteOrUrl) || normalizeBrowserOpenUrl(siteOrUrl);
      const opened = await this.openBrowserTargetForUser(targetUrl);
      const siteLabel =
        inferFriendlyBrowserLabel(siteOrUrl || opened.title || targetUrl, language) ||
        (language === "ko" ? "사이트" : "the site");
      const fallback =
        language === "ko"
          ? `${siteLabel} 로그인 화면을 열어뒀어요. 여기서 직접 로그인하시면 돼요.`
          : `I opened the ${siteLabel} login page so you can sign in there yourself.`;

      return {
        reply: await this.polishCommandReply(
          input,
          {
            actions: [this.makeAction("browser_login", siteLabel)],
            details: {
              title: opened.title || "",
              url: opened.url || targetUrl,
              openMode: opened.openMode,
              loginMode: "manual",
              site: siteLabel
            }
          },
          fallback
        ),
        actions: [this.makeAction("browser_login", siteLabel)],
        provider: opened.openMode,
        details: {
          title: opened.title || "",
          url: opened.url || targetUrl,
          openMode: opened.openMode,
          loginMode: "manual",
          site: siteLabel
        }
      };
    }

    const data = await this.browser.loginWithStoredCredential(siteOrUrl);
    const fallback = detectReplyLanguage(input) === "ko"
      ? `${data.site} 로그인 정보를 입력했어요.`
      : `I filled in the saved login for ${data.site}.`;

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions: [this.makeAction("browser_login", data.site)],
          details: data
        },
        fallback
      ),
      actions: [this.makeAction("browser_login", data.site)],
      provider: "local",
      details: data
    };
  }

  async handleObsRoute(input, route) {
    let data;
    let action;

    if (route.route === "obs_connect") {
      data = await this.obs.connect();
      action = this.makeAction("obs_connect", data.address);
    } else if (route.route === "obs_start") {
      data = await this.obs.startStream();
      action = this.makeAction("obs_start_stream", data.currentScene);
    } else if (route.route === "obs_stop") {
      data = await this.obs.stopStream();
      action = this.makeAction("obs_stop_stream", data.currentScene);
    } else if (route.route === "obs_scene") {
      if (!route.sceneName) {
        return this.beginClarification(
          input,
          route,
          detectReplyLanguage(input) === "ko"
            ? "어느 씬으로 바꿀까요?"
            : "Which scene should I switch to?",
          {
            field: "sceneName",
            kind: "obs_scene_name",
            language: detectReplyLanguage(input)
          }
        );
      }

      data = await this.obs.switchScene(route.sceneName);
      action = this.makeAction("obs_scene", route.sceneName);
    } else {
      data = await this.obs.status();
      action = this.makeAction("obs_status", data.currentScene);
    }

    const fallback = detectReplyLanguage(input) === "ko" ? "OBS 처리했어요." : "I handled OBS.";

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions: [action],
          details: data
        },
        fallback
      ),
      actions: [action],
      provider: "local",
      details: data
    };
  }

  async handleFileRoute(input, route) {
    if (route.route === "file_write") {
      if (!route.path) {
        throw new Error("A file path is required.");
      }

      const data = await this.files.writeFile(route.path, route.content || "");
      const fallback = detectReplyLanguage(input) === "ko"
        ? `${data.path}에 저장했어요.`
        : `I saved that to ${data.path}.`;

      return {
        reply: await this.polishCommandReply(
          input,
          {
            actions: [this.makeAction("file_write", data.path)],
            details: data
          },
          fallback
        ),
        actions: [this.makeAction("file_write", data.path)],
        provider: "local",
        details: data
      };
    }

    if (route.route === "file_read") {
      if (!route.path) {
        throw new Error("A file path is required.");
      }

      const data = await this.files.readFile(route.path);
      const reply = await this.replyWithModel(
        input,
        `The user asked about a file. Here is its content:\n\n${data.content.slice(0, 12000)}`,
        {
          tier: "complex"
        }
      ).catch(() =>
        detectReplyLanguage(input) === "ko"
          ? `${data.path} 파일 내용을 읽어왔어요. 필요한 부분을 설명하거나 수정안도 도와드릴게요.`
          : `I read ${data.path}. I can explain it or suggest edits if you want.`
      );

      return {
        reply,
        actions: [this.makeAction("file_read", data.path)],
        provider: getTierProviderLabel("complex"),
        details: {
          ...data,
          showInlinePreview: true
        }
      };
    }

    const data = await this.files.listDirectory(route.path || ".");
    const fallback = detectReplyLanguage(input) === "ko"
      ? `${data.path} 목록을 읽었어요.`
      : `I listed ${data.path}.`;

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions: [this.makeAction("file_list", data.path)],
          details: data
        },
        fallback
      ),
      actions: [this.makeAction("file_list", data.path)],
      provider: "local",
      details: data
    };
  }

  async handleGameRoute(input, route) {
    if (!this.games || typeof this.games.listInstalledGames !== "function") {
      throw new Error("Game management is not available in this build.");
    }

    const language = detectReplyLanguage(input);
    const platform = route.platform || detectGamePlatform(input);
    const query = cleanupParsedText(route.query || extractGameName(input));

    if ((route.route === "game_install" || route.route === "game_update") && !query) {
      return this.beginClarification(
        input,
        {
          ...route,
          platform
        },
        language === "ko"
          ? route.route === "game_install"
            ? "어떤 게임을 설치할까요?"
            : "어떤 게임을 업데이트할까요?"
          : route.route === "game_install"
            ? "Which game should I install?"
            : "Which game should I update?",
        {
          field: "query",
          kind: route.route,
          language
        }
      );
    }

    let data;
    let fallback;
    const actions = [];

    if (route.route === "game_list") {
      data = await this.games.listInstalledGames({
        platform
      });

      const preview = [
        ...(data.steamGames || []).slice(0, 3).map((game) => game.name),
        ...(data.epicGames || []).slice(0, 3).map((game) => game.name)
      ].filter(Boolean).join(", ");

      actions.push(this.makeAction("game_list", platform));
      fallback =
        language === "ko"
          ? preview
            ? `설치된 게임을 ${data.totalCount}개 찾았어요. 예를 들면 ${preview} 같은 항목이 있어요.`
            : "지금 확인된 설치 게임이 없어요."
          : preview
            ? `I found ${data.totalCount} installed games, including ${preview}.`
            : "I could not find any installed games right now.";
    } else if (route.route === "game_install") {
      data = await this.games.installGame({
        gameName: query,
        platform
      });

      if (data.launcherOpened) {
        actions.push(this.makeAction("open_app", data.platform === "epic" ? "Epic Games Launcher" : "Steam"));
      }

      actions.push(this.makeAction("game_install", `${data.platform}:${data.gameName || query}`));
      fallback =
        language === "ko"
          ? data.platform === "steam"
            ? `Steam에서 ${data.gameName || query} 설치 흐름을 열어뒀어요.`
            : `Epic 쪽에서 ${data.gameName || query} 설치 페이지를 열어뒀어요.`
          : data.platform === "steam"
            ? `I opened the Steam install flow for ${data.gameName || query}.`
            : `I opened the Epic install page for ${data.gameName || query}.`;
    } else {
      data = await this.games.updateGame({
        gameName: query,
        platform
      });

      if (data.launcherOpened) {
        actions.push(this.makeAction("open_app", data.platform === "epic" ? "Epic Games Launcher" : "Steam"));
      }

      actions.push(this.makeAction("game_update", `${data.platform}:${data.gameName || query || "all"}`));
      fallback =
        language === "ko"
          ? data.platform === "steam"
            ? query
              ? `Steam에서 ${data.gameName || query} 업데이트 흐름을 열어뒀어요.`
              : "Steam 다운로드와 업데이트 화면을 열어뒀어요."
            : query
              ? `Epic 쪽에서 ${data.gameName || query} 업데이트 확인 흐름을 열어뒀어요.`
              : "Epic 업데이트 확인 흐름을 열어뒀어요."
          : data.platform === "steam"
            ? query
              ? `I opened the Steam update flow for ${data.gameName || query}.`
              : "I opened the Steam downloads and updates view."
            : query
              ? `I opened the Epic update flow for ${data.gameName || query}.`
              : "I opened the Epic update flow.";
    }

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions,
          details: data
        },
        fallback
      ),
      actions,
      provider: "local",
      details: data
    };
  }

  async handleCodeProject(input) {
    if (!this.codeProjects || typeof this.codeProjects.createProject !== "function") {
      throw new Error("Project generation is not available in this build.");
    }

    const data = await this.codeProjects.createProject(input);
    const language = detectReplyLanguage(input);
    const actions = [this.makeAction("code_project", data.projectName)];

    if (data.openedInVsCode) {
      actions.push(this.makeAction("open_app", "Visual Studio Code"));
      this.rememberAppContext("Visual Studio Code");
    }

    const fallback =
      language === "ko"
        ? data.openedInVsCode
          ? `${data.projectName} 프로젝트를 만들고 VS Code에서 열어뒀어요.`
          : `${data.projectName} 프로젝트를 만들어뒀어요.`
        : data.openedInVsCode
          ? `I created ${data.projectName} and opened it in VS Code.`
          : `I created ${data.projectName}.`;

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions,
          details: data
        },
        fallback
      ),
      actions,
      provider: data.provider || "local",
      details: data
    };
  }

  async handleStreamPrep(input) {
    const actions = [];

    const obsOpen = await this.automation.execute({
      type: "open_app",
      target: "OBS"
    });
    actions.push(this.makeAction("open_app", obsOpen.resolvedTarget || obsOpen.appName || "OBS"));
    this.rememberAppContext(obsOpen.resolvedTarget || obsOpen.appName || "OBS");

    const steamOpen = await this.automation.execute({
      type: "open_app",
      target: "Steam"
    });
    actions.push(this.makeAction("open_app", steamOpen.resolvedTarget || steamOpen.appName || "Steam"));

    await this.automation.execute({
      type: "open_url",
      target: "https://www.twitch.tv/"
    });
    actions.push(this.makeAction("open_url", "https://www.twitch.tv/"));

    let obsStatus = null;

    try {
      obsStatus = await this.obs.status();
      actions.push(this.makeAction("obs_status", obsStatus.currentScene));
    } catch (_error) {
      actions.push(this.makeAction("obs_status", "not-connected", "skipped"));
    }

    const fallback = detectReplyLanguage(input) === "ko"
      ? "스트리밍 준비를 시작했어요."
      : "I started the stream setup.";

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions,
          details: {
            obsStatus
          }
        },
        fallback
      ),
      actions,
      provider: "local",
      details: {
        obsStatus
      }
    };
  }

  async handleSpotifyRoute(input, route) {
    return this.handleSpotifySkill(input, route, "Spotify");
  }

  async handleAppOpen(input, route) {
    const requestedApp = this.normalizeRequestedAppName(
      route.appName ||
      extractAppName(input) ||
      (refersToCurrentAppContext(input) ? this.lastActiveApp : "")
    );

    const clarification = await this.maybeClarifyAppTarget(
      input,
      {
        ...route,
        appName: requestedApp
      },
      requestedApp,
      "open"
    );

    if (clarification) {
      return clarification;
    }

    if (!requestedApp) {
      throw new Error("I could not tell which app you wanted to open.");
    }

    const resolved = await this.automation.resolveAppTarget?.(requestedApp, {
      allowDirect: false
    }).catch(() => null);

    if (!resolved?.resolvedTarget) {
      return this.handleMissingAppRecovery(input, route, requestedApp);
    }

    const data = await this.automation.execute({
      type: "open_app",
      target: resolved.resolvedTarget
    });
    const openedName = data.resolvedTarget || data.appName || requestedApp;
    this.rememberAppContext(openedName);
    const fallback = detectReplyLanguage(input) === "ko"
      ? `${openedName} 열었어요.`
      : `I opened ${openedName}.`;

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions: [this.makeAction("open_app", openedName)],
          details: data
        },
        fallback
      ),
      actions: [this.makeAction("open_app", openedName)],
      provider: "local",
      details: data
    };
  }

  async handleGeneral(input) {
    let user = null;
    let token = null;
    try {
      const rawUser = piiManager.get("auth.user");
      token = piiManager.get("auth.token");
      if (rawUser) user = JSON.parse(rawUser);
    } catch (e) {}

    const preferredLang = user?.settings?.language || "auto";
    const language = preferredLang === "auto" ? detectReplyLanguage(input) : preferredLang;

    let reply = "";
    let provider = "jarvis-cloud";

    if (looksLikeModelIdentityQuestion(input)) {
      return buildConfiguredModelIdentityResult(
        input,
        language,
        this.settings?.getConversationModelSettingsView?.() || {},
      );
    }

    const langInstruction = preferredLang === "ko"
      ? "무조건 한국어로만 대답하세요. 영어 질문이 들어와도 한국어로 번역해서 답변하세요."
      : preferredLang === "en"
        ? "Respond in English ONLY. Even if the user speaks Korean, reply in English."
        : language === "ko"
          ? "한국어로 응답하세요."
          : "Respond in English.";

    const systemPrompt = [
      "당신은 유능하고 침착한 AI 비서 Jarvis입니다.",
      langInstruction,
      "일반 챗봇처럼 두루뭉술하게 대화하기보다, 사용자의 일과 결정을 앞당기는 개인 비서처럼 행동하세요.",
      "답변은 가능하면 먼저 핵심 정리, 실행안, 다음 단계 중 하나를 바로 제시하세요.",
      "사용자가 자기소개를 요청하면 길게 홍보하지 말고, 어떤 방식으로 실무를 돕는지 짧고 자연스럽게 설명하세요.",
      "장황한 기능 나열보다 지금 바로 도움이 되는 제안, 정리, 초안을 우선하세요.",
      "만약 유튜브, 네이버, 구글 검색 등 웹사이트 작업이 필요하면 답변 맨 끝에 [ACTION: BROWSE] 검색어 또는 URL 형식을 포함하세요.",
      "만약 컴퓨터에 설치된 로컬 앱(예: 메모장, 계산기, 크롬 등)을 실행해야 한다면 [ACTION: OPEN_APP] 앱이름 형식을 포함하세요.",
      "앱이나 CLI 도구가 없을 수 있으면 없다고 명확히 말하고, 설치를 진행할지 또는 공식 웹사이트에서 실행 가능한지 판단해야 합니다.",
      "사용자가 설치를 명확히 허락하지 않은 상태에서는 자동 설치하지 말고, [ACTION: INSTALL_APP] 앱이름은 공식 설치 페이지/문서를 여는 용도로만 사용하세요.",
      "OpenClaw는 공식 흐름상 Node.js 22+ 이후 npm 설치, 온보딩, doctor/status/dashboard 확인이 필요한 CLI 도구로 판단하세요.",
      "일상적인 대화에서도 비서답게 정리하고 이어서 도울 수 있는 방향을 제안하세요."
    ].join("\n");

    const tier = chooseChatModelTier(input, this.getRecentHistory());

    try {
      const modelReply = await this.replyWithModel(
        input,
        [
          "Follow the conversation naturally.",
          `Reply only in ${buildLanguageName(language)}.`,
          "Sound like Jarvis as a modern personal assistant: calm, polished, warm, and capable.",
          "Do not sound like a generic chatbot.",
          "Prefer concise, useful, action-oriented replies over broad conversational filler.",
          "If the user is chatting casually, still answer like a sharp assistant who can organize thoughts and suggest the next step.",
          "If the user asks for recommendations, suggest two or three concrete options when useful.",
          "If the user greets you, greet them back naturally and invite the next task briefly.",
          "If the user asks you to introduce yourself, keep it short and practical rather than promotional.",
          "Do not sound like a status banner or system message."
        ].join("\n"),
        {
          tier,
          systemPrompt
        }
      );

      return {
        reply: modelReply,
        actions: [],
        provider: modelReply === buildModelConnectionReply(input) ? "model-required" : getTierProviderLabel(tier)
      };
    } catch (error) {
      console.error("Configured chat model failed:", error.message);
      if (!ENABLE_CLOUD_AI_FALLBACK) {
        const fallbackConfig = resolveConfig({
          tier,
          provider: undefined
        });

        return {
          reply: buildModelFailureReply(input, error, fallbackConfig),
          actions: [],
          provider: "model-error"
        };
      }
    }

    // Build conversation history for context
    const recentHistory = this.getRecentHistory().slice(-10).map(h => ({
      role: h.role || "user",
      content: h.content || h.text || ""
    }));
    const messages = [...recentHistory, { role: "user", content: input }];

    try {

      if (!token || !user) {
        return {
          reply: language === "ko"
            ? "Jarvis를 사용하려면 먼저 로그인이 필요합니다. 앱 상단의 프로필 버튼에서 로그인해 주세요."
            : "Please log in to use Jarvis. Click the profile button in the sidebar to sign in.",
          actions: [],
          provider: "system"
        };
      }

      const plan = user.plan;
      const userGeminiKey = user.settings?.geminiKey || "";

      if (!plan) {
        return {
          reply: language === "ko"
            ? "플랜 설정이 완료되지 않았습니다. 앱을 다시 시작하여 플랜을 선택해 주세요."
            : "Setup is not complete. Please restart the app and select a plan.",
          actions: [],
          provider: "system"
        };
      }

      if (plan === "free" && !userGeminiKey) {
        return {
          reply: language === "ko"
            ? "무료 플랜을 사용하려면 설정에서 Gemini API 키를 등록해야 합니다. 앱을 다시 시작하여 셋업을 완료해주세요."
            : "Please enter your Gemini API key in the setup screen to use the free plan. Restart the app to complete setup.",
          actions: [],
          provider: "system"
        };
      }

      let res;
      if (plan === "pro") {
        res = await fetchWithRuntime(`${JARVIS_CLOUD_API_BASE}/api/ai/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ messages, systemPrompt, language })
        });
      } else {
        // Free plan -> Call Google Gemini API directly with user's key to hit Google's rate limits
        const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
        const MODEL = "gemini-1.5-flash-latest"; // Fixed: Using latest to avoid 404
        
        const contents = messages.map(msg => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }]
        }));
        
        const systemInstruction = { parts: [{ text: systemPrompt }] };

        res = await fetchWithRuntime(`${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${userGeminiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            systemInstruction,
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
          })
        });
      }

      if (!res.ok) {
        if (res.status === 429) {
           return {
             reply: language === "ko"
               ? "구글 API 무료 호출 한도(Rate Limit)를 모두 사용하셨습니다. 끊김 없는 초고속 AI를 위해 Jarvis Managed AI(Pro 플랜)로 업그레이드 하시는 건 어떨까요? ✨"
               : "You've reached the Google API free rate limit. Upgrade to Jarvis Managed AI (Pro) for uninterrupted high-speed access! ✨",
             actions: [this.makeAction("require_pro_subscription", "billing")],
             provider: "system"
           };
        }
        
        const errText = await res.text().catch(() => "");
        throw new Error(`API error: ${res.status} ${errText}`);
      }

      const data = await res.json();
      
      if (plan === "pro") {
        reply = data.reply || "";
        provider = `jarvis-cloud-${data.model || "gemini-2.0-flash"}`;
      } else {
        reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        provider = "gemini-1.5-flash-direct";
      }

      // 자율 행동 판단 (Action Detection)
      if (typeof reply === "string") {
        const browseMatch = reply.match(/\[ACTION: BROWSE\]\s*(.*)/i);
        const openMatch = reply.match(/\[ACTION: OPEN_APP\]\s*(.*)/i);
        const installMatch = reply.match(/\[ACTION: INSTALL_APP\]\s*(.*)/i);

        if (browseMatch) {
          const query = browseMatch[1].trim();
          const cleanReply = reply.replace(/\[ACTION: BROWSE\].*/i, "").trim();
          const browserResult = await this.handleBrowser(query);
          return {
            ...browserResult,
            reply: cleanReply ? `${cleanReply}\n\n${browserResult.reply}` : browserResult.reply,
            provider: `${provider}-autonomous`
          };
        }

        if (installMatch) {
          const appName = installMatch[1].trim();
          const cleanReply = reply.replace(/\[ACTION: INSTALL_APP\].*/i, "").trim();
          // 설치 페이지로 브라우저 이동
          const installResult = await this.handleBrowser(`${appName} 공식 사이트 다운로드 페이지`);
          return {
            ...installResult,
            reply: cleanReply
              ? `${cleanReply}\n\n${language === "ko" ? `${appName}의 설치 페이지로 이동했습니다.` : `Navigating to the ${appName} installation page.`}`
              : (language === "ko" ? `${appName}이(가) 설치되어 있지 않아 설치 페이지를 열었습니다.` : `${appName} is not installed. Opening the download page.`),
            provider: `${provider}-autonomous`
          };
        }

        if (openMatch) {
          const appName = openMatch[1].trim();
          const cleanReply = reply.replace(/\[ACTION: OPEN_APP\].*/i, "").trim();
          const appResult = await this.handleAppOpen(input, { appName });
          return {
            ...appResult,
            reply: cleanReply ? `${cleanReply}\n\n${appResult.reply}` : appResult.reply,
            provider: `${provider}-autonomous`
          };
        }
      }

    } catch (err) {
      console.error("Jarvis cloud AI failed:", err.message);
      reply = language === "ko"
        ? `[⚠️ 연결 오류]\n\n서버에 연결하지 못했습니다. (${err.message})\n\n인터넷 연결을 확인해 주세요.`
        : `[⚠️ Connection Error]\n\nCould not reach the server. (${err.message})\n\nPlease check your internet connection.`;
      provider = "error";
    }

    return {
      reply,
      actions: [],
      provider
    };
  }


  async handleInput(input) {
    const cleanInput = normalizeWhitespace(input);

    if (!cleanInput) {
      return {
        reply:
          detectReplyLanguage(input) === "ko"
            ? "말씀해주시면 바로 도와드릴게요."
            : "Tell me what you want, and I will help right away.",
        actions: [],
        provider: "local",
        language: detectReplyLanguage(input)
      };
    }

    if (looksLikeModelIdentityQuestion(cleanInput)) {
      const result = buildConfiguredModelIdentityResult(
        cleanInput,
        detectReplyLanguage(cleanInput),
        this.settings?.getConversationModelSettingsView?.() || {},
      );
      this.rememberTurn("user", cleanInput);
      this.rememberTurn("assistant", result.reply);
      return result;
    }

    const pendingClarificationResult = await this.continuePendingClarification(cleanInput);

    if (pendingClarificationResult) {
      pendingClarificationResult.language = detectReplyLanguage(cleanInput);
      this.rememberTurn("user", cleanInput);
      this.rememberTurn("assistant", pendingClarificationResult.reply);
      return pendingClarificationResult;
    }

    const pendingBrowserResult = await this.continuePendingBrowserContinuation(cleanInput);

    if (pendingBrowserResult) {
      pendingBrowserResult.language = detectReplyLanguage(cleanInput);
      this.rememberTurn("user", cleanInput);
      this.rememberTurn("assistant", pendingBrowserResult.reply);
      return pendingBrowserResult;
    }

    if (this.pendingWorkspaceMessage && looksLikeFreshWorkspaceCommand(cleanInput)) {
      this.pendingWorkspaceMessage = null;
    }

    const pendingWorkspaceResult = await this.continuePendingWorkspaceMessage(cleanInput);

    if (pendingWorkspaceResult) {
      pendingWorkspaceResult.language = detectReplyLanguage(cleanInput);
      this.rememberTurn("user", cleanInput);
      this.rememberTurn("assistant", pendingWorkspaceResult.reply);
      return pendingWorkspaceResult;
    }

    const extensionWebhookResult = await this.maybeHandleExtensionWebhook(cleanInput);

    if (extensionWebhookResult) {
      extensionWebhookResult.language = detectReplyLanguage(cleanInput);
      this.rememberTurn("user", cleanInput);
      this.rememberTurn("assistant", extensionWebhookResult.reply);
      return extensionWebhookResult;
    }

    let route = await this.routeInput(cleanInput);

    if (
      route.route === "chat" &&
      looksLikeAppAction(cleanInput) &&
      this.lastActiveApp
    ) {
      route = {
        ...route,
        route: "app_action",
        appName: this.lastActiveApp
      };
    }

    let result;

    try {
      result = await this.executeRoute(cleanInput, route);
    } catch (error) {
      result = {
        reply:
          detectReplyLanguage(cleanInput) === "ko"
            ? `처리 중에 문제가 있었어요: ${error.message}`
            : `I ran into a problem while handling that: ${error.message}`,
        actions: [],
        provider: "local-error"
      };
    }

    result.language = route.language || detectReplyLanguage(cleanInput);
    this.rememberTurn("user", cleanInput);
    this.rememberTurn("assistant", result.reply);
    void this.rememberLongTermMemory(cleanInput, result.reply);
    return result;
  }
}

module.exports = {
  AssistantService,
  chooseChatModelTier,
  extractAppName,
  buildHeuristicBrowserPlan,
  buildRouteFallback
};
