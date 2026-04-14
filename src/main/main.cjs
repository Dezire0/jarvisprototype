const fs = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow, globalShortcut, ipcMain, screen, session } = require("electron");
const { AssistantService } = require("./assistant-service.cjs");
const { BrowserService } = require("./browser-service.cjs");
const { CredentialStore } = require("./credential-store.cjs");
const { FileService } = require("./file-service.cjs");
const { ObsService } = require("./obs-service.cjs");
const { ScreenService } = require("./screen-service.cjs");
const { createAutomationAdapter } = require("./platform-adapters.cjs");
const { SettingsStore } = require("./settings-store.cjs");
const { TtsService } = require("./tts-service.cjs");

let popupWindow;
let settingsWindow;
let services;
let assistant;
let popupStateCache = null;
let popupDragState = null;

function ensureReadyServices() {
  if (!assistant || !services) {
    throw new Error("Assistant services are not ready yet.");
  }

  return {
    assistant,
    services
  };
}

async function createServices() {
  const credentials = new CredentialStore({ app });
  const settings = new SettingsStore({ app });
  await settings.load();
  const browser = new BrowserService({
    userDataDir: app.getPath("userData"),
    credentialStore: credentials
  });
  const files = new FileService({
    workspaceRoot: process.cwd()
  });
  const obs = new ObsService();
  const screenService = new ScreenService();
  const automation = createAutomationAdapter({
    screen: screenService
  });
  const tts = new TtsService({
    settingsStore: settings
  });

  services = {
    automation,
    browser,
    credentials,
    files,
    obs,
    screen: screenService,
    settings,
    tts
  };

  assistant = new AssistantService({
    automation,
    browser,
    credentials,
    files,
    obs,
    screen: screenService
  });
}

function getPopupStatePath() {
  return path.join(app.getPath("userData"), "popup-state.json");
}

async function loadPopupState() {
  if (popupStateCache) {
    return popupStateCache;
  }

  try {
    const raw = await fs.readFile(getPopupStatePath(), "utf8");
    popupStateCache = JSON.parse(raw);
  } catch (_error) {
    popupStateCache = null;
  }

  return popupStateCache;
}

async function savePopupState(bounds) {
  popupStateCache = bounds;

  try {
    await fs.writeFile(getPopupStatePath(), JSON.stringify(bounds, null, 2), "utf8");
  } catch (_error) {
    // Ignore persistence failures and keep the session running.
  }
}

function getCenteredPopupBounds(windowWidth, windowHeight) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display.workArea;

  return {
    x: Math.round(workArea.x + (workArea.width - windowWidth) / 2),
    y: Math.round(workArea.y + (workArea.height - windowHeight) / 2)
  };
}

function clampPopupBounds(bounds, windowWidth, windowHeight) {
  const point = {
    x: Number(bounds?.x) || 0,
    y: Number(bounds?.y) || 0
  };
  const display = screen.getDisplayNearestPoint(point);
  const workArea = display.workArea;
  const maxX = workArea.x + workArea.width - windowWidth;
  const maxY = workArea.y + workArea.height - windowHeight;

  return {
    x: Math.min(Math.max(point.x, workArea.x), maxX),
    y: Math.min(Math.max(point.y, workArea.y), maxY)
  };
}

async function resolvePopupBounds(windowWidth, windowHeight) {
  const persisted = await loadPopupState();

  if (!persisted) {
    return getCenteredPopupBounds(windowWidth, windowHeight);
  }

  return clampPopupBounds(persisted, windowWidth, windowHeight);
}

async function createPopupWindow() {
  const windowWidth = 430;
  const windowHeight = 560;
  const { x, y } = await resolvePopupBounds(windowWidth, windowHeight);

  popupWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    minWidth: 430,
    minHeight: 560,
    maxWidth: 430,
    maxHeight: 560,
    resizable: false,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    transparent: false,
    backgroundColor: "#050505",
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  popupWindow.on("moved", async () => {
    if (!popupWindow) {
      return;
    }

    const [nextX, nextY] = popupWindow.getPosition();
    await savePopupState({
      x: nextX,
      y: nextY
    });
  });

  popupWindow.on("closed", () => {
    popupWindow = null;
  });

  popupWindow.loadFile(path.join(__dirname, "../renderer/popup.html"));
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 980,
    height: 860,
    minWidth: 860,
    minHeight: 760,
    show: false,
    backgroundColor: "#0b0b0b",
    autoHideMenuBar: true,
    title: "자비스 고급 설정",
    webPreferences: {
      preload: path.join(__dirname, "../preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function openSettingsWindow() {
  if (!settingsWindow) {
    createSettingsWindow();
  }

  settingsWindow.show();
  settingsWindow.focus();
}

function showPopup(status = "listening") {
  if (!popupWindow) {
    return;
  }

  popupWindow.show();
  popupWindow.focus();
  popupWindow.webContents.send("assistant:wake-state", {
    source: "voice",
    status
  });
}

function hidePopup() {
  if (!popupWindow) {
    return;
  }

  popupWindow.hide();
}

function beginPopupDrag(pointer = {}) {
  if (!popupWindow) {
    return {
      ok: false
    };
  }

  const [windowX, windowY] = popupWindow.getPosition();
  popupDragState = {
    windowX,
    windowY,
    pointerX: Number(pointer.screenX) || 0,
    pointerY: Number(pointer.screenY) || 0
  };

  return {
    ok: true
  };
}

function updatePopupDrag(pointer = {}) {
  if (!popupWindow || !popupDragState) {
    return {
      ok: false
    };
  }

  const bounds = popupWindow.getBounds();
  const nextBounds = clampPopupBounds(
    {
      x: Math.round(popupDragState.windowX + ((Number(pointer.screenX) || 0) - popupDragState.pointerX)),
      y: Math.round(popupDragState.windowY + ((Number(pointer.screenY) || 0) - popupDragState.pointerY))
    },
    bounds.width,
    bounds.height
  );

  popupWindow.setPosition(nextBounds.x, nextBounds.y);
  return {
    ok: true,
    bounds: nextBounds
  };
}

function endPopupDrag() {
  popupDragState = null;
  return {
    ok: true
  };
}

async function dispatchTool(tool, payload = {}) {
  const { assistant: liveAssistant, services: liveServices } = ensureReadyServices();

  switch (tool) {
    case "popup:show":
      showPopup(payload.status || "listening");
      return {
        ok: true
      };
    case "apps:list": {
      const data = await liveServices.automation.listInstalledApps(payload);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "app:open": {
      const data = await liveServices.automation.execute({
        type: "open_app",
        target: payload.appName || payload.target
      });
      return {
        ok: true,
        tool,
        data
      };
    }
    case "app:action": {
      const data = await liveServices.automation.execute(payload);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "screen:ocr": {
      const data = await liveServices.screen.captureAndOcr();
      return {
        ok: true,
        tool,
        data
      };
    }
    case "screen:academic":
      return liveAssistant.handleScreenAcademic(
        payload.prompt || "Explain what is on my screen and help me study it."
      );
    case "browser:open": {
      const data = await liveServices.browser.open(payload.target);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "browser:search": {
      const data = await liveServices.browser.search(payload.query);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "browser:read": {
      const data = await liveServices.browser.readPage();
      return {
        ok: true,
        tool,
        data
      };
    }
    case "browser:login": {
      const data = await liveServices.browser.loginWithStoredCredential(payload.siteOrUrl);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "credentials:save": {
      const data = await liveServices.credentials.saveCredential(payload);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "credentials:list": {
      const data = await liveServices.credentials.listCredentials();
      return {
        ok: true,
        tool,
        data
      };
    }
    case "credentials:delete": {
      const data = await liveServices.credentials.deleteCredential(payload.siteOrUrl);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "obs:connect": {
      const data = await liveServices.obs.connect(payload);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "obs:status": {
      const data = await liveServices.obs.status();
      return {
        ok: true,
        tool,
        data
      };
    }
    case "obs:start": {
      const data = await liveServices.obs.startStream();
      return {
        ok: true,
        tool,
        data
      };
    }
    case "obs:stop": {
      const data = await liveServices.obs.stopStream();
      return {
        ok: true,
        tool,
        data
      };
    }
    case "obs:scene": {
      const data = await liveServices.obs.switchScene(payload.sceneName);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "file:read": {
      const data = await liveServices.files.readFile(payload.path);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "file:write": {
      const data = await liveServices.files.writeFile(payload.path, payload.content || "");
      return {
        ok: true,
        tool,
        data
      };
    }
    case "file:list": {
      const data = await liveServices.files.listDirectory(payload.path || ".");
      return {
        ok: true,
        tool,
        data
      };
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allow = ["audioCapture", "media", "display-capture"].includes(permission);
    callback(allow);
  });

  await createServices();
  await createPopupWindow();
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    showPopup("listening");
  });
  globalShortcut.register("CommandOrControl+,", openSettingsWindow);

  app.on("activate", async () => {
    if (!popupWindow) {
      await createPopupWindow();
    }

    showPopup("idle");
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle("assistant:submit-command", async (_event, input) => {
  return ensureReadyServices().assistant.handleInput(input);
});

ipcMain.handle("assistant:show-popup", async (_event, payload) => {
  showPopup(payload?.status || "listening");
  return {
    ok: true
  };
});

ipcMain.handle("assistant:hide-popup", async () => {
  hidePopup();
  return {
    ok: true
  };
});

ipcMain.handle("assistant:open-settings", async () => {
  openSettingsWindow();
  return {
    ok: true
  };
});

ipcMain.handle("assistant:start-popup-drag", async (_event, payload) => {
  return beginPopupDrag(payload);
});

ipcMain.handle("assistant:update-popup-drag", async (_event, payload) => {
  return updatePopupDrag(payload);
});

ipcMain.handle("assistant:end-popup-drag", async () => {
  return endPopupDrag();
});

ipcMain.handle("assistant:speak", async (_event, payload) => {
  return ensureReadyServices().services.tts.synthesize(payload);
});

ipcMain.handle("assistant:get-tts-settings", async () => {
  const { services: liveServices } = ensureReadyServices();
  const status = await liveServices.tts.status();

  return {
    settings: liveServices.settings.getTtsSettingsView(),
    status
  };
});

ipcMain.handle("assistant:save-tts-settings", async (_event, payload) => {
  const { services: liveServices } = ensureReadyServices();
  const settings = await liveServices.settings.updateTtsSettings(payload);
  const status = await liveServices.tts.status();

  return {
    settings,
    status
  };
});

ipcMain.handle("assistant:invoke-tool", async (_event, request) => {
  return dispatchTool(request.tool, request.payload);
});

ipcMain.handle("assistant:get-bootstrap", async () => {
  const { services: liveServices } = ensureReadyServices();
  const appCatalog = await liveServices.automation.listInstalledApps({
    limit: 1
  }).catch(() => ({
    totalCount: 0
  }));

  return {
    shortcut: "Cmd/Ctrl + Shift + Space",
    capabilities: {
      ...liveServices.automation.getCapabilities(),
      appCatalogCount: appCatalog.totalCount || 0,
      screenOcr: "tesseract-cli",
      browserAutomation: liveServices.browser.getProviderLabel(),
      obsControl: "obs-websocket-js",
      fileAutomation: "local-fs"
    },
    providers: {
      llm: "ollama",
      wakeWord: "speech-recognition wake phrase",
      stt: "webkitSpeechRecognition",
      tts: liveServices.tts.getProviderLabel(),
      browser: liveServices.browser.getProviderLabel()
    }
  };
});
