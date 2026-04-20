const { loadProjectEnv } = require("./project-env.cjs");

loadProjectEnv();

const fs = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow, Menu, globalShortcut, ipcMain, screen, session, safeStorage, shell } = require("electron");
const { AssistantService } = require("./assistant-service.cjs");
const { createAssistantTransportServer } = require("./assistant-transport-server.cjs");
const { BrowserService } = require("./browser-service.cjs");
const { CodeProjectService } = require("./code-project-service.cjs");
const { CredentialStore } = require("./credential-store.cjs");
const { DesktopUiServer } = require("./desktop-ui-server.cjs");
const { ExtensionsService } = require("./extensions-service.cjs");
const { FileService } = require("./file-service.cjs");
const { GameService } = require("./game-service.cjs");
const { getTierProviderLabel } = require("./ollama-service.cjs");
const { MemoryStore } = require("./memory-store.cjs");
const { ObsService } = require("./obs-service.cjs");
const { ScreenService } = require("./screen-service.cjs");
const { createAutomationAdapter } = require("./platform-adapters.cjs");
const { SettingsStore } = require("./settings-store.cjs");
const { SttService } = require("./stt-service.cjs");
const { TtsService } = require("./tts-service.cjs");
const { UpdaterService } = require("./updater-service.cjs");

const unofficialAI = require("./unofficial-ai-provider.cjs");
const piiManager = require("./pii-manager.cjs");
const osAutomation = require("./os-automation.cjs");
const notificationMonitor = require("./notification-monitor.cjs");

let popupWindow;
let settingsWindow;
let services;
let assistant;
let assistantTransportServer;
let desktopUiServer;
let desktopUiUrl = String(process.env.JARVIS_UI_URL || "").trim();
let updaterService;
let popupStateCache = null;
let popupDragState = null;
let assistantMuted = false;
const POPUP_ENABLED = String(process.env.JARVIS_POPUP_ENABLED || "0").trim() === "1";
const DESKTOP_UI_MODE = String(process.env.JARVIS_DESKTOP_UI_MODE || "next").trim().toLowerCase() === "next"
  ? "next"
  : "local";

function broadcastToWindows(channel, payload) {
  [popupWindow, settingsWindow].forEach((windowRef) => {
    if (!windowRef || windowRef.isDestroyed()) {
      return;
    }

    windowRef.webContents.send(channel, payload);
  });
}

function broadcastMuteState(source = "system") {
  broadcastToWindows("assistant:mute-state", {
    muted: assistantMuted,
    source
  });
}

function setAssistantMuted(nextValue, source = "system") {
  assistantMuted = Boolean(nextValue);
  broadcastMuteState(source);

  return {
    muted: assistantMuted
  };
}

function toggleAssistantMuted(source = "system") {
  return setAssistantMuted(!assistantMuted, source);
}

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
  const credentials = new CredentialStore({ app, safeStorage });
  const memory = new MemoryStore({ app });
  await memory.load();
  const settings = new SettingsStore({ app });
  await settings.load();
  const extensions = new ExtensionsService({ app });
  await extensions.load();
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
  const games = new GameService({
    automation
  });
  const codeProjects = new CodeProjectService({
    files,
    automation
  });
  const tts = new TtsService({
    settingsStore: settings
  });
  const stt = new SttService({
    settingsStore: settings
  });

  services = {
    automation,
    browser,
    codeProjects,
    credentials,
    extensions,
    files,
    games,
    memory,
    obs,
    screen: screenService,
    settings,
    stt,
    tts
  };

  assistant = new AssistantService({
    automation,
    browser,
    codeProjects,
    credentials,
    extensions,
    files,
    games,
    memory,
    obs,
    screen: screenService,
    tts
  });

  assistantTransportServer = createAssistantTransportServer({
    port: Number(process.env.JARVIS_ASSISTANT_PORT || 8010),
    createAssistantForThread() {
      return new AssistantService({
        automation,
        browser,
        codeProjects,
        credentials,
        extensions,
        files,
        games,
        memory,
        obs,
        screen: screenService,
        tts
      });
    }
  });

  await assistantTransportServer.start();
  process.env.JARVIS_TRANSPORT_URL = assistantTransportServer.url;
  process.env.NEXT_PUBLIC_API_URL = assistantTransportServer.url;
}

async function ensureDesktopUiServer() {
  if (DESKTOP_UI_MODE !== "next") {
    desktopUiUrl = "";
    return desktopUiUrl;
  }

  if (!desktopUiServer) {
    desktopUiServer = new DesktopUiServer({ app });
  }

  try {
    desktopUiUrl = await desktopUiServer.start();
  } catch (error) {
    console.error("Could not start bundled desktop UI server:", error);
    desktopUiUrl = String(process.env.JARVIS_UI_URL || "").trim();
  }

  return desktopUiUrl;
}

function getDesktopUiUrl() {
  if (DESKTOP_UI_MODE !== "next") {
    return "";
  }

  return desktopUiUrl || String(process.env.JARVIS_UI_URL || "").trim();
}

function buildApplicationMenu() {
  const updateMenuItem = {
    label: "Check for Updates...",
    click: () => updaterService?.checkForUpdates("manual")
  };
  const template = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        updateMenuItem,
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    });
  } else {
    template.push({
      label: "File",
      submenu: [
        updateMenuItem,
        { type: "separator" },
        { role: "quit" }
      ]
    });
  }

  const windowSubmenu = [
    {
      label: "Open Jarvis Desktop",
      click: () => openSettingsWindow()
    }
  ];

  if (POPUP_ENABLED) {
    windowSubmenu.push({
      label: "Show Quick Panel",
      click: () => showPopup("listening")
    });
  }

  windowSubmenu.push(
    { type: "separator" },
    { role: "minimize" },
    { role: "close" }
  );

  template.push({
    label: "Window",
    submenu: windowSubmenu
  });

  template.push({
    label: "Help",
    submenu: [
      {
        label: `Version ${app.getVersion()}`,
        enabled: false
      },
      updateMenuItem
    ]
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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

  popupWindow.webContents.on("did-finish-load", () => {
    broadcastMuteState("bootstrap");
  });

  popupWindow.loadFile(path.join(__dirname, "../renderer/popup.html"));
}

function createSettingsWindow() {
  console.log("Creating Jarvis Desktop window...");
  settingsWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 780,
    show: true,
    backgroundColor: "#07131a",
    autoHideMenuBar: true,
    title: "Jarvis Desktop",
    webPreferences: {
      preload: path.join(__dirname, "../preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const desktopUrl = getDesktopUiUrl();

  if (DESKTOP_UI_MODE === "next" && desktopUrl) {
    settingsWindow.loadURL(desktopUrl).catch(() => {
      console.error("Desktop UI URL load failed, falling back to local renderer.");
      settingsWindow?.loadFile(path.join(__dirname, "../renderer/index.html"));
    });
  } else {
    settingsWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url) {
      return {
        action: "deny"
      };
    }

    shell.openExternal(url).catch(() => {});
    return {
      action: "deny"
    };
  });

  settingsWindow.webContents.on("will-navigate", (event, url) => {
    const desktopOrigin = desktopUrl
      ? new URL(desktopUrl).origin
      : "";

    const targetOrigin = (() => {
      try {
        return new URL(url).origin;
      } catch (_error) {
        return "";
      }
    })();

    if (desktopOrigin && targetOrigin === desktopOrigin) {
      return;
    }

    if (url && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  settingsWindow.once("ready-to-show", () => {
    console.log("Jarvis Desktop window is ready to show.");
    if (!settingsWindow || settingsWindow.isDestroyed()) {
      return;
    }

    settingsWindow.show();
    settingsWindow.focus();
    settingsWindow.moveTop();
    app.focus({
      steal: true
    });
  });

  settingsWindow.webContents.on("did-finish-load", () => {
    console.log("Jarvis Desktop window finished loading.");
    broadcastMuteState("bootstrap");
  });

  settingsWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    console.error("Jarvis Desktop failed to load UI:", {
      errorCode,
      errorDescription,
      validatedUrl
    });
  });

  settingsWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Jarvis Desktop renderer process exited:", details);
  });

  setTimeout(() => {
    if (!settingsWindow || settingsWindow.isDestroyed()) {
      return;
    }

    if (!settingsWindow.isVisible()) {
      console.log("Forcing Jarvis Desktop window visible after startup timeout.");
      settingsWindow.show();
    }

    settingsWindow.focus();
    settingsWindow.moveTop();
    app.focus({
      steal: true
    });
  }, 1200);
}

function openSettingsWindow() {
  if (!settingsWindow) {
    createSettingsWindow();
  }

  if (settingsWindow.isMinimized()) {
    settingsWindow.restore();
  }

  settingsWindow.show();
  settingsWindow.focus();
  settingsWindow.moveTop();
  app.focus({
    steal: true
  });
}

function showPopup(status = "listening") {
  if (!POPUP_ENABLED || !popupWindow) {
    openSettingsWindow();
    broadcastToWindows("assistant:wake-state", {
      source: "voice",
      status
    });
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
  if (!POPUP_ENABLED || !popupWindow) {
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
    case "extensions:list":
      return {
        ok: true,
        tool,
        data: liveServices.extensions.list()
      };
    case "extensions:reload":
      return {
        ok: true,
        tool,
        data: await liveServices.extensions.load()
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
    case "games:list": {
      const data = await liveServices.games.listInstalledGames(payload);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "games:install": {
      const data = await liveServices.games.installGame(payload);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "games:update": {
      const data = await liveServices.games.updateGame(payload);
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
    case "ai:web-login": {
      const token = await unofficialAI.requireLogin();
      return {
        ok: !!token,
        tool,
        token: !!token
      };
    }
    case "ai:web-status": {
      const token = await unofficialAI.getAccessToken();
      return {
        ok: true,
        tool,
        connected: !!token
      };
    }
    case "pii:set": {
      piiManager.set(payload.key, payload.value);
      return { ok: true, tool };
    }
    case "pii:list": {
      return { ok: true, tool, keys: piiManager.getAvailableKeys() };
    }
    case "pii:delete": {
      piiManager.delete(payload.key);
      return { ok: true, tool };
    }
    case "os:notifications": {
      return { ok: true, tool, context: notificationMonitor.getAIContextString() };
    }
    case "project:create": {
      const data = await liveServices.codeProjects.createProject(
        payload.prompt || payload.input || ""
      );
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
  await ensureDesktopUiServer();
  updaterService = new UpdaterService({ app });
  await updaterService.init();
  buildApplicationMenu();
  if (POPUP_ENABLED) {
    await createPopupWindow();
  }
  createSettingsWindow();
  openSettingsWindow();
  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    if (POPUP_ENABLED) {
      showPopup("listening");
      return;
    }

    openSettingsWindow();
  });
  globalShortcut.register("CommandOrControl+,", openSettingsWindow);
  globalShortcut.register("F4", () => {
    toggleAssistantMuted("shortcut");
  });

  app.on("activate", async () => {
    if (!settingsWindow) {
      createSettingsWindow();
    }

    openSettingsWindow();
  });

  setTimeout(() => {
    updaterService?.checkForUpdates("startup").catch(() => {});
  }, 15_000);
}).catch((error) => {
  console.error("Jarvis Desktop failed to initialize:", error);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();

  if (assistantTransportServer) {
    assistantTransportServer.stop().catch(() => {});
  }

  if (desktopUiServer) {
    desktopUiServer.stop().catch(() => {});
  }
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
  if (assistantMuted) {
    return {
      muted: true
    };
  }

  return ensureReadyServices().services.tts.synthesize(payload);
});

ipcMain.handle("assistant:get-mute-state", async () => ({
  muted: assistantMuted
}));

ipcMain.handle("assistant:set-mute-state", async (_event, payload) => {
  return setAssistantMuted(payload?.muted, "renderer");
});

ipcMain.handle("assistant:toggle-mute", async () => {
  return toggleAssistantMuted("renderer");
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

ipcMain.handle("assistant:get-app-state", async () => {
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    desktopUiUrl: getDesktopUiUrl(),
    updater: updaterService ? updaterService.getStatus() : null,
    muted: assistantMuted
  };
});

ipcMain.handle("assistant:check-for-updates", async () => {
  return updaterService ? updaterService.checkForUpdates("manual") : null;
});

ipcMain.handle("assistant:install-update", async () => {
  return updaterService ? updaterService.installUpdate() : null;
});

ipcMain.handle("assistant:transcribe-audio", async (_event, payload = {}) => {
  const { services: liveServices } = ensureReadyServices();
  return liveServices.stt.transcribe(payload);
});

ipcMain.handle("assistant:get-bootstrap", async () => {
  const { services: liveServices } = ensureReadyServices();
  const appCatalog = await liveServices.automation.listInstalledApps({
    limit: 1
  }).catch(() => ({
    totalCount: 0
  }));

  return {
    shortcut: POPUP_ENABLED
      ? "Cmd/Ctrl + Shift + Space · 빠른 패널 / Cmd/Ctrl + , · Jarvis 앱 / F4 · 자비스 음성 음소거"
      : "Cmd/Ctrl + Shift + Space · Jarvis 앱 열기 / Cmd/Ctrl + , · Jarvis 앱 / F4 · 자비스 음성 음소거",
    capabilities: {
      ...liveServices.automation.getCapabilities(),
      appCatalogCount: appCatalog.totalCount || 0,
      screenOcr: "tesseract-cli",
      browserAutomation: liveServices.browser.getProviderLabel(),
      obsControl: "obs-websocket-js",
      fileAutomation: "local-fs",
      gameLaunchers: "steam+epic",
      codeProjects: "generated-projects",
      extensions: liveServices.extensions.getSummary()
    },
    providers: {
      llm: `${getTierProviderLabel("fast")} -> ${getTierProviderLabel("complex")}`,
      wakeWord: "speech-recognition wake phrase",
      stt: liveServices.stt.getStatus().label,
      tts: liveServices.tts.getProviderLabel(),
      browser: liveServices.browser.getProviderLabel()
    },
    app: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      desktopUi: DESKTOP_UI_MODE === "next" && getDesktopUiUrl() ? "embedded-next" : "local-renderer",
      popupMode: POPUP_ENABLED ? "floating-panel" : "disabled",
      updater: updaterService ? updaterService.getStatus() : null
    },
    mute: {
      muted: assistantMuted,
      hotkey: "F4"
    }
  };
});
