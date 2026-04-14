const orb = document.getElementById("orb");
const popupStatus = document.getElementById("popupStatus");
const messages = document.getElementById("messages");
const commandForm = document.getElementById("commandForm");
const commandInput = document.getElementById("commandInput");
const submitButton = document.getElementById("submitButton");
const shortcutHint = document.getElementById("shortcutHint");
const openSettingsButton = document.getElementById("openSettingsButton");
const windowBar = document.querySelector(".window-bar");

const VOICE_STORAGE_KEY = "jarvis-selected-voice";
const LANGUAGE_STORAGE_KEY = "jarvis-speech-language";
const SPEAK_REPLIES_KEY = "jarvis-speak-replies";
const MAX_VISIBLE_MESSAGES = 4;
const UI_TEXT = {
  ko: {
    assistant: "자비스",
    user: "사용자",
    working: "처리 중이에요...",
    ready: "다음 요청을 말씀해 주세요.",
    listening: "듣고 있어요...",
    error: "문제가 생겼어요.",
    shortcut: "Esc로 숨기기",
    welcome: "안녕하세요. 편하게 말씀해 주세요. 필요한 작업은 자연스럽게 이어서 처리하겠습니다.",
    placeholder: "무엇을 도와드릴까요?"
  },
  en: {
    assistant: "Jarvis",
    user: "You",
    working: "Working on it...",
    ready: "Ready for your next request.",
    listening: "Listening...",
    error: "Something went wrong.",
    shortcut: "Esc to hide",
    welcome: "Hello. Speak naturally and I will either respond, recommend a next step, or carry it out for you.",
    placeholder: "What would you like me to do?"
  }
};

let currentLanguage = "ko";
let currentAudio = null;
let isDraggingWindow = false;

function escapeHtml(text = "") {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function addMessage(role, content) {
  const labels = UI_TEXT[currentLanguage] || UI_TEXT.en;
  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.innerHTML = `
    <span class="label">${role === "assistant" ? labels.assistant : labels.user}</span>
    <p>${escapeHtml(content)}</p>
  `;
  messages.appendChild(article);
  trimMessageHistory();
  messages.scrollTop = messages.scrollHeight;
}

function trimMessageHistory() {
  while (messages.children.length > MAX_VISIBLE_MESSAGES) {
    messages.removeChild(messages.firstElementChild);
  }
}

function seedWelcomeMessage(language = currentLanguage) {
  const labels = UI_TEXT[language] || UI_TEXT.en;
  messages.innerHTML = "";
  addMessage("assistant", labels.welcome);
}

function setWakeState(status) {
  orb.classList.toggle("listening", status === "listening");
}

function updateStatus(text) {
  popupStatus.textContent = text;
}

function detectLanguage(text = "") {
  const koreanCount = (String(text).match(/[가-힣]/g) || []).length;
  const englishCount = (String(text).match(/[A-Za-z]/g) || []).length;

  if (koreanCount === 0 && englishCount === 0) {
    return currentLanguage;
  }

  return koreanCount >= englishCount ? "ko" : "en";
}

function getSpeechLocale(language = currentLanguage) {
  return language === "ko" ? "ko-KR" : "en-US";
}

function getUiText(key, language = currentLanguage) {
  return (UI_TEXT[language] || UI_TEXT.en)[key];
}

function setConversationLanguage(language) {
  currentLanguage = language === "ko" ? "ko" : "en";
  commandInput.placeholder = getUiText("placeholder");
}

function chooseStoredVoice() {
  const allVoices = window.speechSynthesis?.getVoices?.() || [];
  const selectedVoiceUri = localStorage.getItem(VOICE_STORAGE_KEY);

  if (selectedVoiceUri) {
    const selected = allVoices.find((voice) => voice.voiceURI === selectedVoiceUri);
    if (selected) {
      return selected;
    }
  }

  const selectedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) || "ko-KR";
  return allVoices.find((voice) => (voice.lang || "").toLowerCase().startsWith(selectedLanguage.slice(0, 2).toLowerCase())) || allVoices[0] || null;
}

function fallbackSpeak(text, language = currentLanguage) {
  const selectedLanguage = getSpeechLocale(language);

  if (!("speechSynthesis" in window)) {
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text.slice(0, 420));
  utterance.voice = chooseStoredVoice();
  utterance.lang = utterance.voice?.lang || selectedLanguage;
  utterance.rate = selectedLanguage.startsWith("ko") ? 1 : 0.98;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

async function speakText(text, language = currentLanguage) {
  const shouldSpeak = localStorage.getItem(SPEAK_REPLIES_KEY) !== "0";
  if (!shouldSpeak || !text) {
    return;
  }

  setConversationLanguage(language);
  window.speechSynthesis?.cancel();

  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  try {
    const result = await window.assistantAPI.speak({
      text,
      language
    });

    if (result.audioBase64) {
      currentAudio = new Audio(`data:${result.mimeType || "audio/wav"};base64,${result.audioBase64}`);
      currentAudio.volume = 1;
      await currentAudio.play();
      return;
    }
  } catch (_error) {
    // Fall back to browser TTS below.
  }

  fallbackSpeak(text, language);
}

async function submitCommand(input) {
  if (!input) {
    return;
  }

  const inputLanguage = detectLanguage(input);
  setConversationLanguage(inputLanguage);
  addMessage("user", input);
  setWakeState("listening");
  updateStatus(getUiText("working", inputLanguage));
  submitButton.disabled = true;

  try {
    const result = await window.assistantAPI.submitCommand(input);
    setConversationLanguage(result.language || inputLanguage);
    addMessage("assistant", result.reply || "Done.");
    void speakText(result.reply || "", result.language || inputLanguage);
    updateStatus(getUiText("ready", result.language || inputLanguage));
    commandInput.value = "";
  } catch (error) {
    setConversationLanguage(inputLanguage);
    addMessage(
      "assistant",
      inputLanguage === "ko" ? `처리 중 문제가 있었어요: ${error.message}` : `Request failed: ${error.message}`
    );
    updateStatus(getUiText("error", inputLanguage));
  } finally {
    submitButton.disabled = false;
    setWakeState("idle");
    commandInput.focus();
  }
}

window.assistantAPI.onWakeState((payload) => {
  setWakeState(payload.status);
  updateStatus(payload.status === "listening" ? getUiText("listening") : getUiText("ready"));
});

commandForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitCommand(commandInput.value.trim());
});

openSettingsButton.addEventListener("click", async () => {
  await window.assistantAPI.openSettings();
});

windowBar?.addEventListener("pointerdown", async (event) => {
  if (event.button !== 0 || event.target.closest("button, textarea, input")) {
    return;
  }

  isDraggingWindow = true;
  windowBar.setPointerCapture(event.pointerId);
  await window.assistantAPI.startPopupDrag({
    screenX: event.screenX,
    screenY: event.screenY
  });
});

windowBar?.addEventListener("pointermove", (event) => {
  if (!isDraggingWindow) {
    return;
  }

  void window.assistantAPI.updatePopupDrag({
    screenX: event.screenX,
    screenY: event.screenY
  });
});

function finishWindowDrag(event) {
  if (!isDraggingWindow) {
    return;
  }

  isDraggingWindow = false;

  if (windowBar?.hasPointerCapture?.(event.pointerId)) {
    windowBar.releasePointerCapture(event.pointerId);
  }

  void window.assistantAPI.endPopupDrag();
}

windowBar?.addEventListener("pointerup", finishWindowDrag);
windowBar?.addEventListener("pointercancel", finishWindowDrag);

window.addEventListener("keydown", async (event) => {
  if (event.key === "Escape") {
    await window.assistantAPI.hidePopup();
  }
});

async function bootstrap() {
  const data = await window.assistantAPI.getBootstrap();
  const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  setConversationLanguage(storedLanguage?.startsWith("en") ? "en" : "ko");
  seedWelcomeMessage(currentLanguage);
  shortcutHint.textContent = `${data.shortcut} · ${getUiText("shortcut")}`;
  updateStatus(getUiText("ready"));
  commandInput.focus();
}

bootstrap();
