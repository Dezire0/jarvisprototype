const orb = document.getElementById("orb");
const newThreadButton = document.getElementById("newThreadButton");
const threadList = document.getElementById("threadList");
const threadHeading = document.getElementById("threadHeading");
const threadSubtitle = document.getElementById("threadSubtitle");
const statusGrid = document.getElementById("statusGrid");
const messages = document.getElementById("messages");
const actionChips = document.getElementById("actionChips");
const openQuickPanelButton = document.getElementById("openQuickPanelButton");
const commandForm = document.getElementById("commandForm");
const commandInput = document.getElementById("commandInput");
const submitButton = document.getElementById("submitButton");
const shortcutHint = document.getElementById("shortcutHint");
const wakeToggle = document.getElementById("wakeToggle");
const muteToggle = document.getElementById("muteToggle");
const voiceOnceButton = document.getElementById("voiceOnceButton");
const voiceCallToggle = document.getElementById("voiceCallToggle");
const speechLanguage = document.getElementById("speechLanguage");
const voiceSelect = document.getElementById("voiceSelect");
const previewVoiceButton = document.getElementById("previewVoiceButton");
const speakReplies = document.getElementById("speakReplies");
const voiceStatus = document.getElementById("voiceStatus");
const callModeHint = document.getElementById("callModeHint");
const ttsProviderStatus = document.getElementById("ttsProviderStatus");
const ttsProviderSummary = document.getElementById("ttsProviderSummary");
const ttsProviderEn = document.getElementById("ttsProviderEn");
const ttsProviderKo = document.getElementById("ttsProviderKo");
const elevenlabsApiKey = document.getElementById("elevenlabsApiKey");
const elevenlabsModelEn = document.getElementById("elevenlabsModelEn");
const elevenlabsModelKo = document.getElementById("elevenlabsModelKo");
const elevenlabsVoiceEn = document.getElementById("elevenlabsVoiceEn");
const elevenlabsVoiceKo = document.getElementById("elevenlabsVoiceKo");
const naverClovaClientId = document.getElementById("naverClovaClientId");
const naverClovaClientSecret = document.getElementById("naverClovaClientSecret");
const naverClovaSpeakerKo = document.getElementById("naverClovaSpeakerKo");
const naverClovaSpeakerEn = document.getElementById("naverClovaSpeakerEn");
const geminiApiKey = document.getElementById("geminiApiKey");
const geminiModel = document.getElementById("geminiModel");
const geminiVoiceEn = document.getElementById("geminiVoiceEn");
const geminiVoiceKo = document.getElementById("geminiVoiceKo");
const openaiApiKey = document.getElementById("openaiApiKey");
const openaiModel = document.getElementById("openaiModel");
const openaiVoiceEn = document.getElementById("openaiVoiceEn");
const openaiVoiceKo = document.getElementById("openaiVoiceKo");
const cartesiaApiKey = document.getElementById("cartesiaApiKey");
const cartesiaModelId = document.getElementById("cartesiaModelId");
const cartesiaVoiceEn = document.getElementById("cartesiaVoiceEn");
const cartesiaVoiceKo = document.getElementById("cartesiaVoiceKo");
const googleCredentialsPath = document.getElementById("googleCredentialsPath");
const saveTtsSettingsButton = document.getElementById("saveTtsSettingsButton");
const refreshTtsSettingsButton = document.getElementById("refreshTtsSettingsButton");
const ocrScreenButton = document.getElementById("ocrScreenButton");
const academicScreenButton = document.getElementById("academicScreenButton");
const browserReadButton = document.getElementById("browserReadButton");
const obsStatusButton = document.getElementById("obsStatusButton");
const startStreamButton = document.getElementById("startStreamButton");
const stopStreamButton = document.getElementById("stopStreamButton");
const browserTarget = document.getElementById("browserTarget");
const browserOpenButton = document.getElementById("browserOpenButton");
const browserSearchButton = document.getElementById("browserSearchButton");
const browserLoginButton = document.getElementById("browserLoginButton");
const credentialSite = document.getElementById("credentialSite");
const credentialLoginUrl = document.getElementById("credentialLoginUrl");
const credentialUsername = document.getElementById("credentialUsername");
const credentialPassword = document.getElementById("credentialPassword");
const saveCredentialButton = document.getElementById("saveCredentialButton");
const listCredentialsButton = document.getElementById("listCredentialsButton");
const credentialList = document.getElementById("credentialList");
const obsAddress = document.getElementById("obsAddress");
const obsPassword = document.getElementById("obsPassword");
const obsSceneName = document.getElementById("obsSceneName");
const obsConnectButton = document.getElementById("obsConnectButton");
const obsSceneButton = document.getElementById("obsSceneButton");
const filePath = document.getElementById("filePath");
const fileContent = document.getElementById("fileContent");
const fileReadButton = document.getElementById("fileReadButton");
const fileWriteButton = document.getElementById("fileWriteButton");
const fileListButton = document.getElementById("fileListButton");
const refreshAppsButton = document.getElementById("refreshAppsButton");
const showAppsButton = document.getElementById("showAppsButton");
const appSearchInput = document.getElementById("appSearchInput");
const appSummary = document.getElementById("appSummary");
const appResults = document.getElementById("appResults");
const appControlTarget = document.getElementById("appControlTarget");
const appControlText = document.getElementById("appControlText");
const appControlMenu = document.getElementById("appControlMenu");
const appOpenButton = document.getElementById("appOpenButton");
const appFocusButton = document.getElementById("appFocusButton");
const appTypeButton = document.getElementById("appTypeButton");
const appSearchButton = document.getElementById("appSearchButton");
const appEnterButton = document.getElementById("appEnterButton");
const appNewItemButton = document.getElementById("appNewItemButton");
const appMenuButton = document.getElementById("appMenuButton");
const missionButtons = Array.from(document.querySelectorAll(".mission-button:not(.chip-button)"));
const chipButtons = Array.from(document.querySelectorAll(".chip-button"));

const state = {
  recognition: null,
  recognitionRunning: false,
  wakeEnabled: false,
  callModeEnabled: false,
  waitingForVoiceCommand: false,
  recognitionMode: "idle",
  manualRecognitionReason: "",
  commandTimeout: null,
  pendingRecognitionStart: null,
  pendingRecognitionTimer: null,
  appSearchDebounce: null,
  voicesLoaded: false,
  currentAudio: null,
  currentUtterance: null,
  speechSession: null,
  muted: false,
  submitInFlight: false,
  appCatalog: [],
  appCatalogTotalCount: 0,
  threads: [],
  currentThreadId: "",
  lastActions: []
};

const VOICE_STORAGE_KEY = "jarvis-selected-voice";
const LANGUAGE_STORAGE_KEY = "jarvis-speech-language";
const SPEAK_REPLIES_KEY = "jarvis-speak-replies";
const CALL_MODE_STORAGE_KEY = "jarvis-call-mode";
const THREAD_STORAGE_KEY = "jarvis-thread-state-v2";

function escapeHtml(text = "") {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createThreadRecord(title = "New Chat") {
  const now = Date.now();
  return {
    id: `thread-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    messages: [],
    updatedAt: now
  };
}

function sanitizeStoredThreads(rawThreads = []) {
  if (!Array.isArray(rawThreads) || !rawThreads.length) {
    return [createThreadRecord()];
  }

  const threads = rawThreads
    .filter((thread) => thread && typeof thread === "object")
    .map((thread) => ({
      id: String(thread.id || createThreadRecord().id),
      title: String(thread.title || "New Chat"),
      updatedAt: Number(thread.updatedAt) || Date.now(),
      messages: Array.isArray(thread.messages)
        ? thread.messages
            .filter((message) => message && typeof message === "object")
            .map((message) => ({
              id: String(message.id || `message-${Date.now()}`),
              role: message.role === "user" ? "user" : "assistant",
              content: String(message.content || ""),
              detail: String(message.detail || ""),
              createdAt: Number(message.createdAt) || Date.now()
            }))
        : []
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return threads.length ? threads : [createThreadRecord()];
}

function saveThreadState() {
  localStorage.setItem(
    THREAD_STORAGE_KEY,
    JSON.stringify({
      currentThreadId: state.currentThreadId,
      threads: state.threads
    })
  );
}

function loadThreadState() {
  try {
    const raw = localStorage.getItem(THREAD_STORAGE_KEY);

    if (!raw) {
      state.threads = [createThreadRecord()];
      state.currentThreadId = state.threads[0].id;
      return;
    }

    const parsed = JSON.parse(raw);
    state.threads = sanitizeStoredThreads(parsed.threads);
    state.currentThreadId =
      state.threads.find((thread) => thread.id === parsed.currentThreadId)?.id || state.threads[0].id;
  } catch (_error) {
    state.threads = [createThreadRecord()];
    state.currentThreadId = state.threads[0].id;
  }
}

function getCurrentThread() {
  let current = state.threads.find((thread) => thread.id === state.currentThreadId);

  if (!current) {
    current = state.threads[0] || createThreadRecord();

    if (!state.threads.length) {
      state.threads = [current];
    }

    state.currentThreadId = current.id;
  }

  return current;
}

function buildThreadTitle(text = "") {
  const compact = String(text).trim().replace(/\s+/g, " ");
  return compact ? compact.slice(0, 40) : "New Chat";
}

function moveCurrentThreadToTop() {
  const current = getCurrentThread();
  state.threads = [current, ...state.threads.filter((thread) => thread.id !== current.id)];
}

function renderThreadList() {
  if (!threadList) {
    return;
  }

  threadList.innerHTML = "";

  state.threads.forEach((thread) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `thread-list-item ${thread.id === state.currentThreadId ? "active" : ""}`;
    const lastMessage = thread.messages[thread.messages.length - 1];
    item.innerHTML = `
      <span class="thread-list-title">${escapeHtml(thread.title || "New Chat")}</span>
      <span class="thread-list-preview">${escapeHtml(lastMessage?.content || "Start a new conversation")}</span>
    `;
    item.addEventListener("click", () => {
      state.currentThreadId = thread.id;
      renderThreadList();
      renderCurrentThread();
      saveThreadState();
    });
    threadList.appendChild(item);
  });
}

function renderWelcomeThread() {
  messages.innerHTML = `
    <section class="welcome-panel">
      <div class="orb" aria-hidden="true"></div>
      <h2 class="welcome-title">Hello there!</h2>
      <p class="welcome-subtitle">자비스와 자연스럽게 대화하세요. 답변, 추천, 앱 제어, 브라우저 작업을 한 흐름 안에서 이어갈 수 있습니다.</p>
      <div class="welcome-suggestions">
        <button type="button" class="suggestion-card" data-prompt="오늘 해야 할 일 우선순위 정리해줘">
          <span class="suggestion-title">오늘 우선순위 정리</span>
          <span class="suggestion-label">지금 해야 할 일을 짧게 정리받기</span>
        </button>
        <button type="button" class="suggestion-card" data-prompt="크롬 켜고 Gmail 열어줘">
          <span class="suggestion-title">브라우저 작업 시작</span>
          <span class="suggestion-label">앱 열기와 사이트 진입을 바로 시작</span>
        </button>
        <button type="button" class="suggestion-card" data-prompt="지금 화면에서 중요한 것만 설명해줘">
          <span class="suggestion-title">현재 화면 브리핑</span>
          <span class="suggestion-label">화면 읽기와 요약 흐름 시작</span>
        </button>
        <button type="button" class="suggestion-card" data-prompt="설치된 앱 목록 보여줘">
          <span class="suggestion-title">앱 자동화 준비</span>
          <span class="suggestion-label">설치 앱과 제어 가능한 범위 확인</span>
        </button>
      </div>
    </section>
  `;

  messages.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", async () => {
      const prompt = button.getAttribute("data-prompt") || "";
      await runPresetCommand(prompt);
    });
  });
}

function renderCurrentThread() {
  const thread = getCurrentThread();
  const userMessages = thread.messages.filter((message) => message.role === "user").length;

  if (threadHeading) {
    threadHeading.textContent = thread.title || "New Chat";
  }

  if (threadSubtitle) {
    threadSubtitle.textContent = userMessages
      ? `메시지 ${thread.messages.length}개 · 가장 최근에 이어진 작업 스레드입니다.`
      : "새 스레드에서 자비스와 대화를 시작해 보세요.";
  }

  messages.innerHTML = "";

  if (!thread.messages.length) {
    renderWelcomeThread();
    return;
  }

  thread.messages.forEach((message) => {
    const article = document.createElement("article");
    article.className = `message ${message.role}`;
    const detailBlock = message.detail ? `<pre>${escapeHtml(message.detail)}</pre>` : "";
    article.innerHTML = `
      <span class="label">${message.role === "assistant" ? "Jarvis" : "You"}</span>
      <div class="message-body">
        <p>${escapeHtml(message.content)}</p>
        ${detailBlock}
      </div>
    `;
    messages.appendChild(article);
  });

  messages.scrollTop = messages.scrollHeight;
}

function addMessage(role, content, detail = "") {
  const thread = getCurrentThread();
  const isFirstUserMessage = role === "user" && !thread.messages.some((message) => message.role === "user");

  thread.messages.push({
    id: `message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    detail,
    createdAt: Date.now()
  });
  thread.updatedAt = Date.now();

  if (isFirstUserMessage) {
    thread.title = buildThreadTitle(content);
  }

  moveCurrentThreadToTop();
  renderThreadList();
  renderCurrentThread();
  saveThreadState();
}

function setWakeState(status) {
  orb.classList.toggle("listening", status === "listening");
}

function renderStatusCards(entries) {
  statusGrid.innerHTML = "";

  entries.forEach(([key, value]) => {
    const card = document.createElement("article");
    card.className = "status-card";
    card.innerHTML = `
      <span class="key">${escapeHtml(key)}</span>
      <span class="value">${escapeHtml(String(value))}</span>
    `;
    statusGrid.appendChild(card);
  });
}

function renderActions(actions) {
  actionChips.innerHTML = "";

  if (!actions?.length) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = "아직 실행 기록이 없어요";
    actionChips.appendChild(chip);
    return;
  }

  actions.forEach((action) => {
    const chip = document.createElement("span");
    chip.className = `chip ${action.status === "skipped" ? "skipped" : ""}`;
    chip.textContent = `${action.type} -> ${action.target} (${action.status})`;
    actionChips.appendChild(chip);
  });
}

function setCommandInputValue(value) {
  commandInput.value = value;
  commandInput.focus();
  commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length);
}

function fillAppTarget(value) {
  appControlTarget.value = value;
  browserTarget.value = browserTarget.value || value;
}

function renderAppResults(apps = []) {
  appResults.innerHTML = "";

  if (!apps.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "현재 검색과 일치하는 앱이 없어요.";
    appResults.appendChild(emptyState);
    return;
  }

  apps.forEach((app) => {
    const row = document.createElement("article");
    row.className = "app-row";
    row.innerHTML = `
      <div class="app-meta">
        <span class="app-name">${escapeHtml(app.name)}</span>
        <span class="app-path">${escapeHtml(app.path || "")}</span>
      </div>
      <button type="button" class="secondary">열기</button>
    `;

    const openButton = row.querySelector("button");
    row.addEventListener("click", () => {
      fillAppTarget(app.name);
    });
    openButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      fillAppTarget(app.name);
      await invokeTool("app:open", { appName: app.name }, `${app.name}을(를) 열었어요.`);
    });

    appResults.appendChild(row);
  });
}

async function refreshAppCatalog(query = appSearchInput.value.trim(), forceRefresh = false) {
  appSummary.textContent = "설치된 앱 목록을 불러오는 중...";

  try {
    const result = await window.assistantAPI.invokeTool("apps:list", {
      query,
      limit: query ? 60 : 80,
      forceRefresh
    });
    const data = result.data || {
      apps: [],
      totalCount: 0,
      resultCount: 0
    };
    state.appCatalog = data.apps || [];
    state.appCatalogTotalCount = data.totalCount || 0;
    appSummary.textContent = query
      ? `설치된 앱 ${data.totalCount}개 중 ${data.resultCount}개를 찾았어요.`
      : `설치된 앱 ${data.totalCount}개를 읽었어요. 원하는 앱을 골라 바로 제어할 수 있어요.`;
    renderAppResults(state.appCatalog);
  } catch (error) {
    state.appCatalog = [];
    state.appCatalogTotalCount = 0;
    appSummary.textContent = `앱 목록을 불러오지 못했어요: ${error.message}`;
    renderAppResults([]);
  }
}

async function runDirectAppAction(payload, successSummary) {
  const target = appControlTarget.value.trim();

  if (!target) {
    addMessage("assistant", "어느 앱에서 작업할지 먼저 선택해 주세요.");
    appControlTarget.focus();
    return null;
  }

  fillAppTarget(target);
  return invokeTool(
    "app:action",
    {
      target,
      ...payload
    },
    successSummary
  );
}

async function runPresetCommand(command) {
  setCommandInputValue(command);
  await submitCommandText(command);
}

function updateVoiceStatus(text) {
  voiceStatus.textContent = text;
}

function clearPendingRecognitionTimer() {
  if (state.pendingRecognitionTimer) {
    clearTimeout(state.pendingRecognitionTimer);
    state.pendingRecognitionTimer = null;
  }
}

function clearCommandTimeout() {
  if (state.commandTimeout) {
    clearTimeout(state.commandTimeout);
    state.commandTimeout = null;
  }
}

function resolveSpeechSession() {
  if (state.speechSession?.resolve) {
    state.speechSession.resolve();
  }

  state.speechSession = null;
}

function createSpeechSession() {
  resolveSpeechSession();

  return new Promise((resolve) => {
    let settled = false;

    state.speechSession = {
      resolve: () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }
    };
  });
}

function stopAudioPlayback() {
  if (state.currentAudio) {
    state.currentAudio.onended = null;
    state.currentAudio.onerror = null;
    state.currentAudio.pause();
    state.currentAudio = null;
  }

  if (state.currentUtterance) {
    state.currentUtterance.onend = null;
    state.currentUtterance.onerror = null;
    state.currentUtterance = null;
  }

  window.speechSynthesis?.cancel();
  resolveSpeechSession();
}

function syncWakeButton() {
  if (!wakeToggle) {
    return;
  }

  wakeToggle.textContent = state.wakeEnabled ? "Wake Word On" : "Wake Word";
  wakeToggle.classList.toggle("active", state.wakeEnabled);
}

function syncMuteButton() {
  if (!muteToggle) {
    return;
  }

  muteToggle.textContent = state.muted ? "Jarvis Voice Off" : "Jarvis Voice On";
  muteToggle.classList.toggle("active", !state.muted);
}

function applyMuteState(muted) {
  state.muted = Boolean(muted);

  if (state.muted) {
    stopAudioPlayback();
  }

  syncMuteButton();
}

function syncCallModeButton() {
  if (!voiceCallToggle) {
    return;
  }

  voiceCallToggle.textContent = state.callModeEnabled ? "Call Mode On" : "Call Mode";
  voiceCallToggle.classList.toggle("active", state.callModeEnabled);

  if (callModeHint) {
    callModeHint.textContent = state.callModeEnabled
      ? "통화 모드가 켜져 있어요. 답이 끝나면 자동으로 다시 듣고, 필요하면 중간에 바로 끊고 말할 수 있어요."
      : "통화 모드를 켜면 응답 후 자동으로 다시 듣고, 중간에 바로 다시 말할 수도 있어요.";
  }
}

function syncVoiceOnceButton() {
  if (!voiceOnceButton) {
    return;
  }

  const isManualListening = state.recognitionMode === "manual" && state.waitingForVoiceCommand;
  voiceOnceButton.textContent = isManualListening ? "Listening..." : "Voice Once";
  voiceOnceButton.classList.toggle("active", isManualListening);
}

function applyCallModeState(enabled) {
  state.callModeEnabled = Boolean(enabled);
  localStorage.setItem(CALL_MODE_STORAGE_KEY, state.callModeEnabled ? "1" : "0");
  syncCallModeButton();
}

function requestRecognitionStart(mode, options = {}) {
  const { delayMs = 0, reason = "" } = options;
  clearPendingRecognitionTimer();

  const startRequestedMode = () => {
    state.pendingRecognitionTimer = null;

    if (state.recognitionRunning) {
      state.pendingRecognitionStart = {
        mode,
        reason
      };

      try {
        state.recognition?.stop();
      } catch (_error) {
        // Ignore "already stopped" races and let onend settle the restart.
      }
      return;
    }

    if (mode === "wake") {
      startWakeRecognition();
      return;
    }

    startManualRecognition(reason || "single-turn");
  };

  if (delayMs > 0) {
    state.pendingRecognitionTimer = setTimeout(startRequestedMode, delayMs);
    return;
  }

  startRequestedMode();
}

function buildProviderConfiguredLabel(name, configured) {
  return `${name} ${configured ? "연결됨" : "미연결"}`;
}

function updateTtsSummary(status, settings) {
  const configured = status?.configuredProviders || {};
  const summaryParts = [
    buildProviderConfiguredLabel("ElevenLabs", configured.elevenlabs),
    buildProviderConfiguredLabel("NAVER CLOVA", configured.naverClova),
    buildProviderConfiguredLabel("Gemini", configured.gemini),
    buildProviderConfiguredLabel("OpenAI", configured.openai),
    buildProviderConfiguredLabel("Cartesia", configured.cartesia),
    buildProviderConfiguredLabel("Google", configured.googleCloud)
  ];

  ttsProviderStatus.textContent = status?.message || "TTS 연결 상태를 불러오는 중이에요.";
  ttsProviderSummary.textContent = [
    `영어: ${settings?.providers?.en || "auto"}`,
    `한국어: ${settings?.providers?.ko || "auto"}`,
    summaryParts.join(" · ")
  ].join(" / ");
}

function populateTtsSettings(payload = {}) {
  const settings = payload.settings || {};
  const eleven = settings.elevenlabs || {};
  const naver = settings.naverClova || {};
  const gemini = settings.gemini || {};
  const openai = settings.openai || {};
  const cartesia = settings.cartesia || {};
  const google = settings.google || {};

  ttsProviderEn.value = settings.providers?.en || "auto";
  ttsProviderKo.value = settings.providers?.ko || "auto";

  elevenlabsModelEn.value = eleven.modelEn || "eleven_flash_v2_5";
  elevenlabsModelKo.value = eleven.modelKo || "eleven_multilingual_v2";
  elevenlabsVoiceEn.value = eleven.voiceEn || "";
  elevenlabsVoiceKo.value = eleven.voiceKo || "";

  naverClovaSpeakerKo.value = naver.speakerKo || "vyuna";
  naverClovaSpeakerEn.value = naver.speakerEn || "matt";

  geminiModel.value = gemini.model || "gemini-3.1-flash-tts-preview";
  geminiVoiceEn.value = gemini.voiceEn || "Aoede";
  geminiVoiceKo.value = gemini.voiceKo || "Kore";

  openaiModel.value = openai.model || "gpt-4o-mini-tts";
  openaiVoiceEn.value = openai.voiceEn || "marin";
  openaiVoiceKo.value = openai.voiceKo || "marin";

  cartesiaModelId.value = cartesia.modelId || "sonic-3";
  cartesiaVoiceEn.value = cartesia.voiceEn || "";
  cartesiaVoiceKo.value = cartesia.voiceKo || "";

  googleCredentialsPath.value = google.credentialsPath || "";

  elevenlabsApiKey.value = "";
  naverClovaClientId.value = "";
  naverClovaClientSecret.value = "";
  geminiApiKey.value = "";
  openaiApiKey.value = "";
  cartesiaApiKey.value = "";

  updateTtsSummary(payload.status, settings);
}

async function loadTtsSettings(showMessage = false) {
  try {
    const payload = await window.assistantAPI.getTtsSettings();
    populateTtsSettings(payload);

    if (showMessage) {
      addMessage("assistant", "음성 엔진 상태를 새로 읽어왔어요.");
    }
  } catch (error) {
    ttsProviderStatus.textContent = `TTS 상태를 읽지 못했어요: ${error.message}`;
  }
}

async function saveTtsSettings() {
  const payload = {
    providers: {
      en: ttsProviderEn.value,
      ko: ttsProviderKo.value
    },
    elevenlabs: {
      apiKey: elevenlabsApiKey.value,
      modelEn: elevenlabsModelEn.value.trim(),
      modelKo: elevenlabsModelKo.value.trim(),
      voiceEn: elevenlabsVoiceEn.value.trim(),
      voiceKo: elevenlabsVoiceKo.value.trim()
    },
    naverClova: {
      clientId: naverClovaClientId.value.trim(),
      clientSecret: naverClovaClientSecret.value.trim(),
      speakerKo: naverClovaSpeakerKo.value.trim(),
      speakerEn: naverClovaSpeakerEn.value.trim()
    },
    gemini: {
      apiKey: geminiApiKey.value,
      model: geminiModel.value.trim(),
      voiceEn: geminiVoiceEn.value.trim(),
      voiceKo: geminiVoiceKo.value.trim()
    },
    openai: {
      apiKey: openaiApiKey.value,
      model: openaiModel.value.trim(),
      voiceEn: openaiVoiceEn.value.trim(),
      voiceKo: openaiVoiceKo.value.trim()
    },
    cartesia: {
      apiKey: cartesiaApiKey.value,
      modelId: cartesiaModelId.value.trim(),
      voiceEn: cartesiaVoiceEn.value.trim(),
      voiceKo: cartesiaVoiceKo.value.trim()
    },
    google: {
      credentialsPath: googleCredentialsPath.value.trim()
    }
  };

  try {
    const result = await window.assistantAPI.saveTtsSettings(payload);
    populateTtsSettings(result);
    addMessage("assistant", "음성 설정을 저장했어요. 이제 미리듣기와 실제 응답에 바로 반영됩니다.");
  } catch (error) {
    addMessage("assistant", `음성 설정 저장 중 문제가 있었어요: ${error.message}`);
  }
}

function scoreVoice(voice, selectedLanguage) {
  const name = `${voice.name} ${voice.voiceURI || ""}`.toLowerCase();
  const lang = (voice.lang || "").toLowerCase();
  const baseLanguage = selectedLanguage.slice(0, 2).toLowerCase();
  let score = 0;

  if (lang.startsWith(baseLanguage)) {
    score += 50;
  }

  if (lang === selectedLanguage.toLowerCase()) {
    score += 25;
  }

  ["siri", "premium", "enhanced", "natural", "neural"].forEach((keyword, index) => {
    if (name.includes(keyword)) {
      score += 20 - index;
    }
  });

  if (baseLanguage === "ko") {
    ["yuna", "sora", "korean"].forEach((keyword, index) => {
      if (name.includes(keyword)) {
        score += 18 - index;
      }
    });
  }

  if (baseLanguage === "en") {
    ["samantha", "aaron", "nicky", "daniel", "ava", "allison"].forEach((keyword, index) => {
      if (name.includes(keyword)) {
        score += 18 - index;
      }
    });
  }

  return score;
}

function getVoicesForLanguage(selectedLanguage = speechLanguage.value) {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const baseLanguage = selectedLanguage.slice(0, 2).toLowerCase();
  return voices
    .filter((voice) => (voice.lang || "").toLowerCase().startsWith(baseLanguage))
    .sort((left, right) => scoreVoice(right, selectedLanguage) - scoreVoice(left, selectedLanguage));
}

function populateVoiceOptions() {
  const voices = getVoicesForLanguage();
  const savedVoiceUri = localStorage.getItem(VOICE_STORAGE_KEY);
  const previousValue = voiceSelect.value || savedVoiceUri;

  voiceSelect.innerHTML = "";

  if (!voices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "기본 음성";
    voiceSelect.appendChild(option);
    return;
  }

  voices.forEach((voice, index) => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})${index === 0 ? " 추천" : ""}`;
    voiceSelect.appendChild(option);
  });

  const matchingValue = voices.find((voice) => voice.voiceURI === previousValue)?.voiceURI || voices[0].voiceURI;
  voiceSelect.value = matchingValue;
  localStorage.setItem(VOICE_STORAGE_KEY, matchingValue);
}

function chooseVoice() {
  const allVoices = window.speechSynthesis?.getVoices?.() || [];
  const selectedVoiceUri = voiceSelect.value || localStorage.getItem(VOICE_STORAGE_KEY);

  if (selectedVoiceUri) {
    const selectedVoice = allVoices.find((voice) => voice.voiceURI === selectedVoiceUri);
    if (selectedVoice) {
      return selectedVoice;
    }
  }

  const voices = getVoicesForLanguage();
  return voices[0] || allVoices[0] || null;
}

function detectLanguage(text = "") {
  const koreanCount = (String(text).match(/[가-힣]/g) || []).length;
  const englishCount = (String(text).match(/[A-Za-z]/g) || []).length;

  if (koreanCount === 0 && englishCount === 0) {
    return speechLanguage.value.startsWith("ko") ? "ko" : "en";
  }

  return koreanCount >= englishCount ? "ko" : "en";
}

async function fallbackSpeakText(text, language = detectLanguage(text)) {
  if (state.muted || !("speechSynthesis" in window) || !text) {
    return;
  }

  stopAudioPlayback();

  const speechSession = createSpeechSession();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 500));
  utterance.voice = chooseVoice();
  utterance.lang = utterance.voice?.lang || (language === "ko" ? "ko-KR" : "en-US");
  utterance.rate = language === "ko" ? 1 : 0.98;
  utterance.pitch = language === "ko" ? 1.02 : 1;
  utterance.onend = () => {
    state.currentUtterance = null;
    resolveSpeechSession();
  };
  utterance.onerror = () => {
    state.currentUtterance = null;
    resolveSpeechSession();
  };

  state.currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
  await speechSession;
}

async function speakText(text, language = detectLanguage(text)) {
  if (state.muted || !speakReplies.checked || !text) {
    return;
  }

  stopAudioPlayback();

  try {
    const result = await window.assistantAPI.speak({
      text,
      language
    });

    if (result?.muted) {
      return;
    }

    if (result.audioBase64) {
      const speechSession = createSpeechSession();
      const audio = new Audio(`data:${result.mimeType || "audio/wav"};base64,${result.audioBase64}`);
      audio.onended = () => {
        if (state.currentAudio === audio) {
          state.currentAudio = null;
        }
        resolveSpeechSession();
      };
      audio.onerror = () => {
        if (state.currentAudio === audio) {
          state.currentAudio = null;
        }
        resolveSpeechSession();
      };

      state.currentAudio = audio;
      await audio.play();
      await speechSession;
      return;
    }
  } catch (_error) {
    // Fall back to browser TTS below.
  }

  await fallbackSpeakText(text, language);
}

function getRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function detectWakeWord(text) {
  const lowered = text.toLowerCase();
  const words = ["jarvis", "자비스"];
  return words.find((word) => lowered.includes(word)) || "";
}

function stripWakeWord(text, wakeWord) {
  if (!wakeWord) {
    return text.trim();
  }

  return text.replace(new RegExp(wakeWord, "ig"), "").replace(/^[,\s]+/, "").trim();
}

async function handleAssistantResult(result) {
  const previewText = result.details?.showInlinePreview === true
    ? result.details?.ocrText || result.details?.text || result.details?.content || ""
    : "";

  addMessage(
    "assistant",
    result.reply || "처리를 마쳤어요.",
    previewText
  );
  renderActions(result.actions || []);
  await speakText(result.reply || "", result.language || detectLanguage(result.reply || ""));
}

async function submitCommandText(input, options = {}) {
  if (!input) {
    return;
  }

  const source = options.source || "text";
  const shouldResumeCall = state.callModeEnabled && source === "voice";

  addMessage("user", input);
  state.submitInFlight = true;
  setWakeState("listening");
  submitButton.disabled = true;

  try {
    const result = await window.assistantAPI.submitCommand(input);
    await handleAssistantResult(result);
  } catch (error) {
    addMessage("assistant", `처리 중 문제가 있었어요: ${error.message}`);
    await speakText(`처리 중 문제가 있었어요. ${error.message}`, detectLanguage(error.message || ""));
  } finally {
    state.submitInFlight = false;
    submitButton.disabled = false;
    commandInput.value = "";
    setWakeState("idle");

    if (shouldResumeCall) {
      updateVoiceStatus("이어서 듣고 있어요...");
      requestRecognitionStart("manual", {
        reason: "call-mode",
        delayMs: 380
      });
    } else if (state.wakeEnabled) {
      updateVoiceStatus("웨이크워드를 듣는 중이에요.");
    } else if (!state.callModeEnabled) {
      updateVoiceStatus("음성 대기 중이 아니에요.");
    }
  }
}

async function invokeTool(tool, payload = {}, successSummary) {
  try {
    const result = await window.assistantAPI.invokeTool(tool, payload);

    if (result.reply) {
      await handleAssistantResult(result);
      return result;
    }

    const detail = result.data ? JSON.stringify(result.data, null, 2) : "";
    addMessage("assistant", successSummary || `${tool} 작업을 마쳤어요.`, detail);
    return result;
  } catch (error) {
    addMessage("assistant", `${tool} 작업 중 문제가 있었어요: ${error.message}`);
    throw error;
  }
}

function buildRecognition() {
  const Recognition = getRecognitionConstructor();

  if (!Recognition) {
    throw new Error("현재 환경에서는 음성 인식을 사용할 수 없어요.");
  }

  const recognition = new Recognition();
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    state.recognitionRunning = true;
    syncVoiceOnceButton();
  };

  recognition.onresult = async (event) => {
    let finalTranscript = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript?.trim();

      if (result.isFinal && transcript) {
        finalTranscript += `${transcript} `;
      }
    }

    const transcript = finalTranscript.trim();

    if (!transcript) {
      return;
    }

    if (state.waitingForVoiceCommand && state.recognitionMode === "wake") {
      const repeatedWakeWord = detectWakeWord(transcript);
      const followUpCommand = stripWakeWord(transcript, repeatedWakeWord);

      if (followUpCommand) {
        state.waitingForVoiceCommand = false;
        clearCommandTimeout();
        syncVoiceOnceButton();
        updateVoiceStatus("이어서 말씀하신 내용을 실행할게요...");
        await submitCommandText(followUpCommand, {
          source: "voice"
        });
      }

      return;
    }

    if (state.recognitionMode === "manual" && state.waitingForVoiceCommand) {
      state.waitingForVoiceCommand = false;
      state.manualRecognitionReason = state.manualRecognitionReason || "single-turn";
      syncVoiceOnceButton();
      updateVoiceStatus("말씀하신 내용을 처리하고 있어요...");
      await submitCommandText(transcript, {
        source: "voice"
      });
      return;
    }

    const wakeWord = detectWakeWord(transcript);

    if (!wakeWord) {
      return;
    }

    const directCommand = stripWakeWord(transcript, wakeWord);

    if (directCommand) {
      updateVoiceStatus("호출어를 감지했어요. 바로 실행할게요...");
      await submitCommandText(directCommand, {
        source: "voice"
      });
      return;
    }

    state.waitingForVoiceCommand = true;
    syncVoiceOnceButton();
    updateVoiceStatus("호출어를 감지했어요. 이어서 말씀해 주세요...");
    void speakText(speechLanguage.value.startsWith("ko") ? "네, 말씀하세요." : "Yes, I'm listening.");

    clearCommandTimeout();
    state.commandTimeout = setTimeout(() => {
      state.waitingForVoiceCommand = false;
      syncVoiceOnceButton();
      updateVoiceStatus("웨이크워드를 듣는 중이에요.");
    }, 7000);
  };

  recognition.onerror = (event) => {
    if (event.error === "aborted") {
      return;
    }

    if (event.error === "no-speech") {
      updateVoiceStatus(
        state.callModeEnabled ? "아직 말씀이 없어서 잠깐 후 다시 들을게요." : "말씀을 더 또렷하게 해주시면 바로 다시 들을게요."
      );
      return;
    }

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      state.wakeEnabled = false;
      applyCallModeState(false);
      syncWakeButton();
      updateVoiceStatus("마이크 권한이 필요해요. 브라우저나 앱 권한에서 마이크를 허용해 주세요.");
      return;
    }

    updateVoiceStatus(`음성 인식 오류: ${event.error}`);
  };

  recognition.onend = () => {
    const previousMode = state.recognitionMode;
    const previousManualReason = state.manualRecognitionReason;
    const pendingStart = state.pendingRecognitionStart;

    state.recognitionRunning = false;
    state.pendingRecognitionStart = null;
    state.recognitionMode = "idle";
    state.manualRecognitionReason = "";
    setWakeState("idle");
    syncVoiceOnceButton();

    if (pendingStart) {
      setTimeout(() => {
        requestRecognitionStart(pendingStart.mode, {
          reason: pendingStart.reason
        });
      }, 140);
      return;
    }

    if (state.wakeEnabled && previousMode === "wake") {
      requestRecognitionStart("wake", {
        delayMs: 300
      });
      return;
    }

    if (state.callModeEnabled && previousMode === "manual" && previousManualReason === "call-mode" && !state.submitInFlight) {
      requestRecognitionStart("manual", {
        reason: "call-mode",
        delayMs: 520
      });
      return;
    }
  };

  return recognition;
}

function getRecognition() {
  if (!state.recognition) {
    state.recognition = buildRecognition();
  }

  return state.recognition;
}

function startWakeRecognition() {
  const recognition = getRecognition();
  clearPendingRecognitionTimer();
  clearCommandTimeout();
  recognition.lang = speechLanguage.value;
  recognition.continuous = true;
  state.recognitionMode = "wake";
  state.wakeEnabled = true;
  state.waitingForVoiceCommand = false;
  state.manualRecognitionReason = "";
  setWakeState("listening");
  updateVoiceStatus("웨이크워드를 듣는 중이에요.");
  syncWakeButton();
  syncVoiceOnceButton();

  try {
    recognition.start();
  } catch (_error) {
    // Recognition may already be running.
  }
}

function stopWakeRecognition() {
  state.wakeEnabled = false;
  state.waitingForVoiceCommand = false;
  clearPendingRecognitionTimer();
  clearCommandTimeout();
  updateVoiceStatus("웨이크워드는 꺼져 있어요.");
  syncWakeButton();
  syncVoiceOnceButton();

  if (state.recognition) {
    state.recognitionMode = "idle";
    state.recognition.stop();
  }

  setWakeState("idle");
}

function startManualRecognition(reason = "single-turn") {
  const recognition = getRecognition();
  clearPendingRecognitionTimer();
  recognition.lang = speechLanguage.value;
  recognition.continuous = false;
  state.recognitionMode = "manual";
  state.waitingForVoiceCommand = true;
  state.manualRecognitionReason = reason;
  setWakeState("listening");
  updateVoiceStatus(reason === "call-mode" ? "통화 모드로 듣는 중이에요..." : "한 번만 듣는 중이에요...");
  syncVoiceOnceButton();

  try {
    recognition.start();
  } catch (_error) {
    updateVoiceStatus("음성 인식이 이미 켜져 있어요.");
  }
}

async function refreshCredentialList() {
  try {
    const result = await window.assistantAPI.invokeTool("credentials:list");
    credentialList.innerHTML = "";

    if (!result.data?.length) {
      credentialList.innerHTML = '<span class="credential-chip">저장된 로그인 정보가 아직 없어요</span>';
      return;
    }

    result.data.forEach((entry) => {
      const chip = document.createElement("span");
      chip.className = "credential-chip";
      chip.textContent = `${entry.site} · ${entry.username}`;
      credentialList.appendChild(chip);
    });
  } catch (error) {
    addMessage("assistant", `저장된 로그인 정보를 불러오지 못했어요: ${error.message}`);
  }
}

window.assistantAPI.onWakeState((payload) => {
  setWakeState(payload.status);
});

window.assistantAPI.onMuteState((payload) => {
  applyMuteState(payload?.muted);
});

commandForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitCommandText(commandInput.value.trim());
});

chipButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const command = button.dataset.command?.trim();

    if (!command) {
      return;
    }

    await runPresetCommand(command);
  });
});

missionButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const command = button.dataset.command?.trim();

    if (!command) {
      return;
    }

    await runPresetCommand(command);
  });
});

newThreadButton?.addEventListener("click", () => {
  const thread = createThreadRecord();
  state.threads = [thread, ...state.threads];
  state.currentThreadId = thread.id;
  renderThreadList();
  renderCurrentThread();
  saveThreadState();
  commandInput.focus();
});

wakeToggle.addEventListener("click", () => {
  if (state.wakeEnabled) {
    stopWakeRecognition();
  } else {
    try {
      if (state.callModeEnabled) {
        applyCallModeState(false);
      }

      requestRecognitionStart("wake");
    } catch (error) {
      addMessage("assistant", error.message);
    }
  }
});

muteToggle?.addEventListener("click", async () => {
  const result = await window.assistantAPI.toggleMute();
  applyMuteState(result?.muted);
});

voiceOnceButton.addEventListener("click", () => {
  try {
    stopAudioPlayback();
    requestRecognitionStart("manual", {
      reason: state.callModeEnabled ? "call-mode" : "single-turn"
    });
  } catch (error) {
    addMessage("assistant", error.message);
  }
});

voiceCallToggle?.addEventListener("click", () => {
  try {
    if (state.callModeEnabled) {
      applyCallModeState(false);
      clearPendingRecognitionTimer();

      if (state.recognitionMode === "manual" && state.recognition) {
        state.waitingForVoiceCommand = false;
        syncVoiceOnceButton();
        state.recognition.stop();
      }

      updateVoiceStatus("통화 모드를 껐어요.");
      return;
    }

    if (state.wakeEnabled) {
      stopWakeRecognition();
    }

    stopAudioPlayback();
    applyCallModeState(true);
    requestRecognitionStart("manual", {
      reason: "call-mode",
      delayMs: 120
    });
  } catch (error) {
    addMessage("assistant", error.message);
  }
});

speechLanguage.addEventListener("change", () => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, speechLanguage.value);
  populateVoiceOptions();

  if (state.wakeEnabled) {
    stopWakeRecognition();
    requestRecognitionStart("wake", {
      delayMs: 150
    });
  }

  if (state.callModeEnabled) {
    requestRecognitionStart("manual", {
      reason: "call-mode",
      delayMs: 150
    });
  }
});

voiceSelect.addEventListener("change", () => {
  if (voiceSelect.value) {
    localStorage.setItem(VOICE_STORAGE_KEY, voiceSelect.value);
  }
});

speakReplies.addEventListener("change", () => {
  localStorage.setItem(SPEAK_REPLIES_KEY, speakReplies.checked ? "1" : "0");
});

previewVoiceButton.addEventListener("click", () => {
  const previewText = speechLanguage.value.startsWith("ko")
    ? "안녕하세요. 자비스 음성 미리듣기입니다."
    : "Hello. This is the Jarvis voice preview.";
  void speakText(previewText, speechLanguage.value.startsWith("ko") ? "ko" : "en");
});

saveTtsSettingsButton.addEventListener("click", () => {
  void saveTtsSettings();
});

refreshTtsSettingsButton.addEventListener("click", () => {
  void loadTtsSettings(true);
});

appSearchInput.addEventListener("input", () => {
  clearTimeout(state.appSearchDebounce);
  state.appSearchDebounce = setTimeout(() => {
    void refreshAppCatalog();
  }, 180);
});

appSearchInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    await refreshAppCatalog();
  }
});

refreshAppsButton.addEventListener("click", async () => {
  await refreshAppCatalog(appSearchInput.value.trim(), true);
});

showAppsButton.addEventListener("click", async () => {
  await runPresetCommand("설치된 앱 목록 보여줘");
});

appOpenButton.addEventListener("click", async () => {
  const target = appControlTarget.value.trim();

  if (!target) {
    addMessage("assistant", "어떤 앱을 열지 먼저 선택해 주세요.");
    return;
  }

  await invokeTool("app:open", { appName: target }, `${target}을(를) 열었어요.`);
});

appFocusButton.addEventListener("click", async () => {
  await runDirectAppAction(
    {
      type: "focus_app"
    },
    `Focused ${appControlTarget.value.trim()}.`
  );
});

appTypeButton.addEventListener("click", async () => {
  const text = appControlText.value.trim();

  if (!text) {
    addMessage("assistant", "입력할 문장을 먼저 적어 주세요.");
    return;
  }

  await runDirectAppAction(
    {
      type: "app_type",
      text
    },
    `Typed inside ${appControlTarget.value.trim()}.`
  );
});

appSearchButton.addEventListener("click", async () => {
  const target = appControlTarget.value.trim();
  const text = appControlText.value.trim();

  if (!target || !text) {
    addMessage("assistant", "앱과 검색어를 먼저 입력해 주세요.");
    return;
  }

  await submitCommandText(`${target}에서 ${text} 검색해`);
});

appEnterButton.addEventListener("click", async () => {
  await runDirectAppAction(
    {
      type: "app_key",
      key: "enter",
      modifiers: []
    },
    `Pressed Enter in ${appControlTarget.value.trim()}.`
  );
});

appNewItemButton.addEventListener("click", async () => {
  await runDirectAppAction(
    {
      type: "app_shortcut",
      key: "n",
      modifiers: ["command"]
    },
    `Created a new item in ${appControlTarget.value.trim()}.`
  );
});

appMenuButton.addEventListener("click", async () => {
  const menuPath = appControlMenu.value
    .split(/>|\/|→|›/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!menuPath.length) {
    addMessage("assistant", "예: File > New Window 같은 메뉴 경로를 먼저 적어 주세요.");
    return;
  }

  await runDirectAppAction(
    {
      type: "app_menu_click",
      menuPath
    },
    `Clicked ${menuPath.join(" > ")} in ${appControlTarget.value.trim()}.`
  );
});

ocrScreenButton.addEventListener("click", async () => {
  const result = await invokeTool("screen:ocr", {}, "화면을 읽고 OCR을 실행했어요.");
  renderActions([
    {
      type: "screen_ocr",
      target: `chars:${result.data.text.length}`,
      status: "executed"
    }
  ]);
});

academicScreenButton.addEventListener("click", async () => {
  const prompt = commandInput.value.trim() || "Explain what is on my screen and help me understand it.";
  await invokeTool("screen:academic", { prompt });
});

browserReadButton.addEventListener("click", async () => {
  await invokeTool("browser:read", {}, "현재 브라우저 페이지를 읽어왔어요.");
});

obsStatusButton.addEventListener("click", async () => {
  await invokeTool("obs:status", {}, "OBS 상태를 확인했어요.");
});

startStreamButton.addEventListener("click", async () => {
  await invokeTool("obs:start", {}, "OBS 방송 시작을 요청했어요.");
});

stopStreamButton.addEventListener("click", async () => {
  await invokeTool("obs:stop", {}, "OBS 방송 종료를 요청했어요.");
});

browserOpenButton.addEventListener("click", async () => {
  await invokeTool("browser:open", { target: browserTarget.value.trim() }, "브라우저에서 해당 대상을 열었어요.");
});

browserSearchButton.addEventListener("click", async () => {
  await invokeTool("browser:search", { query: browserTarget.value.trim() }, "브라우저 검색을 실행했어요.");
});

browserLoginButton.addEventListener("click", async () => {
  await invokeTool(
    "browser:login",
    { siteOrUrl: browserTarget.value.trim() || credentialSite.value.trim() },
    "저장된 로그인 정보를 현재 사이트에 입력했어요."
  );
});

saveCredentialButton.addEventListener("click", async () => {
  await invokeTool(
    "credentials:save",
    {
      site: credentialSite.value.trim(),
      loginUrl: credentialLoginUrl.value.trim(),
      username: credentialUsername.value.trim(),
      password: credentialPassword.value
    },
    "로그인 정보를 로컬 보안 저장소에 저장했어요."
  );

  credentialPassword.value = "";
  await refreshCredentialList();
});

listCredentialsButton.addEventListener("click", refreshCredentialList);

obsConnectButton.addEventListener("click", async () => {
  await invokeTool(
    "obs:connect",
    {
      address: obsAddress.value.trim(),
      password: obsPassword.value
    },
    "OBS에 연결했어요."
  );
});

obsSceneButton.addEventListener("click", async () => {
  await invokeTool(
    "obs:scene",
    {
      sceneName: obsSceneName.value.trim()
    },
    "OBS 씬을 전환했어요."
  );
});

fileReadButton.addEventListener("click", async () => {
  const result = await invokeTool("file:read", { path: filePath.value.trim() }, "파일을 읽어왔어요.");
  fileContent.value = result.data.content;
});

fileWriteButton.addEventListener("click", async () => {
  await invokeTool(
    "file:write",
    {
      path: filePath.value.trim(),
      content: fileContent.value
    },
    "파일에 저장했어요."
  );
});

fileListButton.addEventListener("click", async () => {
  await invokeTool("file:list", { path: filePath.value.trim() || "." }, "폴더 목록을 읽어왔어요.");
});

async function bootstrap() {
  const data = await window.assistantAPI.getBootstrap();
  const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  const storedSpeakReplies = localStorage.getItem(SPEAK_REPLIES_KEY);
  const storedCallMode = localStorage.getItem(CALL_MODE_STORAGE_KEY);

  loadThreadState();
  renderThreadList();
  renderCurrentThread();

  if (storedLanguage) {
    speechLanguage.value = storedLanguage;
  }

  if (storedSpeakReplies !== null) {
    speakReplies.checked = storedSpeakReplies !== "0";
  }

  applyCallModeState(storedCallMode !== "0");

  shortcutHint.textContent = data.shortcut;
  applyMuteState(data.mute?.muted);
  syncWakeButton();
  syncVoiceOnceButton();
  renderStatusCards([
    ["LLM", data.providers.llm],
    ["웨이크워드", data.providers.wakeWord],
    ["STT / TTS", `${data.providers.stt} / ${data.providers.tts}`],
    ["브라우저", data.providers.browser],
    ["앱", `${data.capabilities.appAutomation || "basic"} · ${data.capabilities.appCatalogCount || 0}`],
    ["확장", data.capabilities.extensions
      ? `hooks ${data.capabilities.extensions.webhooks} · skills ${data.capabilities.extensions.skills} · connectors ${data.capabilities.extensions.connectors}`
      : "none"],
    ["로그인 보관", data.capabilities.credentialHandling],
    ["OCR / OBS", `${data.capabilities.screenOcr} / ${data.capabilities.obsControl}`]
  ]);
  renderActions([]);

  refreshCredentialList();
  refreshAppCatalog();
  loadTtsSettings();

  if ("speechSynthesis" in window) {
    const loadVoices = () => {
      populateVoiceOptions();
      state.voicesLoaded = true;
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  if (state.callModeEnabled) {
    try {
      requestRecognitionStart("manual", {
        reason: "call-mode",
        delayMs: 650
      });
    } catch (error) {
      updateVoiceStatus(error.message);
    }
  }
}

bootstrap();
