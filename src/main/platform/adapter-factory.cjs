const fs = require("node:fs/promises");
const { execFile, exec } = require("node:child_process");
const { platform } = require("node:os");
const { promisify } = require("node:util");

const {
  listInstalledAppsMac,
  normalizeAppToken,
  normalizeSingleLineText,
  resolveMacAppTarget
} = require("./app-registry.cjs");
const { resolveFinderPath } = require("./finder-paths.cjs");
const { getAppleKeyCode, normalizeKeyToken, normalizeMenuPath } = require("./keymap.cjs");
const {
  buildWorkspaceQuickSwitchQuery,
  convertObservationToScreenPoint,
  findDiscordQuickSwitcherResultObservation,
  findDiscordSearchTriggerObservation,
  findDiscordSidebarConversationObservation,
  normalizeDiscordOcrText,
  parseVisibleDiscordMessages,
  stripWorkspaceWindowTitleSuffix,
  workspaceConversationTitleMatchesTarget
} = require("./workspace-detection.cjs");
const {
  buildAppKeyActionLine,
  buildMenuClickExpression,
  clickAndPasteAtPointMac,
  clickScreenPointMac,
  captureWindowImageMac,
  escapeAppleScriptString,
  insertTextIntoFrontAppMac,
  postLowLevelKeyMac,
  recognizeTextInImageMac,
  runAppleScript
} = require("./applescript-utils.cjs");

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

async function openAppMac(appName) {
  const resolution = await resolveMacAppTarget(appName);

  if (resolution.openPath) {
    await execFileAsync("open", [resolution.openPath]);
  } else {
    await execFileAsync("open", ["-a", resolution.resolvedTarget]);
  }

  await runAppleScript([
    `tell application "${escapeAppleScriptString(resolution.resolvedTarget)}" to activate`
  ]).catch(() => {});

  return {
    ...resolution,
    appName: resolution.resolvedTarget
  };
}

async function focusAppMac(appName) {
  const resolution = await openAppMac(appName);
  await runAppleScript([
    `tell application "${escapeAppleScriptString(resolution.resolvedTarget)}" to activate`,
    "delay 0.1"
  ]);

  return resolution;
}

async function getPrimaryWindowTitleMac(appName) {
  const resolvedName = normalizeSingleLineText(appName);

  if (!resolvedName) {
    return "";
  }

  const raw = await runAppleScript([
    `tell application "${escapeAppleScriptString(resolvedName)}" to activate`,
    "delay 0.08",
    'tell application "System Events"',
    `tell process "${escapeAppleScriptString(resolvedName)}"`,
    'set output to ""',
    "repeat with index from 1 to count of windows",
    "try",
    "set windowName to name of window index as text",
    'if windowName is not "" then set output to output & windowName & linefeed',
    "end try",
    "end repeat",
    "return output",
    "end tell",
    "end tell"
  ]).catch(() => "");

  const titles = raw
    .split(/\r?\n/g)
    .map((line) => normalizeSingleLineText(line))
    .filter(Boolean);

  return titles.find((title) => title.endsWith(` - ${resolvedName}`)) || titles[titles.length - 1] || "";
}

async function getFrontmostAppMac() {
  const appName = normalizeSingleLineText(await runAppleScript([
    'tell application "System Events"',
    "set frontProcess to first application process whose frontmost is true",
    "return name of frontProcess",
    "end tell"
  ]).catch(() => ""));

  if (!appName) {
    return {
      appName: "",
      windowTitle: ""
    };
  }

  return {
    appName,
    windowTitle: await getPrimaryWindowTitleMac(appName).catch(() => "")
  };
}

async function openUrlMac(url) {
  await execFileAsync("open", [url]);
  return { target: url };
}

async function typeInAppMac(appName, text) {
  const resolution = await focusAppMac(appName);
  await runAppleScript([
    `tell application "${escapeAppleScriptString(resolution.resolvedTarget)}" to activate`,
    "delay 0.12"
  ]);
  const insertResult = await insertTextIntoFrontAppMac(text);

  return {
    appName: resolution.resolvedTarget,
    text,
    method: insertResult.method
  };
}

async function pressKeyMac(appName, key, modifiers = []) {
  const resolution = await focusAppMac(appName);
  const normalizedKey = normalizeKeyToken(key);
  const keyCode = getAppleKeyCode(normalizedKey);
  const actionLine = buildAppKeyActionLine(normalizedKey, keyCode, modifiers);

  await runAppleScript([
    `tell application "${escapeAppleScriptString(resolution.resolvedTarget)}" to activate`,
    "delay 0.08",
    'tell application "System Events"',
    actionLine,
    "end tell"
  ]);

  return {
    appName: resolution.resolvedTarget,
    key: normalizedKey,
    modifiers
  };
}

async function clickMenuItemMac(appName, menuPath) {
  const resolution = await focusAppMac(appName);
  const clickExpression = buildMenuClickExpression(menuPath, normalizeMenuPath);

  await runAppleScript([
    `tell application "${escapeAppleScriptString(resolution.resolvedTarget)}" to activate`,
    "delay 0.12",
    'tell application "System Events"',
    `tell process "${escapeAppleScriptString(resolution.resolvedTarget)}"`,
    clickExpression,
    "end tell",
    "end tell"
  ]);

  return {
    appName: resolution.resolvedTarget,
    menuPath: normalizeMenuPath(menuPath)
  };
}

async function openFinderPathMac(target = "") {
  const resolvedPath = await resolveFinderPath(target);

  if (!resolvedPath) {
    throw new Error(`I could not resolve the Finder location: ${target}`);
  }

  await execFileAsync("open", ["-a", "Finder", resolvedPath]);
  await runAppleScript([
    'tell application "Finder" to activate',
    "delay 0.1"
  ]).catch(() => {});

  return {
    appName: "Finder",
    requestedTarget: target || "home",
    path: resolvedPath
  };
}

async function openFinderWindowMac(target = "") {
  if (target) {
    return openFinderPathMac(target);
  }

  await runAppleScript([
    'tell application "Finder" to activate',
    'tell application "Finder" to make new Finder window',
    "delay 0.1"
  ]);

  return {
    appName: "Finder",
    path: ""
  };
}

async function searchFinderMac(query = "") {
  const resolution = await focusAppMac("Finder");
  const text = normalizeSingleLineText(query);

  await runAppleScript([
    `tell application "${escapeAppleScriptString(resolution.resolvedTarget)}" to activate`,
    "delay 0.15",
    'tell application "System Events"',
    'keystroke "f" using {command down}',
    "end tell"
  ]);
  await runAppleScript(["delay 0.15"]);
  const insertResult = await insertTextIntoFrontAppMac(text, { preferPaste: true });

  return {
    appName: resolution.resolvedTarget,
    query: text,
    method: insertResult.method
  };
}

async function createNoteMac({ title = "", body = "" } = {}) {
  const resolution = await openAppMac("Notes");
  const cleanTitle = normalizeSingleLineText(title);
  const cleanBody = String(body).trim();

  await runAppleScript([
    `tell application "${escapeAppleScriptString(resolution.resolvedTarget)}" to activate`,
    "delay 0.18",
    'tell application "System Events"',
    'keystroke "n" using {command down}',
    "end tell"
  ]);
  await runAppleScript(["delay 0.22"]);

  let titleMethod = "none";
  let bodyMethod = "none";

  if (cleanTitle) {
    titleMethod = (await insertTextIntoFrontAppMac(cleanTitle, { preferPaste: true })).method;
  }

  if (cleanBody) {
    if (cleanTitle) {
      await runAppleScript([
        'tell application "System Events"',
        "key code 36",
        "key code 36",
        "end tell"
      ]);
    }

    bodyMethod = (await insertTextIntoFrontAppMac(cleanBody, { preferPaste: true })).method;
  }

  return {
    appName: resolution.resolvedTarget,
    title: cleanTitle,
    body: cleanBody,
    methods: {
      title: titleMethod,
      body: bodyMethod
    }
  };
}

async function searchNotesMac(query = "") {
  const resolution = await focusAppMac("Notes");
  const text = normalizeSingleLineText(query);

  await runAppleScript([
    `tell application "${escapeAppleScriptString(resolution.resolvedTarget)}" to activate`,
    "delay 0.15",
    'tell application "System Events"',
    'keystroke "f" using {command down}',
    "end tell"
  ]);
  await runAppleScript(["delay 0.12"]);
  const insertResult = await insertTextIntoFrontAppMac(text, { preferPaste: true });

  return {
    appName: resolution.resolvedTarget,
    query: text,
    method: insertResult.method
  };
}

async function navigateChromeMac(target = "", { newTab = false } = {}) {
  const resolution = await openAppMac("Google Chrome");
  const destination = normalizeSingleLineText(target);

  await runAppleScript([
    `tell application "${escapeAppleScriptString(resolution.resolvedTarget)}" to activate`,
    "delay 0.15",
    'tell application "System Events"',
    ...(newTab ? ['keystroke "t" using {command down}', "delay 0.12"] : []),
    'keystroke "l" using {command down}',
    "end tell"
  ]);
  await runAppleScript(["delay 0.08"]);
  const insertResult = await insertTextIntoFrontAppMac(destination, { preferPaste: true });
  await runAppleScript([
    "delay 0.08",
    'tell application "System Events"',
    "key code 36",
    "end tell"
  ]);

  return {
    appName: resolution.resolvedTarget,
    target: destination,
    newTab,
    method: insertResult.method
  };
}

async function captureDiscordWindowSnapshotMac(appName) {
  const capture = await captureWindowImageMac(appName, "discord");

  try {
    return {
      window: capture.window,
      imagePath: capture.imagePath,
      observations: await recognizeTextInImageMac(capture.imagePath)
    };
  } finally {
    await fs.unlink(capture.imagePath).catch(() => {});
  }
}

async function clickDiscordObservationMac(appName, window, observation, { activate = true } = {}) {
  if (activate) {
    await openAppMac(appName);
  }

  const point = convertObservationToScreenPoint(window, observation);
  await clickScreenPointMac(point.x, point.y);
}

async function clickVisibleDiscordConversationMac(appName, target) {
  const snapshot = await captureDiscordWindowSnapshotMac(appName);
  const observation = findDiscordSidebarConversationObservation(snapshot.observations, target);

  if (!observation) {
    return null;
  }

  await clickDiscordObservationMac(appName, snapshot.window, observation);
  await runAppleScript(["delay 1.25"]);

  return {
    observation,
    strategy: "ocr-sidebar"
  };
}

async function searchDiscordConversationMac(appName, target) {
  const initialSnapshot = await captureDiscordWindowSnapshotMac(appName);
  const searchTrigger = findDiscordSearchTriggerObservation(initialSnapshot.observations);

  if (!searchTrigger) {
    return null;
  }

  const searchPoint = convertObservationToScreenPoint(initialSnapshot.window, searchTrigger);
  await clickAndPasteAtPointMac(searchPoint.x, searchPoint.y, target, { restoreClipboard: true });

  await postLowLevelKeyMac(36);
  await runAppleScript(["delay 1.25"]);

  const titleAfterEnter = await getPrimaryWindowTitleMac(appName);

  if (workspaceConversationTitleMatchesTarget(appName, titleAfterEnter, target)) {
    return {
      observation: {
        text: target
      },
      strategy: "ocr-search-enter"
    };
  }

  const resultsSnapshot = await captureDiscordWindowSnapshotMac(appName);
  const observation = findDiscordQuickSwitcherResultObservation(resultsSnapshot.observations, target);

  if (!observation) {
    return null;
  }

  await clickDiscordObservationMac(appName, resultsSnapshot.window, observation, { activate: false });
  await runAppleScript(["delay 1.25"]);

  return {
    observation,
    strategy: "ocr-search"
  };
}

async function switchDiscordTargetMac(appName, target = "") {
  const resolution = await openAppMac(appName);
  const destination = normalizeSingleLineText(target).replace(/^[@#]+/, "");
  const initialTitle = await getPrimaryWindowTitleMac(resolution.resolvedTarget);

  if (!destination) {
    return {
      appName: resolution.resolvedTarget,
      target: destination,
      quickSwitchQuery: "",
      method: "none",
      verified: true,
      conversationTitle: await getPrimaryWindowTitleMac(resolution.resolvedTarget),
      strategy: "none"
    };
  }

  if (workspaceConversationTitleMatchesTarget(resolution.resolvedTarget, initialTitle, destination)) {
    return {
      appName: resolution.resolvedTarget,
      target: destination,
      quickSwitchQuery: destination,
      method: "already-focused",
      strategy: "title-match",
      verified: true,
      conversationTitle: initialTitle
    };
  }

  const shortDiscordTarget = normalizeDiscordOcrText(destination).length <= 1;
  const visibleMatch = shortDiscordTarget
    ? null
    : await clickVisibleDiscordConversationMac(resolution.resolvedTarget, destination).catch(() => null);

  if (visibleMatch) {
    const conversationTitle = await getPrimaryWindowTitleMac(resolution.resolvedTarget);

    if (workspaceConversationTitleMatchesTarget(resolution.resolvedTarget, conversationTitle, destination)) {
      return {
        appName: resolution.resolvedTarget,
        target: destination,
        quickSwitchQuery: destination,
        method: "ocr-click",
        strategy: visibleMatch.strategy,
        verified: true,
        conversationTitle
      };
    }
  }

  const searchMatch = await searchDiscordConversationMac(resolution.resolvedTarget, destination).catch(() => null);

  if (searchMatch) {
    const conversationTitle = await getPrimaryWindowTitleMac(resolution.resolvedTarget);

    if (workspaceConversationTitleMatchesTarget(resolution.resolvedTarget, conversationTitle, destination)) {
      return {
        appName: resolution.resolvedTarget,
        target: destination,
        quickSwitchQuery: destination,
        method: "ocr-search-click",
        strategy: searchMatch.strategy,
        verified: true,
        conversationTitle
      };
    }
  }

  const finalTitle = await getPrimaryWindowTitleMac(resolution.resolvedTarget);

  throw new Error(
    `Discord could not confirm the conversation for "${destination}". Last visible conversation was "${stripWorkspaceWindowTitleSuffix(finalTitle || initialTitle, resolution.resolvedTarget) || "unknown"}".`
  );
}

async function switchWorkspaceTargetMac(appName, target = "") {
  if (normalizeAppToken(appName) === "discord") {
    return switchDiscordTargetMac(appName, target);
  }

  const resolution = await openAppMac(appName);
  const destination = normalizeSingleLineText(target);
  const quickSwitchQuery = buildWorkspaceQuickSwitchQuery(resolution.resolvedTarget, destination);

  await runAppleScript([
    `tell application "${escapeAppleScriptString(resolution.resolvedTarget)}" to activate`,
    "delay 0.35",
    'tell application "System Events"',
    'keystroke "k" using {command down}',
    "end tell"
  ]);
  await runAppleScript(["delay 0.32"]);
  const insertResult = await insertTextIntoFrontAppMac(quickSwitchQuery, { preferPaste: true });
  await runAppleScript([
    "delay 0.5",
    'tell application "System Events"',
    "key code 36",
    "end tell",
    "delay 0.7"
  ]);

  return {
    appName: resolution.resolvedTarget,
    target: destination,
    quickSwitchQuery,
    method: insertResult.method,
    conversationTitle: await getPrimaryWindowTitleMac(resolution.resolvedTarget),
    verified: true
  };
}

async function sendWorkspaceMessageMac(appName, { target = "", message = "" } = {}) {
  const destination = normalizeSingleLineText(target);
  const cleanMessage = normalizeSingleLineText(message);
  let destinationMethod = "none";
  let messageMethod = "none";
  let switchResult = null;

  if (!cleanMessage) {
    throw new Error("A message is required before sending.");
  }

  if (destination) {
    switchResult = await switchWorkspaceTargetMac(appName, destination);
    destinationMethod = switchResult.method;
  }

  const resolution = await focusAppMac(appName);
  await runAppleScript([
    `tell application "${escapeAppleScriptString(resolution.resolvedTarget)}" to activate`,
    "delay 0.28"
  ]);

  messageMethod = (await insertTextIntoFrontAppMac(cleanMessage, { preferPaste: true })).method;
  await runAppleScript([
    "delay 0.12",
    'tell application "System Events"',
    "key code 36",
    "end tell"
  ]);

  return {
    appName: resolution.resolvedTarget,
    target: destination,
    message: cleanMessage,
    switchResult,
    conversationTitle: await getPrimaryWindowTitleMac(resolution.resolvedTarget),
    methods: {
      destination: destinationMethod,
      message: messageMethod
    }
  };
}

async function readDiscordVisibleMessagesMac(screen) {
  if (!screen?.captureAndOcr) {
    throw new Error("Screen reading is not available for Discord message reading.");
  }

  const resolution = await focusAppMac("Discord");
  const conversationTitle = await getPrimaryWindowTitleMac(resolution.resolvedTarget);
  const strippedTitle = stripWorkspaceWindowTitleSuffix(conversationTitle, resolution.resolvedTarget);
  const capture = await screen.captureAndOcr();
  const isDirectMessage = /^@/.test(strippedTitle);

  return {
    appName: resolution.resolvedTarget,
    conversationTitle: strippedTitle,
    isDirectMessage,
    imagePath: capture.imagePath,
    ocrText: capture.text,
    messages: isDirectMessage ? parseVisibleDiscordMessages(capture.text) : []
  };
}

async function resumeSpotifyMac() {
  await runAppleScript(['tell application "Spotify" to playpause']);

  return {
    appName: "Spotify",
    action: "playpause"
  };
}

async function controlSpotifyMac(command = "") {
  const normalized = normalizeAppToken(command);
  const commandMap = {
    play: "play",
    resume: "play",
    pause: "pause",
    stop: "pause",
    playpause: "playpause",
    toggle: "playpause",
    next: "next track",
    nexttrack: "next track",
    previous: "previous track",
    prev: "previous track",
    previoustrack: "previous track"
  };
  const action = commandMap[normalized];

  if (!action) {
    throw new Error(`Unsupported Spotify command: ${command}`);
  }

  await runAppleScript([`tell application "Spotify" to ${action}`]);

  return {
    appName: "Spotify",
    action: normalized
  };
}

async function openAppWindows(appName) {
  await execFileAsync("cmd", ["/c", "start", "", appName]);
  return {
    requestedTarget: appName,
    resolvedTarget: appName,
    appName,
    strategy: "direct"
  };
}

async function openUrlWindows(url) {
  await execFileAsync("cmd", ["/c", "start", "", url]);
  return { target: url };
}

async function openUrlLinux(url) {
  await execFileAsync("xdg-open", [url]);
  return { target: url };
}

function unsupported(action) {
  throw new Error(`${action} is not implemented for this OS yet.`);
}

function buildCapabilitySet(currentPlatform) {
  return {
    currentPlatform,
    wakeWord: "planned",
    speechToText: "planned",
    textToSpeech: "provider-based",
    screenReading: "planned",
    browserAutomation: "playwright + system-browser fallback",
    appCatalog: currentPlatform === "darwin" ? "spotlight + filesystem" : "basic",
    appAutomation: currentPlatform === "darwin" ? "applescript + system events" : "basic",
    credentialHandling: "session-based or password-manager only"
  };
}

function createAutomationAdapter({ screen } = {}) {
  const currentPlatform = platform();

  if (currentPlatform === "darwin") {
    return {
      getCapabilities() {
        return buildCapabilitySet(currentPlatform);
      },
      async describeCurrentContext() {
        return getFrontmostAppMac();
      },
      async listInstalledApps(options = {}) {
        return listInstalledAppsMac(options);
      },
      async resolveAppTarget(appName, options = {}) {
        return resolveMacAppTarget(appName, options);
      },
      async execute(action) {
        if (action.type === "open_app") return openAppMac(action.target);
        if (action.type === "focus_app") return focusAppMac(action.target);
        if (action.type === "open_url") return openUrlMac(action.target);
        if (action.type === "app_type") return typeInAppMac(action.target, action.text || "");
        if (action.type === "app_key") return pressKeyMac(action.target, action.key, action.modifiers || []);
        if (action.type === "app_shortcut") return pressKeyMac(action.target, action.key, action.modifiers || []);
        if (action.type === "app_menu_click") return clickMenuItemMac(action.target, action.menuPath || []);
        if (action.type === "finder_open_path") return openFinderPathMac(action.target || "");
        if (action.type === "finder_new_window") return openFinderWindowMac(action.target || "");
        if (action.type === "finder_search") return searchFinderMac(action.query || action.target || "");
        if (action.type === "notes_create_note") return createNoteMac({ title: action.title || "", body: action.body || "" });
        if (action.type === "notes_search") return searchNotesMac(action.query || action.target || "");
        if (action.type === "chrome_navigate") return navigateChromeMac(action.target || "", { newTab: Boolean(action.newTab) });
        if (action.type === "workspace_switch_target") return switchWorkspaceTargetMac(action.targetApp || action.target, action.destination || action.query || "");
        if (action.type === "workspace_send_message") return sendWorkspaceMessageMac(action.targetApp || action.target, { target: action.destination || "", message: action.message || "" });
        if (action.type === "workspace_read_messages") {
          if (normalizeAppToken(action.targetApp || action.target) === "discord") {
            return readDiscordVisibleMessagesMac(screen);
          }

          throw new Error("Reading messages is only wired for Discord right now.");
        }
        if (action.type === "spotify_resume") return resumeSpotifyMac();
        if (action.type === "spotify_control") return controlSpotifyMac(action.command || action.target || "");
        return { skipped: true, reason: "Action is part of the scaffold but not wired yet." };
      },
      async typeText(text) {
        return insertTextIntoFrontAppMac(text);
      },
      async clickCoordinate(x, y) {
        return clickScreenPointMac(x, y);
      },
      async runShellCommand(command) {
        const { stdout } = await execAsync(command);
        return stdout.trim();
      },
      async getActiveApp() {
        return getFrontmostAppMac();
      }
    };
  }

  if (currentPlatform === "win32") {
    return {
      getCapabilities() {
        return buildCapabilitySet(currentPlatform);
      },
      async describeCurrentContext() {
        return {
          appName: "Windows Desktop",
          windowTitle: ""
        };
      },
      async listInstalledApps() {
        return {
          query: "",
          totalCount: 0,
          resultCount: 0,
          apps: []
        };
      },
      async resolveAppTarget(appName) {
        return {
          requestedTarget: appName,
          resolvedTarget: appName,
          openPath: "",
          strategy: "direct"
        };
      },
      async execute(action) {
        if (action.type === "open_app") return openAppWindows(action.target);
        if (action.type === "open_url") return openUrlWindows(action.target);
        return { skipped: true, reason: "App automation is not wired for Windows yet." };
      },
      async typeText(text) {
        exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${String(text).replace(/'/g, "''")}')"`);
      },
      async clickCoordinate() { throw new Error("clickCoordinate is not implemented for Windows yet."); },
      async runShellCommand(command) {
        const { stdout } = await execAsync(command);
        return stdout.trim();
      },
      async getActiveApp() { return "Windows App"; }
    };
  }

  return {
    getCapabilities() {
      return buildCapabilitySet(currentPlatform);
    },
    async describeCurrentContext() {
      return {
        appName: "",
        windowTitle: ""
      };
    },
    async listInstalledApps() {
      return {
        query: "",
        totalCount: 0,
        resultCount: 0,
        apps: []
      };
    },
    async resolveAppTarget(appName) {
      return {
        requestedTarget: appName,
        resolvedTarget: appName,
        openPath: "",
        strategy: "direct"
      };
    },
    async execute(action) {
      if (action.type === "open_url") return openUrlLinux(action.target);
      return unsupported(action.type);
    },
    async typeText() { throw new Error("Not implemented"); },
    async clickCoordinate() { throw new Error("Not implemented"); },
    async runShellCommand() { throw new Error("Not implemented"); },
    async getActiveApp() { return "Linux App"; }
  };
}

module.exports = {
  createAutomationAdapter
};
