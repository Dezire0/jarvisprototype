const orb = document.getElementById("orb");
const statusGrid = document.getElementById("statusGrid");
const messages = document.getElementById("messages");
const actionChips = document.getElementById("actionChips");
const commandForm = document.getElementById("commandForm");
const commandInput = document.getElementById("commandInput");
const submitButton = document.getElementById("submitButton");
const shortcutHint = document.getElementById("shortcutHint");
const wakeToggle = document.getElementById("wakeToggle");
const voiceOnceButton = document.getElementById("voiceOnceButton");
const speechLanguage = document.getElementById("speechLanguage");
const voiceSelect = document.getElementById("voiceSelect");
const previewVoiceButton = document.getElementById("previewVoiceButton");
const speakReplies = document.getElementById("speakReplies");
const voiceStatus = document.getElementById("voiceStatus");
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
const missionButtons = Array.from(document.querySelectorAll(".mission-button"));
const chipButtons = Array.from(document.querySelectorAll(".chip-button"));

const state = {
  recognition: null,
  wakeEnabled: false,
  waitingForVoiceCommand: false,
  recognitionMode: "idle",
  commandTimeout: null,
  appSearchDebounce: null,
  voicesLoaded: false,
  currentAudio: null,
  appCatalog: [],
  appCatalogTotalCount: 0
};

const VOICE_STORAGE_KEY = "jarvis-selected-voice";
const LANGUAGE_STORAGE_KEY = "jarvis-speech-language";
const SPEAK_REPLIES_KEY = "jarvis-speak-replies";

function escapeHtml(text = "") {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function addMessage(role, content, detail = "") {
  const article = document.createElement("article");
  article.className = `message ${role}`;

  const paragraphs = [`<p>${escapeHtml(content)}</p>`];

  if (detail) {
    paragraphs.push(`<pre>${escapeHtml(detail)}</pre>`);
  }

  article.innerHTML = `
    <span class="label">${role === "assistant" ? "자비스" : "사용자"}</span>
    ${paragraphs.join("")}
  `;

  messages.appendChild(article);
  messages.scrollTop = messages.scrollHeight;
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

function buildProviderConfiguredLabel(name, configured) {
  return `${name} ${configured ? "연결됨" : "미연결"}`;
}

function updateTtsSummary(status, settings) {
  const configured = status?.configuredProviders || {};
  const summaryParts = [
    buildProviderConfiguredLabel("ElevenLabs", configured.elevenlabs),
    buildProviderConfiguredLabel("NAVER CLOVA", configured.naverClova),
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

  cartesiaModelId.value = cartesia.modelId || "sonic-3";
  cartesiaVoiceEn.value = cartesia.voiceEn || "";
  cartesiaVoiceKo.value = cartesia.voiceKo || "";

  googleCredentialsPath.value = google.credentialsPath || "";

  elevenlabsApiKey.value = "";
  naverClovaClientId.value = "";
  naverClovaClientSecret.value = "";
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

function fallbackSpeakText(text, language = detectLanguage(text)) {
  if (!("speechSynthesis" in window) || !text) {
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text.slice(0, 500));
  utterance.voice = chooseVoice();
  utterance.lang = utterance.voice?.lang || (language === "ko" ? "ko-KR" : "en-US");
  utterance.rate = language === "ko" ? 1 : 0.98;
  utterance.pitch = language === "ko" ? 1.02 : 1;
  window.speechSynthesis.speak(utterance);
}

async function speakText(text, language = detectLanguage(text)) {
  if (!speakReplies.checked || !text) {
    return;
  }

  window.speechSynthesis?.cancel();

  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio = null;
  }

  try {
    const result = await window.assistantAPI.speak({
      text,
      language
    });

    if (result.audioBase64) {
      state.currentAudio = new Audio(`data:${result.mimeType || "audio/wav"};base64,${result.audioBase64}`);
      await state.currentAudio.play();
      return;
    }
  } catch (_error) {
    // Fall back to browser TTS below.
  }

  fallbackSpeakText(text, language);
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
  addMessage(
    "assistant",
    result.reply || "처리를 마쳤어요.",
    result.details?.ocrText || result.details?.text || result.details?.content || ""
  );
  renderActions(result.actions || []);
  void speakText(result.reply || "", result.language || detectLanguage(result.reply || ""));
}

async function submitCommandText(input) {
  if (!input) {
    return;
  }

  addMessage("user", input);
  setWakeState("listening");
  submitButton.disabled = true;

  try {
    const result = await window.assistantAPI.submitCommand(input);
    await handleAssistantResult(result);
  } catch (error) {
    addMessage("assistant", `처리 중 문제가 있었어요: ${error.message}`);
  } finally {
    submitButton.disabled = false;
    commandInput.value = "";
    setWakeState("idle");
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

    if (state.recognitionMode === "manual" && state.waitingForVoiceCommand) {
      state.waitingForVoiceCommand = false;
      updateVoiceStatus("말씀하신 내용을 처리하고 있어요...");
      await submitCommandText(transcript);
      return;
    }

    const wakeWord = detectWakeWord(transcript);

    if (!wakeWord) {
      return;
    }

    await window.assistantAPI.showPopup({
      status: "listening"
    });

    const directCommand = stripWakeWord(transcript, wakeWord);

    if (directCommand) {
      updateVoiceStatus("호출어를 감지했어요. 바로 실행할게요...");
      await submitCommandText(directCommand);
      return;
    }

    state.waitingForVoiceCommand = true;
    updateVoiceStatus("호출어를 감지했어요. 이어서 말씀해 주세요...");
    speakText(speechLanguage.value.startsWith("ko") ? "네, 말씀하세요." : "Yes, I'm listening.");

    clearTimeout(state.commandTimeout);
    state.commandTimeout = setTimeout(() => {
      state.waitingForVoiceCommand = false;
      updateVoiceStatus("웨이크워드를 듣는 중이에요.");
    }, 7000);
  };

  recognition.onerror = (event) => {
    updateVoiceStatus(`음성 인식 오류: ${event.error}`);
  };

  recognition.onend = () => {
    if (state.wakeEnabled && state.recognitionMode === "wake") {
      setTimeout(() => {
        try {
          startWakeRecognition();
        } catch (_error) {
          updateVoiceStatus("웨이크워드 듣기가 멈췄어요. 다시 켜 주세요.");
        }
      }, 300);
    } else {
      state.recognitionMode = "idle";
      setWakeState("idle");
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
  recognition.lang = speechLanguage.value;
  recognition.continuous = true;
  state.recognitionMode = "wake";
  state.wakeEnabled = true;
  setWakeState("listening");
  updateVoiceStatus("웨이크워드를 듣는 중이에요.");

  try {
    recognition.start();
  } catch (_error) {
    // Recognition may already be running.
  }
}

function stopWakeRecognition() {
  state.wakeEnabled = false;
  state.waitingForVoiceCommand = false;
  clearTimeout(state.commandTimeout);
  updateVoiceStatus("웨이크워드는 꺼져 있어요.");

  if (state.recognition) {
    state.recognitionMode = "idle";
    state.recognition.stop();
  }

  setWakeState("idle");
}

function startManualRecognition() {
  const recognition = getRecognition();
  recognition.lang = speechLanguage.value;
  recognition.continuous = false;
  state.recognitionMode = "manual";
  state.waitingForVoiceCommand = true;
  setWakeState("listening");
  updateVoiceStatus("한 번만 듣는 중이에요...");

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

wakeToggle.addEventListener("click", () => {
  if (state.wakeEnabled) {
    stopWakeRecognition();
    wakeToggle.textContent = "웨이크워드 켜기";
  } else {
    try {
      startWakeRecognition();
      wakeToggle.textContent = "웨이크워드 끄기";
    } catch (error) {
      addMessage("assistant", error.message);
    }
  }
});

voiceOnceButton.addEventListener("click", () => {
  try {
    startManualRecognition();
  } catch (error) {
    addMessage("assistant", error.message);
  }
});

speechLanguage.addEventListener("change", () => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, speechLanguage.value);
  populateVoiceOptions();
  if (state.wakeEnabled) {
    stopWakeRecognition();
    startWakeRecognition();
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

  if (storedLanguage) {
    speechLanguage.value = storedLanguage;
  }

  if (storedSpeakReplies !== null) {
    speakReplies.checked = storedSpeakReplies !== "0";
  }

  shortcutHint.textContent = data.shortcut;
  renderStatusCards([
    ["LLM", data.providers.llm],
    ["웨이크워드", data.providers.wakeWord],
    ["STT / TTS", `${data.providers.stt} / ${data.providers.tts}`],
    ["브라우저", data.providers.browser],
    ["앱", `${data.capabilities.appAutomation || "basic"} · ${data.capabilities.appCatalogCount || 0}`],
    ["로그인 보관", data.capabilities.credentialHandling],
    ["OCR / OBS", `${data.capabilities.screenOcr} / ${data.capabilities.obsControl}`]
  ]);

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
}

bootstrap();
