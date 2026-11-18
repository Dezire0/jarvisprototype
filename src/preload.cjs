const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("assistantAPI", {
  getBootstrap() {
    return ipcRenderer.invoke("assistant:get-bootstrap");
  },
  getAppState() {
    return ipcRenderer.invoke("assistant:get-app-state");
  },
  getLivePreview() {
    return ipcRenderer.invoke("assistant:get-live-preview");
  },
  getComputerControl() {
    return ipcRenderer.invoke("assistant:get-computer-control");
  },
  onFocusCommandInput(callback) {
    const listener = () => callback();
    ipcRenderer.on("assistant:focus-command-input", listener);
    return () => ipcRenderer.removeListener("assistant:focus-command-input", listener);
  },
  probeMacWakeSpeech(locale) {
    return ipcRenderer.invoke("assistant:probe-mac-wake-speech", locale);
  },
  startMacWakeSpeech(request) {
    return ipcRenderer.invoke("assistant:start-mac-wake-speech", request);
  },
  stopMacWakeSpeech(id) {
    return ipcRenderer.invoke("assistant:stop-mac-wake-speech", id);
  },
  onMacWakeSpeech(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("assistant:mac-wake-speech", listener);
    return () => ipcRenderer.removeListener("assistant:mac-wake-speech", listener);
  },
  setComputerControl(enabled) {
    return ipcRenderer.invoke("assistant:set-computer-control", enabled);
  },
  submitCommand(input) {
    return ipcRenderer.invoke("assistant:submit-command", input);
  },
  transcribeAudio(payload = {}) {
    return ipcRenderer.invoke("assistant:transcribe-audio", payload);
  },
  showPopup(payload = {}) {
    return ipcRenderer.invoke("assistant:show-popup", payload);
  },
  hidePopup() {
    return ipcRenderer.invoke("assistant:hide-popup");
  },
  openSettings() {
    return ipcRenderer.invoke("assistant:open-settings");
  },
  startPopupDrag(payload = {}) {
    return ipcRenderer.invoke("assistant:start-popup-drag", payload);
  },
  updatePopupDrag(payload = {}) {
    return ipcRenderer.invoke("assistant:update-popup-drag", payload);
  },
  endPopupDrag() {
    return ipcRenderer.invoke("assistant:end-popup-drag");
  },
  speak(payload = {}) {
    return ipcRenderer.invoke("assistant:speak", payload);
  },
  speakWorkspace(payload) {
    return ipcRenderer.invoke("assistant:speak-workspace", payload);
  },
  getMuteState() {
    return ipcRenderer.invoke("assistant:get-mute-state");
  },
  setMuteState(payload = {}) {
    return ipcRenderer.invoke("assistant:set-mute-state", payload);
  },
  toggleMute() {
    return ipcRenderer.invoke("assistant:toggle-mute");
  },
  getTtsSettings() {
    return ipcRenderer.invoke("assistant:get-tts-settings");
  },
  saveTtsSettings(payload = {}) {
    return ipcRenderer.invoke("assistant:save-tts-settings", payload);
  },
  getConversationModelSettings() {
    return ipcRenderer.invoke("assistant:get-conversation-model-settings");
  },
  saveConversationModelSettings(payload = {}) {
    return ipcRenderer.invoke("assistant:save-conversation-model-settings", payload);
  },
  testConversationModel() {
    return ipcRenderer.invoke("assistant:test-conversation-model");
  },
  checkForUpdates() {
    return ipcRenderer.invoke("assistant:check-for-updates");
  },
  installUpdate() {
    return ipcRenderer.invoke("assistant:install-update");
  },
  restoreAccountSession(allowLegacy) {
    return ipcRenderer.invoke("assistant:restore-account-session", allowLegacy);
  },
  saveAccountSession(payload) {
    return ipcRenderer.invoke("assistant:save-account-session", payload);
  },
  clearAccountSession() {
    return ipcRenderer.invoke("assistant:clear-account-session");
  },
  loadLocalWorkspace() {
    return ipcRenderer.invoke("assistant:load-local-workspace");
  },
  loadChatHistory(accountId) {
    return ipcRenderer.invoke("assistant:load-chat-history", accountId);
  },
  saveChatHistory(accountId, serialized) {
    return ipcRenderer.invoke("assistant:save-chat-history", accountId, serialized);
  },
  saveLocalWorkspace(serialized) {
    return ipcRenderer.invoke("assistant:save-local-workspace", serialized);
  },
  readHostDiagnostics() {
    return ipcRenderer.invoke("assistant:read-host-diagnostics");
  },
  invokeTool(tool, payload = {}) {
    return ipcRenderer.invoke("assistant:invoke-tool", {
      tool,
      payload
    });
  },
  onWakeState(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("assistant:wake-state", listener);
    return () => {
      ipcRenderer.removeListener("assistant:wake-state", listener);
    };
  },
  onMuteState(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("assistant:mute-state", listener);
    return () => {
      ipcRenderer.removeListener("assistant:mute-state", listener);
    };
  },
  onUpdateStatus(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("assistant:update-status", listener);
    return () => {
      ipcRenderer.removeListener("assistant:update-status", listener);
    };
  },
  onEvent(channel, callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  }
});
