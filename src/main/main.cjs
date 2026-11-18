const { loadProjectEnv } = require("./project-env.cjs");
loadProjectEnv();

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs/promises");
const electronBinary = require("electron");
const { app, BrowserWindow, Menu, dialog, globalShortcut, ipcMain, screen, session, safeStorage, shell, protocol } = electronBinary;
const { configureDesktopProfile } = require("./desktop-profile.cjs");
const isolatedProfile = configureDesktopProfile(app);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

const { AssistantService } = require("./assistant-service.cjs");
const { createAssistantTransportServer } = require("./assistant-transport-server.cjs");
const { AppPicker } = require("./app-picker.cjs");
const { BrowserService } = require("./browser-service.cjs");
const { CodeProjectService } = require("./code-project-service.cjs");
const { ComputerControl, COMPUTER_CONTROL_OFF, isTrustedDesktopFrame, requiresComputerControl } = require("./computer-control.cjs");
const { CredentialStore } = require("./credential-store.cjs");
const { DesktopAuthSession } = require("./desktop-auth-session.cjs");
const { createDesktopSessionToken, attachDesktopChatHeader } = require("./desktop-session.cjs");
const { DesktopUiServer } = require("./desktop-ui-server.cjs");
const { ExtensionsService } = require("./extensions-service.cjs");
const { FolderBrowser } = require("./folder-browser.cjs");
const { FileService } = require("./file-service.cjs");
const { GameService } = require("./game-service.cjs");
const {
  getTierProviderLabel,
  listInstalledModels,
  setExternalApiKeyProvider,
  setExternalLlmSettingsProvider
} = require("./ollama-service.cjs");
const { registerLocalWorkspaceHandlers } = require("./local-workspace-store.cjs");
const { registerChatHistoryHandlers } = require("./chat-history-store.cjs");
const { MemoryStore, createAccountMemoryResolver } = require("./memory-store.cjs");
const { getSavedModelAvailability, testSavedModelConnection } = require("./model-connection.cjs");
const { ObsService, OBS_TOOL_NAMES, OBS_ERRORS } = require("./obs-service.cjs");
const { OpenClawService } = require("./openclaw-service.cjs");
const { SpotifyService } = require("./spotify-service.cjs");
const { ScreenService } = require("./screen-service.cjs");
const { createLocalFileSaver } = require("./assistant/local-file-save.cjs");
const { createAutomationAdapter } = require("./platform-adapters.cjs");
const { SettingsStore } = require("./settings-store.cjs");
const { SttService } = require("./stt-service.cjs");
const { TtsService } = require("./tts-service.cjs");
const { synthesizeWorkspaceVoice } = require("./workspace-voice.cjs");
const { UpdaterService } = require("./updater-service.cjs");

const piiManager = require("./pii-manager.cjs");
const notificationMonitor = require("./notification-monitor.cjs");

let popupWindow;
let settingsWindow;
let services;
let assistant;
let assistantControlRevision;
let modelConnectionTest;
let assistantTransportServer;
let desktopUiServer;
const desktopSessionToken = createDesktopSessionToken();
let updaterService;
let popupStateCache = null;
let popupDragState = null;
let assistantMuted = false;
const POPUP_ENABLED = String(process.env.JARVIS_POPUP_ENABLED || "0").trim() === "1";
const DESKTOP_UI_MODE = String(process.env.JARVIS_DESKTOP_UI_MODE || "next").trim().toLowerCase() === "next"
  ? "next"
  : "local";
const computerControl = new ComputerControl(app.getPath("userData"));
const legacySettingsUrl = pathToFileURL(path.join(__dirname, "../renderer/index.html")).href;
const popupUrl = pathToFileURL(path.join(__dirname, "../renderer/popup.html")).href;
const saveLocalFile = createLocalFileSaver({
  async confirmReplacement(target, korean) {
    const { response } = await dialog.showMessageBox(settingsWindow, {
      type: "warning",
      message: korean ? "기존 파일을 바꿀까요?" : "Replace the existing file?",
      detail: target,
      buttons: korean ? ["취소", "바꾸기"] : ["Cancel", "Replace"],
      defaultId: 0,
      cancelId: 0,
    });
    return response === 1;
  }
});

function isDesktopWindow(event) {
  return isTrustedDesktopFrame(event, settingsWindow, getDesktopUiUrl(), legacySettingsUrl);
}

function requireAssistantWindow(event) {
  if (!isDesktopWindow(event) && !isTrustedDesktopFrame(event, popupWindow, "", popupUrl)) {
    throw new Error("This action requires the Jarvis desktop window.");
  }
}

function requireComputerControl() {
  if (!computerControl.enabled) throw new Error(COMPUTER_CONTROL_OFF);
}

function bindDesktopApproval(event, code) {
  const revision = computerControl.revision;
  const accountId = accountSession.active?.user.id;
  return () => {
    if (!isDesktopWindow(event) || !computerControl.enabled || computerControl.revision !== revision ||
        accountSession.active?.user.id !== accountId) {
      throw Object.assign(new Error("Desktop approval is no longer active."), { code });
    }
  };
}

const FOLDER_ERRORS = new Set(["FOLDER_CHANGED", "FOLDER_STALE", "FOLDER_PERMISSION", "UNSUPPORTED_FILE_PREVIEW"]);
let folderBusy = false;

async function dispatchFolderBrowser(event, { tool, payload = {} }) {
  const assertAllowed = bindDesktopApproval(event, "FOLDER_PERMISSION");
  if (folderBusy) return { ok: false, reason: "FOLDER_BUSY" };
  folderBusy = true;
  try {
    assertAllowed();
    const { folderBrowser } = ensureReadyServices().services;
    if (tool === "folder:choose") {
      const selection = await dialog.showOpenDialog(settingsWindow, {
        title: payload.language === "ko" ? "찾아볼 폴더 선택" : "Choose a folder to browse",
        properties: ["openDirectory"]
      });
      if (selection.canceled || selection.filePaths.length !== 1) return { ok: true, outcome: "cancelled" };
      return { ok: true, data: await folderBrowser.choose(selection.filePaths[0], assertAllowed) };
    }
    return { ok: true, data: await folderBrowser.act({
      action: payload.action, id: payload.id, revision: payload.revision, assertAllowed
    }) };
  } catch (error) {
    const missing = ["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code);
    return { ok: false, reason: FOLDER_ERRORS.has(error.code) ? error.code : missing ? "FOLDER_CHANGED" : "FOLDER_FAILED" };
  } finally {
    folderBusy = false;
  }
}

const APP_PICKER_ERRORS = new Set(["APPS_QUERY", "APPS_STALE", "APPS_CHANGED", "APPS_PERMISSION", "APPS_OPEN_FAILED"]);

async function dispatchAppPicker(event, { tool, payload = {} }) {
  const assertAllowed = bindDesktopApproval(event, "APPS_PERMISSION");
  try {
    const { appPicker } = ensureReadyServices().services;
    const data = tool === "apps:catalog"
      ? await appPicker.search({ query: payload.query, refresh: payload.refresh, assertAllowed })
      : await appPicker.open({ id: payload.id, revision: payload.revision, assertAllowed });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: APP_PICKER_ERRORS.has(error.code) ? error.code
      : tool === "apps:open-selected" ? "APPS_OPEN_FAILED" : "APPS_SCAN_FAILED" };
  }
}

const PROJECT_TOOL_NAMES = new Set(["project:create", "project:save", "project:open"]);
const PROJECT_ERRORS = new Set([
  "PROJECT_INVALID_REQUEST", "PROJECT_INVALID_NAME", "PROJECT_INVALID_FILES", "PROJECT_TOO_LARGE",
  "PROJECT_MODEL_REQUIRED", "PROJECT_MODEL_FAILED", "PROJECT_INVALID_DESTINATION", "PROJECT_EXISTS",
  "PROJECT_PERMISSION", "PROJECT_PARTIAL"
]);
let projectBusy = false;
let projectDraft;
let savedProject;
let projectSequence = 0;

async function dispatchProjectTool(event, { tool, payload = {} }) {
  const assertAllowed = bindDesktopApproval(event, "PROJECT_PERMISSION");
  if (projectBusy) return { ok: false, reason: "PROJECT_BUSY" };
  projectBusy = true;
  try {
    assertAllowed();
    const service = ensureReadyServices().services.codeProjects;
    if (tool === "project:create") {
      projectDraft = null;
      savedProject = null;
      const { template = "model", name, prompt = payload.input } = payload;
      const draft = await service.prepareProject({ template, name, prompt });
      assertAllowed();
      const id = ++projectSequence;
      projectDraft = { id, draft, assertAllowed };
      return { ok: true, data: { id, ...draft } };
    }
    if (tool === "project:save") {
      if (!projectDraft || projectDraft.id !== payload.id) return { ok: false, reason: "PROJECT_REVIEW_REQUIRED" };
      projectDraft.assertAllowed();
      const korean = payload.language === "ko";
      const selection = await dialog.showOpenDialog(settingsWindow, {
        title: korean ? "코딩 프로젝트를 저장할 위치" : "Choose where to save the project",
        buttonLabel: korean ? "여기에 만들기" : "Create here",
        properties: ["openDirectory"]
      });
      if (selection.canceled || selection.filePaths.length !== 1) return { ok: true, outcome: "cancelled" };
      const check = () => {
        assertAllowed();
        projectDraft.assertAllowed();
      };
      const result = await service.saveProject(projectDraft.draft, selection.filePaths[0], check);
      savedProject = { id: projectDraft.id, path: result.path, assertAllowed };
      projectDraft = null;
      return { ok: true, data: result };
    }

    if (!savedProject || savedProject.id !== payload.id) return { ok: false, reason: "PROJECT_REVIEW_REQUIRED" };
    savedProject.assertAllowed();
    const projectPath = savedProject.path;
    if (!(await fs.lstat(projectPath)).isDirectory()) return { ok: false, reason: "PROJECT_OPEN_FAILED" };
    assertAllowed();
    savedProject.assertAllowed();
    const opened = payload.editor === "vscode" ? await service.openProjectInVsCode(projectPath) : !(await shell.openPath(projectPath));
    return opened ? { ok: true } : { ok: false, reason: "PROJECT_OPEN_FAILED" };
  } catch (error) {
    if (PROJECT_ERRORS.has(error.code)) return { ok: false, reason: error.code, ...error.details };
    return { ok: false, reason: tool === "project:open" ? "PROJECT_OPEN_FAILED" : "PROJECT_FAILED" };
  } finally {
    projectBusy = false;
  }
}

const GAME_TOOL_NAMES = new Set(["games:list", "games:search", "games:install", "games:update", "games:store"]);
const GAME_ERRORS = new Set([
  "GAMES_QUERY", "GAMES_SEARCH", "GAMES_PLATFORM", "GAMES_LAUNCHER_OPEN", "GAMES_STORE_OPEN",
  "GAMES_PERMISSION", "GAMES_CHOOSE_RESULT"
]);
let gameOperationBusy = false;
let gameSearchRevision = 0;
let steamSearch;

async function dispatchGameTool(event, { tool, payload = {} }) {
  const assertAllowed = bindDesktopApproval(event, "GAMES_PERMISSION");
  if (gameOperationBusy) return { ok: false, reason: "GAMES_BUSY" };
  gameOperationBusy = true;
  try {
    assertAllowed();
    const { games } = ensureReadyServices().services;
    if (tool === "games:search") {
      steamSearch = null;
      const results = await games.searchSteamStore(payload.gameName);
      assertAllowed();
      const revision = ++gameSearchRevision;
      steamSearch = { revision, results, assertAllowed };
      return { ok: true, data: { revision, results } };
    }
    if (tool === "games:install") {
      if (steamSearch?.revision !== payload.revision || !steamSearch?.results.some((game) => game.id === payload.id)) {
        return { ok: false, reason: "GAMES_CHOOSE_RESULT" };
      }
      steamSearch.assertAllowed();
      return { ok: true, data: await games.installSteamGame(payload.id) };
    }
    if (tool === "games:store") return { ok: true, data: await games.openStore(payload.platform, payload.gameName) };
    if (tool === "games:update") return { ok: true, data: await games.openUpdates(payload.platform) };
    const data = await games.listInstalledGames();
    assertAllowed();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: GAME_ERRORS.has(error.code) ? error.code : "GAMES_SCAN" };
  } finally {
    gameOperationBusy = false;
  }
}

const SPOTIFY_TOOL_NAMES = new Set([
  "spotify:availability", "spotify:status", "spotify:control", "spotify:play-track", "spotify:open", "spotify:search"
]);
const SPOTIFY_ERRORS = new Set([
  "SPOTIFY_INPUT", "SPOTIFY_LINK", "SPOTIFY_COMMAND", "SPOTIFY_OPEN", "SPOTIFY_CLOSED",
  "SPOTIFY_UNAVAILABLE", "SPOTIFY_OS_PERMISSION", "SPOTIFY_PLAYER", "SPOTIFY_PERMISSION"
]);
let spotifyBusy = false;

async function dispatchSpotifyTool(event, { tool, payload = {} }) {
  const assertAllowed = bindDesktopApproval(event, "SPOTIFY_PERMISSION");
  if (spotifyBusy) return { ok: false, reason: "SPOTIFY_BUSY" };
  spotifyBusy = true;
  try {
    assertAllowed();
    const { spotify } = ensureReadyServices().services;
    let data;
    switch (tool) {
      case "spotify:availability": data = await spotify.availability(); break;
      case "spotify:open": data = await spotify.openPlayer(assertAllowed); break;
      case "spotify:search": data = await spotify.openSearch(payload.text, assertAllowed); break;
      case "spotify:control":
        if (!["resume", "pause", "next", "previous"].includes(payload.command)) {
          return { ok: false, reason: "SPOTIFY_COMMAND" };
        }
        data = await spotify.readPlayer({ command: payload.command, assertAllowed });
        break;
      case "spotify:play-track":
        data = await spotify.readPlayer({ command: "track", link: payload.text, assertAllowed });
        break;
      default: data = await spotify.readPlayer({ assertAllowed }); break;
    }
    assertAllowed();
    return { ok: true, data };
  } catch (error) {
    const fallback = ["spotify:open", "spotify:search"].includes(tool) ? "SPOTIFY_OPEN" : "SPOTIFY_PLAYER";
    return { ok: false, reason: SPOTIFY_ERRORS.has(error.code) ? error.code : fallback };
  } finally {
    spotifyBusy = false;
  }
}

async function requestObsTransition(event, active, { language } = {}) {
  const assertAllowed = bindDesktopApproval(event, "OBS_PERMISSION");
  const { obs } = ensureReadyServices().services;
  const ko = language === "ko";
  const result = await obs.setStreaming(active, {
    assertAllowed,
    async confirm({ address, currentScene }) {
      const scene = currentScene.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ").slice(0, 160);
      const { response } = await dialog.showMessageBox(settingsWindow, {
        type: "warning",
        message: ko ? (active ? "OBS 방송을 시작할까요?" : "OBS 방송을 종료할까요?")
          : (active ? "Start the OBS broadcast?" : "Stop the OBS broadcast?"),
        detail: [address, (ko ? "현재 장면 " : "Current scene ") + scene].join("\n"),
        buttons: ko ? ["취소", active ? "시작" : "종료"] : ["Cancel", active ? "Start" : "Stop"],
        defaultId: 0,
        cancelId: 0,
      });
      return response === 1;
    },
  });
  return { ok: true, ...result };
}

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

const accountSession = new DesktopAuthSession({
  filePath: path.join(app.getPath("userData"), "jarvis-account-session.json"),
  secureStorage: safeStorage,
  hasLegacy: piiManager.hasLegacySession,
  readLegacy: piiManager.readLegacySession
});

function requireDesktopAccountFrame(event) {
  if (!isDesktopWindow(event) || new URL(event.senderFrame.url).pathname !== "/") {
    throw new Error("Open the Jarvis workspace to manage sign-in.");
  }
}

function ensureReadyServices() {
  if (!services) {
    throw new Error("Assistant services are not ready yet.");
  }
  if (!assistant || assistantControlRevision !== computerControl.revision) {
    assistant = new AssistantService({ ...services, computerControl, threadId: "default-thread" });
    assistantControlRevision = computerControl.revision;
  }

  return {
    assistant,
    services
  };
}

async function captureLivePreviewSnapshot() {
  const { services: liveServices } = ensureReadyServices();

  try {
    const browserStatus = await liveServices.browser.peekStatus?.();

    if (browserStatus?.pageActive && typeof liveServices.browser.screenshot === "function") {
      const previewBytes = await liveServices.browser.screenshot();
      const buffer = Buffer.isBuffer(previewBytes) ? previewBytes : Buffer.from(previewBytes || []);

      if (buffer.length) {
        return {
          ok: true,
          source: "assistant-browser",
          imageDataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
          title: browserStatus.currentPage?.title || "",
          url: browserStatus.currentPage?.url || ""
        };
      }
    }
  } catch (_error) {
    // Browser previews are optional.
  }

  return { ok: false, source: "unavailable" };
}

async function createServices() {
  const credentials = new CredentialStore({
    app,
    safeStorage,
    ...(isolatedProfile && {
      sharedVaultDir: path.join(app.getPath("userData"), "credentials"),
      keychainService: "friday-jarvis-prototype:" + isolatedProfile,
      legacyKeychainService: null
    })
  });
  const memory = new MemoryStore({ app });
  await memory.load();
  const resolveAccountMemory = createAccountMemoryResolver(app.getPath("userData"));
  const settings = new SettingsStore({ app });
  await settings.load();

  setExternalApiKeyProvider((provider) => {
    if (provider === "gemini") return settings.getGeminiApiKey();
    if (provider === "groq") return settings.getConversationModelSettings().groq.apiKey;
    if (provider === "openai" || provider === "openai-compatible") {
      return settings.getConversationModelSettings().openai.apiKey;
    }
    return null;
  });
  setExternalLlmSettingsProvider(() => settings.getConversationModelSettings());
  const extensions = new ExtensionsService({ app });
  await extensions.load();
  const browser = new BrowserService({
    userDataDir: app.getPath("userData"),
    credentialStore: credentials,
    allowSharedProfiles: !isolatedProfile
  });
  const openClaw = new OpenClawService({
    workspaceRoot: process.cwd()
  });
  const files = new FileService({
    workspaceRoot: process.cwd()
  });
  const obs = new ObsService();
  const screenService = new ScreenService();
  const automation = createAutomationAdapter({
    screen: screenService
  });
  const appPicker = new AppPicker({
    listApps: (options) => automation.listInstalledApps(options),
    launch: (location) => shell.openPath(location)
  });
  const spotify = new SpotifyService({
    locateApp: async () => (await app.getApplicationInfoForProtocol("spotify:")).path,
    openAppPath: (location) => shell.openPath(location),
    openExternal: (target) => shell.openExternal(target)
  });
  const games = new GameService({ openExternal: (target) => shell.openExternal(target) });
  const codeProjects = new CodeProjectService({ automation });
  const tts = new TtsService({
    settingsStore: settings
  });
  const stt = new SttService({
    settingsStore: settings
  });

  services = {
    folderBrowser: new FolderBrowser(files),
    appPicker,
    automation,
    browser,
    codeProjects,
    credentials,
    extensions,
    files,
    games,
    spotify,
    memory,
    obs,
    openClaw,
    screen: screenService,
    settings,
    stt,
    tts
  };

  assistantTransportServer = createAssistantTransportServer({
    port: Number(process.env.JARVIS_ASSISTANT_PORT || 8010),
    sessionToken: desktopSessionToken,
    computerControl,
    getActiveAccountId: () => accountSession.active?.user.id,
    async createAssistantForThread(threadId, context) {
      const accountMemory = await resolveAccountMemory(context);
      return new AssistantService({
        automation,
        computerControl,
        browser,
        credentials,
        extensions,
        files,
        memory: accountMemory,
        readAccountSession: () => {
          const active = accountSession.active;
          return context.accountId === active?.user.id ? active : null;
        },
        obs,
        openClaw,
        screen: screenService,
        tts,
        settings,
        threadId
      });
    }
  });

  await assistantTransportServer.start();
}

async function ensureDesktopUiServer() {
  if (DESKTOP_UI_MODE !== "next") return;

  if (!desktopUiServer) {
    desktopUiServer = new DesktopUiServer({
      app,
      sessionToken: desktopSessionToken,
      transportUrl: assistantTransportServer.url
    });
  }

  try {
    await desktopUiServer.start();
  } catch (error) {
    console.error("Could not start the desktop UI server:", error);
  }
}

function getDesktopUiUrl() {
  if (DESKTOP_UI_MODE !== "next") {
    return "";
  }

  return desktopUiServer?.url || "";
}

function buildApplicationMenu() {
  const updateItems = isolatedProfile ? [] : [{
    label: "Check for Updates...",
    click: () => updaterService?.checkForUpdates("manual")
  }];
  const template = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        ...updateItems,
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
        ...updateItems,
        { role: "quit" }
      ]
    });
  }

  template.push({ role: "editMenu" });

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
      ...updateItems,
      ...(process.platform === "darwin" ? [{
        label: "Accessibility Settings…",
        click: () => {
          shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility").catch(() => {});
        }
      }] : [])
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

app.on("second-instance", () => openSettingsWindow());

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
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  settingsWindow = new BrowserWindow({
    width: Math.min(1180, workArea.width),
    height: Math.min(800, workArea.height),
    minWidth: Math.min(420, workArea.width),
    minHeight: Math.min(560, workArea.height),
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
    attachDesktopChatHeader(
      settingsWindow.webContents,
      desktopUrl,
      desktopSessionToken,
      () => getDesktopUiUrl() === desktopUrl
    );
    settingsWindow.loadURL(desktopUrl).catch(() => {
      console.error("Desktop UI URL load failed, falling back to local renderer.");
      settingsWindow?.loadFile(path.join(__dirname, "../renderer/index.html"));
    });
  } else {
    settingsWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  const desktopOrigin = desktopUrl ? new URL(desktopUrl).origin : "";
  function handleNavigation(event, url) {
    if (desktopOrigin && getDesktopUiUrl() === desktopUrl &&
        URL.canParse(url) && new URL(url).origin === desktopOrigin) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
  }
  settingsWindow.webContents.on("will-navigate", handleNavigation);
  settingsWindow.webContents.on("will-redirect", handleNavigation);

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

  settingsWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error("Jarvis Desktop failed to load UI:", {
      errorCode,
      errorDescription
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
      try {
        return { ok: true, tool, data: await liveServices.screen.captureAndOcr() };
      } catch (error) {
        return { ok: false, tool, reason: ["SCREEN_CAPTURE_FAILED", "OCR_NOT_INSTALLED"].includes(error.code)
          ? error.code
          : "OCR_FAILED" };
      }
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
    case "browser:login": {
      const data = await liveServices.browser.loginWithStoredCredential(payload.siteOrUrl);
      return {
        ok: true,
        tool,
        data
      };
    }
    case "browser:login-form": {
      const data = await liveServices.browser.fillCurrentLoginForm({
        siteOrUrl: payload.siteOrUrl || payload.site || "",
        loginUrl: payload.loginUrl || "",
        username: payload.username || "",
        password: payload.password || "",
        submit: Boolean(payload.submit)
      });

      let saved = null;
      if (payload.saveCredential) {
        saved = await liveServices.credentials.saveCredential({
          site: payload.site || payload.siteOrUrl || data.site || data.url,
          loginUrl: payload.loginUrl || data.url || payload.siteOrUrl || "",
          username: payload.username || "",
          password: payload.password || ""
        });
      }

      return {
        ok: true,
        tool,
        data: {
          ...data,
          saved
        }
      };
    }
    case "browser:verification-code": {
      const data = await liveServices.browser.fillVerificationCode({
        code: payload.code || "",
        kind: payload.kind || "verification",
        submit: Boolean(payload.submit)
      });
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
      await liveServices.obs.connect(payload);
      const data = await liveServices.obs.status();
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
    case "file:list": {
      const data = await liveServices.files.listDirectory(payload.path || ".");
      return {
        ok: true,
        tool,
        data
      };
    }
    case "system:open-external": {
      const url = String(payload.url || payload.target || "").trim();
      if (!URL.canParse(url) || !["https:", "http:"].includes(new URL(url).protocol)) {
        return { ok: false, tool, message: "A web link is required." };
      }
      await shell.openExternal(url);
      return { ok: true, tool };
    }
    case "ai:web-login": {
      return {
        ok: false,
        tool,
        provider: null,
        reason: "web_login_removed"
      };
    }
    case "ai:web-logout": {
      return { ok: true, tool, reason: "web_login_removed" };
    }
    case "ai:web-status": {
      return {
        ok: true,
        tool,
        connected: false,
        provider: null,
        reason: "web_login_removed",
        checkedAt: Date.now()
      };
    }
    case "ai:ollama-models": {
      const models = await listInstalledModels({
        forceRefresh: Boolean(payload.forceRefresh),
        url: payload.url
      });
      return {
        ok: true,
        tool,
        models
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
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allow = ["audioCapture", "media"].includes(permission) ||
      (permission === "display-capture" && computerControl.enabled);
    callback(allow);
  });

  await computerControl.load();
  await createServices();

  await ensureDesktopUiServer();
  if (!isolatedProfile) {
    updaterService = new UpdaterService({ app });
    await updaterService.init();
  }
  buildApplicationMenu();
  if (POPUP_ENABLED) {
    await createPopupWindow();
  }
  createSettingsWindow();
  openSettingsWindow();
  if (!isolatedProfile) {
    globalShortcut.register("CommandOrControl+Shift+Space", () => {
      if (POPUP_ENABLED) {
        showPopup("listening");
        return;
      }
      openSettingsWindow();
    });
    globalShortcut.register("CommandOrControl+,", openSettingsWindow);
    globalShortcut.register("F4", () => toggleAssistantMuted("shortcut"));
    setTimeout(() => {
      updaterService.checkForUpdates("startup").catch(() => {});
    }, 15_000);
  }

  app.on("activate", async () => {
    if (!settingsWindow) {
      createSettingsWindow();
    }

    openSettingsWindow();
  });

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

ipcMain.handle("assistant:submit-command", async (event, input) => {
  requireAssistantWindow(event);
  if (event.senderFrame.url !== legacySettingsUrl && event.senderFrame.url !== popupUrl) {
    throw new Error("Use the workspace conversation to send a message.");
  }
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

ipcMain.handle("assistant:speak", async (event, payload) => {
  requireAssistantWindow(event);
  if (assistantMuted) {
    return {
      muted: true
    };
  }

  return ensureReadyServices().services.tts.synthesize(payload);
});

ipcMain.handle("assistant:speak-workspace", async (event, payload) => {
  requireDesktopAccountFrame(event);
  const account = accountSession.active;
  if (!account) return { status: "failed" };
  if (assistantMuted) return { status: "muted" };
  const result = await synthesizeWorkspaceVoice(ensureReadyServices().services.tts, payload);
  if (accountSession.active !== account || assistantMuted || !isDesktopWindow(event)) return { status: "muted" };
  return result;
});

ipcMain.handle("assistant:get-mute-state", async (event) => {
  requireAssistantWindow(event);
  return { muted: assistantMuted };
});

ipcMain.handle("assistant:set-mute-state", async (event, payload) => {
  requireAssistantWindow(event);
  return setAssistantMuted(payload?.muted, "renderer");
});

ipcMain.handle("assistant:toggle-mute", async (event) => {
  requireAssistantWindow(event);
  return toggleAssistantMuted("renderer");
});

ipcMain.handle("assistant:get-tts-settings", async (event) => {
  if (!isDesktopWindow(event)) throw new Error("Open Voice output in the Jarvis desktop window.");
  const { services: liveServices } = ensureReadyServices();
  const status = await liveServices.tts.status();

  return {
    settings: liveServices.settings.getTtsSettingsView(),
    status
  };
});

ipcMain.handle("assistant:save-tts-settings", async (event, payload) => {
  if (!isDesktopWindow(event)) throw new Error("Open Voice output in the Jarvis desktop window.");
  const { services: liveServices } = ensureReadyServices();
  const settings = await liveServices.settings.updateTtsSettings(payload);
  const status = await liveServices.tts.status();

  return {
    settings,
    status
  };
});

ipcMain.handle("assistant:get-conversation-model-settings", async (event) => {
  if (!isDesktopWindow(event)) throw new Error("Open model settings in the Jarvis desktop window.");
  const { services: liveServices } = ensureReadyServices();

  return {
    settings: liveServices.settings.getConversationModelSettingsView(),
    availability: getSavedModelAvailability(computerControl.enabled)
  };
});

ipcMain.handle("assistant:save-conversation-model-settings", async (event, payload) => {
  if (!isDesktopWindow(event)) throw new Error("Open model settings in the Jarvis desktop window.");
  const { services: liveServices } = ensureReadyServices();
  const settings = await liveServices.settings.updateConversationModelSettings(payload);

  return {
    settings
  };
});

ipcMain.handle("assistant:test-conversation-model", (event) => {
  if (!isDesktopWindow(event) || new URL(event.senderFrame.url).pathname !== "/") {
    throw new Error("Open model settings in the Jarvis workspace.");
  }
  return modelConnectionTest ||= testSavedModelConnection().finally(() => { modelConnectionTest = null; });
});

ipcMain.handle("assistant:restore-account-session", (event, allowLegacy) => {
  requireDesktopAccountFrame(event);
  return accountSession.restore({ allowLegacy: allowLegacy === true });
});

ipcMain.handle("assistant:save-account-session", (event, payload) => {
  requireDesktopAccountFrame(event);
  return accountSession.save(payload);
});

ipcMain.handle("assistant:clear-account-session", (event) => {
  requireDesktopAccountFrame(event);
  accountSession.clear();
});

registerLocalWorkspaceHandlers({
  ipcMain,
  getWindow: () => settingsWindow,
  getDesktopUiUrl,
  getUserDataDirectory: () => app.getPath("userData"),
});

registerChatHistoryHandlers({
  ipcMain,
  getWindow: () => settingsWindow,
  getDesktopUiUrl,
  getUserDataDirectory: () => app.getPath("userData"),
  getActiveAccountId: () => accountSession.active?.user.id,
});

ipcMain.handle("assistant:get-gemini-status", async () => {
  const { services: liveServices } = ensureReadyServices();
  const key = liveServices.settings.getGeminiApiKey();
  return {
    configured: Boolean(key),
    model: "gemini-2.5-flash"
  };
});

ipcMain.handle("assistant:save-gemini-key", async (_event, payload) => {
  const { services: liveServices } = ensureReadyServices();
  await liveServices.settings.updateGeminiApiKey(payload.key);
  return { success: true };
});

let addressReviewPending = false;
ipcMain.handle("assistant:invoke-tool", async (event, request) => {
  requireAssistantWindow(event);
  if (requiresComputerControl(request.tool)) requireComputerControl();
  if (request.tool === "folder:choose" || request.tool === "folder:act") return dispatchFolderBrowser(event, request);
  if (request.tool === "apps:catalog" || request.tool === "apps:open-selected") return dispatchAppPicker(event, request);
  if (SPOTIFY_TOOL_NAMES.has(request.tool)) return dispatchSpotifyTool(event, request);
  if (GAME_TOOL_NAMES.has(request.tool)) return dispatchGameTool(event, request);
  if (PROJECT_TOOL_NAMES.has(request.tool)) return dispatchProjectTool(event, request);
  if (request.tool === "file:write") {
    return saveLocalFile(ensureReadyServices().services.files, request.payload, bindDesktopApproval(event, "FILE_PERMISSION_CHANGED"));
  }
  if (request.tool === "browser:read-address") {
    requireDesktopAccountFrame(event);
    const account = accountSession.active;
    if (!account) return { ok: false, reason: "BROWSER_PERMISSION" };
    if (addressReviewPending) return { ok: false, reason: "BROWSER_BUSY" };
    const assertDesktopApproval = bindDesktopApproval(event, "BROWSER_PERMISSION");
    const assertAllowed = () => {
      assertDesktopApproval();
      if (accountSession.active !== account) {
        throw Object.assign(new Error("The current account changed."), { code: "BROWSER_PERMISSION" });
      }
    };
    addressReviewPending = true;
    try {
      const result = await ensureReadyServices().services.browser.readAddressForReview(request.payload?.address, assertAllowed);
      assertAllowed();
      return result;
    } catch (error) {
      return { ok: false, reason: error.code === "BROWSER_PERMISSION" ? error.code : "BROWSER_ADDRESS_FAILED" };
    } finally {
      addressReviewPending = false;
    }
  }
  if (request.tool === "browser:read") {
    const assertAllowed = bindDesktopApproval(event, "BROWSER_PERMISSION");
    try {
      assertAllowed();
      const result = await ensureReadyServices().services.browser.readPageForReview();
      assertAllowed();
      return result;
    } catch (error) {
      return { ok: false, reason: error.code === "BROWSER_PERMISSION" ? error.code : "BROWSER_READ_FAILED" };
    }
  }
  if (OBS_TOOL_NAMES.has(request.tool)) {
    try {
      if (request.tool === "obs:start" || request.tool === "obs:stop") {
        return await requestObsTransition(event, request.tool === "obs:start", request.payload);
      }
      return await dispatchTool(request.tool, request.payload);
    } catch (error) {
      return { ok: false, reason: OBS_ERRORS.has(error.code) ? error.code : "OBS_REQUEST" };
    }
  }
  return dispatchTool(request.tool, request.payload);
});

ipcMain.handle("assistant:get-computer-control", (event) => {
  if (!isDesktopWindow(event)) throw new Error("Open the Jarvis desktop settings to check computer control.");
  return computerControl.enabled;
});

ipcMain.handle("assistant:set-computer-control", (event, enabled) => {
  if (!isDesktopWindow(event) ||
      (event.senderFrame.url !== legacySettingsUrl && new URL(event.senderFrame.url).pathname !== "/")) {
    throw new Error("Open the Jarvis desktop settings to change computer control.");
  }
  return computerControl.setEnabled(enabled);
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

ipcMain.handle("assistant:get-live-preview", async (event) => {
  requireAssistantWindow(event);
  requireComputerControl();
  return captureLivePreviewSnapshot();
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
  const sttStatus = liveServices.stt.getStatus();
  const appCatalog = computerControl.enabled ? await liveServices.automation.listInstalledApps({
    limit: 1
  }).catch(() => null) : null;

  return {
    shortcut: isolatedProfile ? "" : POPUP_ENABLED
      ? "Cmd/Ctrl + Shift + Space · 빠른 패널 / Cmd/Ctrl + , · Jarvis 앱 / F4 · 자비스 음성 음소거"
      : "Cmd/Ctrl + Shift + Space · Jarvis 앱 열기 / Cmd/Ctrl + , · Jarvis 앱 / F4 · 자비스 음성 음소거",
    capabilities: {
      ...liveServices.automation.getCapabilities(),
      appCatalogCount: appCatalog?.totalCount || 0,
      screenOcr: "tesseract-cli",
      browserAutomation: liveServices.browser.getProviderLabel(),
      obsControl: "obs-websocket-js",
      fileAutomation: "local-fs",
      gameLaunchers: "steam+epic",
      codeProjects: "project-review",
      extensions: liveServices.extensions.getSummary()
    },
    providers: {
      llm: `${getTierProviderLabel("fast")} -> ${getTierProviderLabel("complex")}`,
      wakeWord: "web-speech wake phrase",
      stt: sttStatus.label,
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
      hotkey: isolatedProfile ? "" : "F4"
    }
  };
});
