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
  getTtsSettings() {
    return ipcRenderer.invoke("assistant:get-tts-settings");
  },
  saveTtsSettings(payload = {}) {
    return ipcRenderer.invoke("assistant:save-tts-settings", payload);
  },
  checkForUpdates() {
    return ipcRenderer.invoke("assistant:check-for-updates");
  },
  invokeTool(tool, payload = {}) {
    return ipcRenderer.invoke("assistant:invoke-tool", {
      tool,
      payload
    });
  },
  onWakeState(callback) {
    ipcRenderer.on("assistant:wake-state", (_event, payload) => callback(payload));
  },
  onUpdateStatus(callback) {
    ipcRenderer.on("assistant:update-status", (_event, payload) => callback(payload));
  }
});
