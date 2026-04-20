const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("assistantAPI", {
  getBootstrap() {
    return ipcRenderer.invoke("assistant:get-bootstrap");
  },
  getAppState() {
    return ipcRenderer.invoke("assistant:get-app-state");
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
  checkForUpdates() {
    return ipcRenderer.invoke("assistant:check-for-updates");
  },
  installUpdate() {
    return ipcRenderer.invoke("assistant:install-update");
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
  }
});
