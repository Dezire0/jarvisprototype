import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DEFAULT_MEDIA_PROVIDER = "youtube";
const DEFAULT_DASHBOARD_WINDOW = 12;
const MEDIA_PROGRESS_STEP_SECONDS = 15;

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function clampNumber(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

export function redactSensitiveText(value = "") {
  let text = String(value || "");
  text = text.replace(/(password|passwd|api[_-]?key|token|secret)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]");
  text = text.replace(/\b[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, "[REDACTED_JWT]");
  text = text.replace(/\b(sk|rk|ghp|ghu|ghs|AIza)[A-Za-z0-9_\-]{12,}\b/g, "[REDACTED_TOKEN]");
  return text;
}

function summarizeText(value = "", limit = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeJsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function classifySiteType({ url = "", title = "", text = "" } = {}) {
  const haystack = `${url}\n${title}\n${text}`.toLowerCase();
  if (/(youtube|spotify|music|netflix|watch|podcast|video|lyrics|player)/i.test(haystack)) {
    return "media";
  }
  if (/(mail\.google|gmail|outlook|docs|notion|slack|jira|github|calendar|drive|sheet|work|meeting|dashboard)/i.test(haystack)) {
    return "work";
  }
  if (/(x\.com|twitter|instagram|facebook|reddit|discord|community|thread|social)/i.test(haystack)) {
    return "social";
  }
  if (/(amazon|shop|store|cart|checkout|product|shopping|buy|coupon)/i.test(haystack)) {
    return "shopping";
  }
  return "unknown";
}

export function buildBuddyActions(siteType = "unknown", language = "ko") {
  const isKo = String(language || "").toLowerCase().startsWith("ko");
  const makePromptAction = (id, labelKo, labelEn, promptKo, promptEn) => ({
    id,
    kind: "prompt",
    label: isKo ? labelKo : labelEn,
    suggestedPrompt: isKo ? promptKo : promptEn
  });
  const makeToolAction = (id, labelKo, labelEn, tool, payload = {}) => ({
    id,
    kind: "tool",
    label: isKo ? labelKo : labelEn,
    tool,
    payload
  });

  if (siteType === "media") {
    return [
      makeToolAction("media-play", "재생", "Play", "media:play"),
      makeToolAction("media-pause", "일시정지", "Pause", "media:pause"),
      makeToolAction("media-forward", "15초 이동", "Seek +15s", "media:seek", { deltaSeconds: MEDIA_PROGRESS_STEP_SECONDS }),
      makeToolAction("media-lyrics", "가사", "Lyrics", "media:get-lyrics")
    ];
  }

  if (siteType === "work") {
    return [
      makePromptAction("work-summarize", "요약", "Summarize", "지금 보고 있는 내용을 핵심만 요약해줘.", "Summarize the current page in concise bullets."),
      makePromptAction("work-draft", "답장 초안", "Draft reply", "지금 문맥을 바탕으로 답장 초안을 작성해줘.", "Draft a reply based on the current context."),
      makePromptAction("work-tasks", "할 일 추출", "Extract tasks", "지금 화면에서 해야 할 일을 추출해줘.", "Extract the action items from the current screen.")
    ];
  }

  if (siteType === "social") {
    return [
      makePromptAction("social-summary", "스레드 요약", "Summarize thread", "이 스레드의 핵심 흐름만 요약해줘.", "Summarize the key thread flow."),
      makePromptAction("social-links", "링크 추출", "Extract links", "현재 화면의 주요 링크를 정리해줘.", "Extract the key links from the current screen."),
      makePromptAction("social-reply", "응답 초안", "Draft response", "현재 문맥에 맞는 응답 초안을 작성해줘.", "Draft a response for the current context.")
    ];
  }

  if (siteType === "shopping") {
    return [
      makePromptAction("shopping-compare", "비교 포인트", "Compare points", "이 상품의 비교 포인트를 정리해줘.", "List the key comparison points for this item."),
      makePromptAction("shopping-risk", "주의점", "Risks", "구매 전에 봐야 할 주의점을 알려줘.", "Tell me what to double-check before buying."),
      makePromptAction("shopping-summary", "상품 요약", "Product summary", "현재 상품 정보를 빠르게 요약해줘.", "Summarize the product details.")
    ];
  }

  return [
    makePromptAction("generic-summary", "요약", "Summarize", "현재 화면을 빠르게 요약해줘.", "Summarize the current context."),
    makePromptAction("generic-help", "다음 행동", "Next action", "여기서 다음으로 무엇을 해야 할지 알려줘.", "Tell me the best next action from here."),
    makePromptAction("generic-extract", "핵심 추출", "Extract key points", "핵심 포인트만 추출해줘.", "Extract the key points only.")
  ];
}

function buildBuddyMessage(siteType = "unknown", language = "ko") {
  const isKo = String(language || "").toLowerCase().startsWith("ko");
  if (siteType === "media") {
    return isKo ? "미디어 제어가 필요해 보여서 바로 도와줄 준비를 했어요." : "It looks like media controls might help here.";
  }
  if (siteType === "work") {
    return isKo ? "지금 업무 흐름을 빠르게 정리하거나 초안을 도와줄 수 있어요." : "I can help summarize this work context or draft the next step.";
  }
  if (siteType === "social") {
    return isKo ? "현재 스레드를 요약하거나 응답 초안을 만드는 쪽으로 도와줄 수 있어요." : "I can summarize this thread or draft a response.";
  }
  if (siteType === "shopping") {
    return isKo ? "비교 포인트나 구매 전 체크 사항을 빠르게 정리해줄 수 있어요." : "I can help compare this item or call out purchase checks.";
  }
  return isKo ? "필요해 보이는 순간만 반응하도록 로컬에서 먼저 감지하고 있어요." : "I am watching local cues first and only stepping in when it seems helpful.";
}

function buildInsights(metrics = {}, language = "ko") {
  const isKo = String(language || "").toLowerCase().startsWith("ko");
  const insights = [];
  if ((metrics.queueCompleted || 0) > 0) {
    insights.push(
      isKo
        ? `계정 작업 ${metrics.queueCompleted}건을 순차적으로 처리했어요.`
        : `Completed ${metrics.queueCompleted} account queue tasks sequentially.`
    );
  }
  if ((metrics.mediaInteractions || 0) > 0) {
    insights.push(
      isKo
        ? `인앱 미디어 제어가 ${metrics.mediaInteractions}회 실행됐어요.`
        : `In-app media controls were used ${metrics.mediaInteractions} times.`
    );
  }
  if ((metrics.buddyTriggers || 0) > 0) {
    insights.push(
      isKo
        ? `Buddy가 로컬 트리거를 ${metrics.buddyTriggers}번 감지했어요.`
        : `Buddy detected ${metrics.buddyTriggers} local triggers.`
    );
  }
  if (!insights.length) {
    insights.push(
      isKo
        ? "아직 기록이 많지 않아서, 다음 실행부터 지표가 더 선명해질 거예요."
        : "There is not enough activity yet; the next runs will make the dashboard more informative."
    );
  }
  return insights;
}

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function readJsonFile(targetPath, fallback) {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(targetPath, value) {
  await fs.writeFile(targetPath, JSON.stringify(value, null, 2), "utf8");
}

function buildEmptyState(language = "ko") {
  return {
    buddy: {
      active: false,
      event: null,
      message: buildBuddyMessage("unknown", language),
      actions: buildBuddyActions("unknown", language),
      suggestions: [],
      updatedAt: ""
    },
    media: {
      activeCard: null,
      history: []
    },
    accountQueue: {
      activeAccountId: "",
      currentTaskId: "",
      tasks: []
    },
    dashboard: {
      metrics: {
        tokenUsage: 0,
        successfulAutomations: 0,
        failedAutomations: 0,
        queueCompleted: 0,
        queueFailed: 0,
        estimatedMinutesSaved: 0,
        mediaInteractions: 0,
        buddyTriggers: 0
      },
      snapshots: [],
      insights: buildInsights({}, language)
    }
  };
}

function normalizeBuddyEvent(event = {}, language = "ko") {
  const normalized = {
    id: String(event.id || `buddy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    kind: summarizeText(event.kind || "manual", 60) || "manual",
    scope: summarizeText(event.scope || "jarvis-ui", 60) || "jarvis-ui",
    url: summarizeText(event.url || "", 320),
    title: summarizeText(event.title || "", 180),
    siteType: summarizeText(event.siteType || "", 40) || "",
    selectedTextPreview: summarizeText(event.selectedTextPreview || "", 240),
    errorPreview: summarizeText(event.errorPreview || "", 240),
    timestamp: event.timestamp || nowIso()
  };
  if (!normalized.siteType || normalized.siteType === "unknown") {
    normalized.siteType = classifySiteType({
      url: normalized.url,
      title: normalized.title,
      text: `${normalized.selectedTextPreview}\n${normalized.errorPreview}`
    });
  }
  normalized.actions = buildBuddyActions(normalized.siteType, language);
  normalized.message = buildBuddyMessage(normalized.siteType, language);
  return normalized;
}

function normalizeMediaCard(card = {}) {
  return {
    provider: summarizeText(card.provider || DEFAULT_MEDIA_PROVIDER, 40) || DEFAULT_MEDIA_PROVIDER,
    title: summarizeText(card.title || "Unknown title", 180) || "Unknown title",
    thumbnailUrl: summarizeText(card.thumbnailUrl || "", 400),
    canonicalUrl: summarizeText(card.canonicalUrl || "", 400),
    playbackState: summarizeText(card.playbackState || "idle", 40) || "idle",
    positionMs: clampNumber(card.positionMs, 0, Number.MAX_SAFE_INTEGER, 0),
    durationMs: clampNumber(card.durationMs, 0, Number.MAX_SAFE_INTEGER, 0),
    source: summarizeText(card.source || "YouTube", 80) || "YouTube",
    artist: summarizeText(card.artist || "", 120)
  };
}

function normalizeQueueTask(task = {}) {
  return {
    taskId: String(task.taskId || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    accountId: summarizeText(task.accountId || "default", 120) || "default",
    provider: summarizeText(task.provider || "generic", 80) || "generic",
    type: summarizeText(task.type || "generic", 80) || "generic",
    status: ["queued", "running", "waiting_for_auth", "failed", "completed", "cancelled"].includes(task.status)
      ? task.status
      : "queued",
    priority: clampNumber(task.priority, 0, 100, 50),
    attempts: clampNumber(task.attempts, 0, 50, 0),
    createdAt: task.createdAt || nowIso(),
    updatedAt: task.updatedAt || nowIso(),
    lastError: summarizeText(task.lastError || "", 240),
    possibleFix: summarizeText(task.possibleFix || "", 240),
    payload: task.payload && typeof task.payload === "object" ? safeJsonClone(task.payload) : {}
  };
}

async function collectYoutubeCard(page, fallbackUrl = "") {
  const snapshot = await page.evaluate(() => {
    const title =
      document.querySelector("meta[property='og:title']")?.getAttribute("content")
      || document.querySelector("title")?.textContent
      || document.querySelector("h1")?.textContent
      || "";
    const thumbnailUrl =
      document.querySelector("meta[property='og:image']")?.getAttribute("content")
      || document.querySelector("link[rel='image_src']")?.getAttribute("href")
      || "";
    const canonicalUrl =
      document.querySelector("link[rel='canonical']")?.getAttribute("href")
      || window.location.href;
    const video = document.querySelector("video");
    const positionMs = video ? Math.round((video.currentTime || 0) * 1000) : 0;
    const durationMs = video ? Math.round((video.duration || 0) * 1000) : 0;
    const playbackState = video ? (video.paused ? "paused" : "playing") : "ready";
    return {
      title: String(title || "").replace(/\s+/g, " ").trim(),
      thumbnailUrl: String(thumbnailUrl || "").trim(),
      canonicalUrl: String(canonicalUrl || "").trim(),
      playbackState,
      positionMs,
      durationMs
    };
  }).catch(() => null);

  const card = normalizeMediaCard({
    provider: DEFAULT_MEDIA_PROVIDER,
    title: snapshot?.title || "YouTube",
    thumbnailUrl: snapshot?.thumbnailUrl || "",
    canonicalUrl: snapshot?.canonicalUrl || fallbackUrl,
    playbackState: snapshot?.playbackState || "idle",
    positionMs: snapshot?.positionMs || 0,
    durationMs: snapshot?.durationMs || 0,
    source: "YouTube"
  });
  return card;
}

class CompanionServices {
  constructor({
    storageDir = path.join(os.tmpdir(), "jarvis-companion"),
    browser = null,
    language = "ko",
    now = () => Date.now()
  } = {}) {
    this.storageDir = storageDir;
    this.browser = browser;
    this.language = language;
    this.now = now;
    this.stateFilePath = path.join(this.storageDir, "companion-state.json");
    this.logFilePath = path.join(this.storageDir, "companion-events.log");
    this.state = buildEmptyState(language);
    this.accountContexts = new Map();
    this.mediaController = null;
    this.queueRunner = null;
  }

  async initialize() {
    await ensureDirectory(this.storageDir);
    const stored = await readJsonFile(this.stateFilePath, null);
    if (stored && typeof stored === "object") {
      this.state = {
        ...buildEmptyState(this.language),
        ...stored,
        dashboard: {
          ...buildEmptyState(this.language).dashboard,
          ...(stored.dashboard || {})
        }
      };
      this.state.dashboard.insights = buildInsights(this.state.dashboard.metrics, this.language);
    }
    return this;
  }

  async persistState() {
    await writeJsonFile(this.stateFilePath, this.state);
  }

  async appendLog(scope = "system", payload = {}) {
    const line = `[${nowIso(this.now())}] ${scope} ${redactSensitiveText(JSON.stringify(payload))}\n`;
    await fs.appendFile(this.logFilePath, line, "utf8").catch(() => {});
  }

  snapshotDashboard() {
    const snapshot = {
      windowStart: nowIso(this.now()),
      windowEnd: nowIso(this.now()),
      tokenUsage: this.state.dashboard.metrics.tokenUsage || 0,
      successfulAutomations: this.state.dashboard.metrics.successfulAutomations || 0,
      failedAutomations: this.state.dashboard.metrics.failedAutomations || 0,
      queueCompleted: this.state.dashboard.metrics.queueCompleted || 0,
      queueFailed: this.state.dashboard.metrics.queueFailed || 0,
      estimatedMinutesSaved: this.state.dashboard.metrics.estimatedMinutesSaved || 0
    };
    this.state.dashboard.snapshots = [
      ...this.state.dashboard.snapshots.slice(-(DEFAULT_DASHBOARD_WINDOW - 1)),
      snapshot
    ];
    this.state.dashboard.insights = buildInsights(this.state.dashboard.metrics, this.language);
  }

  recordMetric(name, delta = 1) {
    const metrics = this.state.dashboard.metrics;
    metrics[name] = (metrics[name] || 0) + delta;
    this.snapshotDashboard();
  }

  async getState() {
    return safeJsonClone(this.state);
  }

  async getDashboardState() {
    return safeJsonClone(this.state.dashboard);
  }

  async ingestBuddyEvent(event = {}) {
    const normalized = normalizeBuddyEvent(event, this.language);
    this.state.buddy = {
      active: true,
      event: normalized,
      message: normalized.message,
      actions: normalized.actions,
      suggestions: normalized.actions
        .filter((action) => action.kind === "prompt")
        .map((action) => action.suggestedPrompt)
        .slice(0, 2),
      updatedAt: nowIso(this.now())
    };
    this.recordMetric("buddyTriggers", 1);
    await this.appendLog("[Buddy]", normalized);
    await this.persistState();
    return safeJsonClone(this.state.buddy);
  }

  async performBuddyAction({ actionId = "", eventId = "" } = {}) {
    const action = this.state.buddy.actions.find((candidate) => candidate.id === actionId);
    if (!action) {
      return {
        ok: false,
        error: "Unknown buddy action."
      };
    }

    if (action.kind === "prompt") {
      return {
        ok: true,
        actionId,
        eventId,
        suggestedPrompt: action.suggestedPrompt,
        mode: "prompt"
      };
    }

    if (action.tool === "media:play") {
      return this.mediaPlay({});
    }
    if (action.tool === "media:pause") {
      return this.mediaPause({});
    }
    if (action.tool === "media:seek") {
      return this.mediaSeek(action.payload || {});
    }
    if (action.tool === "media:get-lyrics") {
      return this.mediaGetLyrics({});
    }

    return {
      ok: false,
      error: "Unsupported buddy action tool."
    };
  }

  async ensureHiddenMediaPage(url = "") {
    if (this.mediaController?.page && !this.mediaController.page.isClosed?.()) {
      if (url && this.mediaController.card?.canonicalUrl !== url) {
        await this.mediaController.page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 20000
        });
      }
      return this.mediaController.page;
    }

    if (!this.browser || typeof this.browser.ensureContext !== "function") {
      throw new Error("Browser media control is unavailable.");
    }

    const context = await this.browser.ensureContext();
    const page = await context.newPage();
    if (typeof this.browser.attachPageObservers === "function") {
      this.browser.attachPageObservers(page);
    }
    this.mediaController = {
      page,
      card: null
    };
    if (url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    }
    return page;
  }

  async updateMediaCard(page, fallbackUrl = "") {
    const card = await collectYoutubeCard(page, fallbackUrl);
    this.state.media.activeCard = card;
    this.state.media.history = [
      card,
      ...this.state.media.history.filter((entry) => entry.canonicalUrl !== card.canonicalUrl)
    ].slice(0, 6);
    if (this.mediaController) {
      this.mediaController.card = card;
    }
    this.recordMetric("mediaInteractions", 1);
    await this.persistState();
    return card;
  }

  async mediaGetOgInfo(input = {}) {
    const url = summarizeText(input.url || input.canonicalUrl || "", 400);
    const title = summarizeText(input.title || "", 180);
    const thumbnailUrl = summarizeText(input.thumbnailUrl || "", 400);
    const canonicalUrl = url || summarizeText(input.url || "", 400);
    const provider = classifySiteType({ url: canonicalUrl, title }) === "media" ? DEFAULT_MEDIA_PROVIDER : DEFAULT_MEDIA_PROVIDER;
    const card = normalizeMediaCard({
      provider,
      title: title || "YouTube",
      thumbnailUrl,
      canonicalUrl,
      playbackState: "ready",
      source: "YouTube"
    });
    this.state.media.activeCard = card;
    await this.persistState();
    return {
      ok: true,
      media: card
    };
  }

  async mediaPlay(input = {}) {
    const targetUrl = summarizeText(input.url || this.state.media.activeCard?.canonicalUrl || "", 400);
    const page = await this.ensureHiddenMediaPage(targetUrl);
    if (targetUrl && page.url() !== targetUrl) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    }

    await page.keyboard.press("k").catch(async () => {
      await page.evaluate(() => {
        const video = document.querySelector("video");
        if (video && video.paused) {
          video.play?.();
        }
      }).catch(() => {});
    });

    const card = await this.updateMediaCard(page, targetUrl);
    card.playbackState = "playing";
    this.state.media.activeCard = card;
    await this.appendLog("[Media]", { action: "play", url: card.canonicalUrl });
    await this.persistState();
    return {
      ok: true,
      media: card
    };
  }

  async mediaPause(input = {}) {
    const targetUrl = summarizeText(input.url || this.state.media.activeCard?.canonicalUrl || "", 400);
    const page = await this.ensureHiddenMediaPage(targetUrl);
    await page.keyboard.press("k").catch(async () => {
      await page.evaluate(() => {
        const video = document.querySelector("video");
        if (video && !video.paused) {
          video.pause?.();
        }
      }).catch(() => {});
    });
    const card = await this.updateMediaCard(page, targetUrl);
    card.playbackState = "paused";
    this.state.media.activeCard = card;
    await this.appendLog("[Media]", { action: "pause", url: card.canonicalUrl });
    await this.persistState();
    return {
      ok: true,
      media: card
    };
  }

  async mediaSeek(input = {}) {
    const deltaSeconds = clampNumber(
      input.deltaSeconds ?? input.seconds ?? MEDIA_PROGRESS_STEP_SECONDS,
      -600,
      600,
      MEDIA_PROGRESS_STEP_SECONDS
    );
    const targetUrl = summarizeText(input.url || this.state.media.activeCard?.canonicalUrl || "", 400);
    const page = await this.ensureHiddenMediaPage(targetUrl);
    await page.evaluate((delta) => {
      const video = document.querySelector("video");
      if (video) {
        video.currentTime = Math.max(0, (video.currentTime || 0) + delta);
      }
    }, deltaSeconds).catch(() => {});
    const card = await this.updateMediaCard(page, targetUrl);
    await this.appendLog("[Media]", { action: "seek", url: card.canonicalUrl, deltaSeconds });
    return {
      ok: true,
      media: card
    };
  }

  async mediaGetLyrics(input = {}) {
    const activeCard = this.state.media.activeCard || normalizeMediaCard({
      provider: DEFAULT_MEDIA_PROVIDER,
      title: "YouTube",
      source: "YouTube"
    });
    const title = activeCard.title || summarizeText(input.title || "Unknown track", 180);
    const [artist = "", trackTitle = title] = title.split(" - ").map((part) => part.trim()).filter(Boolean);
    return {
      ok: true,
      lyrics: {
        trackTitle: trackTitle || title,
        artist,
        lyricsSnippet: this.language.startsWith("ko")
          ? "현재 버전은 YouTube 메타데이터를 기반으로만 가사 힌트를 제공합니다."
          : "This version currently offers a lightweight lyrics hint based on YouTube metadata only.",
        source: "youtube-metadata",
        isSynced: false,
        possibleFix: this.language.startsWith("ko")
          ? "정확한 가사가 필요하면 전용 가사 제공자나 자막 소스를 연결해야 합니다."
          : "Connect a dedicated lyrics or captions provider for exact lyrics."
      }
    };
  }

  async getAccountContext(accountId = "default") {
    if (this.accountContexts.has(accountId)) {
      return this.accountContexts.get(accountId);
    }
    if (!this.browser || typeof this.browser.createIsolatedSession !== "function") {
      const fallback = {
        accountId,
        browser: this.browser
      };
      this.accountContexts.set(accountId, fallback);
      return fallback;
    }
    const browser = await this.browser.createIsolatedSession();
    const context = {
      accountId,
      browser
    };
    this.accountContexts.set(accountId, context);
    return context;
  }

  async switchAccount(input = {}) {
    const accountId = summarizeText(input.accountId || "default", 120) || "default";
    const provider = summarizeText(input.provider || "generic", 80) || "generic";
    await this.getAccountContext(accountId);
    this.state.accountQueue.activeAccountId = accountId;
    await this.appendLog("[AccountSwitcher]", { accountId, provider });
    await this.persistState();
    return {
      ok: true,
      accountId,
      provider
    };
  }

  async processAccountQueue() {
    if (this.queueRunner) {
      return this.queueRunner;
    }

    this.queueRunner = (async () => {
      while (true) {
        const nextTask = this.state.accountQueue.tasks
          .filter((task) => task.status === "queued")
          .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt))[0];

        if (!nextTask) {
          break;
        }

        nextTask.status = "running";
        nextTask.updatedAt = nowIso(this.now());
        this.state.accountQueue.currentTaskId = nextTask.taskId;
        await this.persistState();

        try {
          await this.switchAccount({
            accountId: nextTask.accountId,
            provider: nextTask.provider
          });
          const context = await this.getAccountContext(nextTask.accountId);
          const payload = nextTask.payload || {};

          if (payload.authBlocked) {
            nextTask.status = "waiting_for_auth";
            nextTask.possibleFix = this.language.startsWith("ko")
              ? "사용자가 직접 로그인 또는 2단계 인증을 마친 뒤 다시 실행해야 합니다."
              : "The user must complete login or 2FA before retrying this task.";
            this.recordMetric("failedAutomations", 1);
            this.recordMetric("queueFailed", 1);
          } else {
            if (payload.url && context.browser?.navigate) {
              await context.browser.navigate(payload.url);
            }
            nextTask.status = "completed";
            this.recordMetric("successfulAutomations", 1);
            this.recordMetric("queueCompleted", 1);
            this.recordMetric("estimatedMinutesSaved", clampNumber(payload.estimatedMinutesSaved, 0, 240, 2));
          }
        } catch (error) {
          nextTask.status = "failed";
          nextTask.lastError = summarizeText(error?.message || error || "", 240);
          nextTask.possibleFix = this.language.startsWith("ko")
            ? "브라우저 컨텍스트나 계정 인증 상태를 다시 확인해 주세요."
            : "Re-check the browser context and account authentication state.";
          this.recordMetric("failedAutomations", 1);
          this.recordMetric("queueFailed", 1);
        }

        nextTask.attempts += 1;
        nextTask.updatedAt = nowIso(this.now());
        this.state.accountQueue.currentTaskId = "";
        await this.appendLog("[AccountQueue]", nextTask);
        await this.persistState();
      }
    })().finally(() => {
      this.queueRunner = null;
    });

    return this.queueRunner;
  }

  async accountQueueAdd(input = {}) {
    const task = normalizeQueueTask({
      accountId: input.accountId || input.identityKey || "default",
      provider: input.provider || input.site || "generic",
      type: input.type || input.taskType || "generic",
      priority: input.priority ?? 50,
      payload: {
        url: input.url || "",
        authBlocked: Boolean(input.authBlocked),
        estimatedMinutesSaved: input.estimatedMinutesSaved ?? 2
      }
    });
    this.state.accountQueue.tasks.push(task);
    await this.appendLog("[AccountQueue]", { action: "enqueue", task });
    await this.persistState();
    void this.processAccountQueue();
    return {
      ok: true,
      task
    };
  }

  async accountQueueList() {
    return {
      ok: true,
      queue: safeJsonClone(this.state.accountQueue)
    };
  }

  async accountQueueCancel(input = {}) {
    const taskId = summarizeText(input.taskId || input.sessionId || "", 120);
    const task = this.state.accountQueue.tasks.find((entry) => entry.taskId === taskId);
    if (!task) {
      return {
        ok: false,
        error: "Task not found."
      };
    }
    task.status = "cancelled";
    task.updatedAt = nowIso(this.now());
    await this.appendLog("[AccountQueue]", { action: "cancel", taskId });
    await this.persistState();
    return {
      ok: true,
      task
    };
  }
}

export async function createCompanionServices(options = {}) {
  const service = new CompanionServices(options);
  await service.initialize();
  return service;
}

export { CompanionServices };
