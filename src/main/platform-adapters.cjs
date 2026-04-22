const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { homedir, platform } = require("node:os");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const MAC_APP_SEARCH_DIRS = [
  "/Applications",
  "/System/Applications",
  path.join("/System/Applications", "Utilities"),
  path.join(homedir(), "Applications")
];

const APP_ALIASES = {
  chrome: "Google Chrome",
  googlechrome: "Google Chrome",
  googlechromecanary: "Google Chrome Canary",
  크롬: "Google Chrome",
  구글크롬: "Google Chrome",
  아크: "Arc",
  arc: "Arc",
  safari: "Safari",
  사파리: "Safari",
  firefox: "Firefox",
  파이어폭스: "Firefox",
  brave: "Brave Browser",
  bravebrowser: "Brave Browser",
  브레이브: "Brave Browser",
  slack: "Slack",
  슬랙: "Slack",
  discord: "Discord",
  디스코드: "Discord",
  notion: "Notion",
  노션: "Notion",
  spotify: "Spotify",
  스포티파이: "Spotify",
  steam: "Steam",
  스팀: "Steam",
  epic: "Epic Games Launcher",
  epicgames: "Epic Games Launcher",
  epicgameslauncher: "Epic Games Launcher",
  에픽: "Epic Games Launcher",
  에픽게임즈: "Epic Games Launcher",
  에픽게임즈런처: "Epic Games Launcher",
  obs: "OBS",
  obsstudio: "OBS",
  vscode: "Visual Studio Code",
  visualstudiocode: "Visual Studio Code",
  code: "Visual Studio Code",
  브이에스코드: "Visual Studio Code",
  비주얼스튜디오코드: "Visual Studio Code",
  파인더: "Finder",
  finder: "Finder",
  terminal: "Terminal",
  터미널: "Terminal",
  iterm: "iTerm",
  iterm2: "iTerm",
  아이텀: "iTerm",
  messages: "Messages",
  메시지: "Messages",
  notes: "Notes",
  메모: "Notes",
  calendar: "Calendar",
  캘린더: "Calendar",
  달력: "Calendar",
  mail: "Mail",
  메일: "Mail",
  preview: "Preview",
  미리보기: "Preview",
  photos: "Photos",
  사진: "Photos",
  music: "Music",
  음악: "Music",
  appstore: "App Store",
  앱스토어: "App Store",
  systemsettings: "System Settings",
  시스템설정: "System Settings",
  settings: "System Settings",
  설정: "System Settings",
  xcode: "Xcode",
  엑스코드: "Xcode",
  chatgpt: "ChatGPT",
  챗지피티: "ChatGPT"
};

const APPLE_KEY_CODES = {
  enter: 36,
  return: 36,
  tab: 48,
  space: 49,
  escape: 53,
  esc: 53,
  delete: 51,
  backspace: 51,
  down: 125,
  up: 126,
  left: 123,
  right: 124
};

const APPLE_MODIFIERS = {
  command: "command down",
  cmd: "command down",
  shift: "shift down",
  option: "option down",
  alt: "option down",
  control: "control down",
  ctrl: "control down"
};

const FINDER_LOCATION_ALIASES = {
  home: homedir(),
  홈: homedir(),
  desktop: path.join(homedir(), "Desktop"),
  desktopfolder: path.join(homedir(), "Desktop"),
  바탕화면: path.join(homedir(), "Desktop"),
  바탕화면폴더: path.join(homedir(), "Desktop"),
  documents: path.join(homedir(), "Documents"),
  document: path.join(homedir(), "Documents"),
  documentsfolder: path.join(homedir(), "Documents"),
  문서: path.join(homedir(), "Documents"),
  문서폴더: path.join(homedir(), "Documents"),
  downloads: path.join(homedir(), "Downloads"),
  download: path.join(homedir(), "Downloads"),
  downloadsfolder: path.join(homedir(), "Downloads"),
  내려받기: path.join(homedir(), "Downloads"),
  다운로드: path.join(homedir(), "Downloads"),
  다운로드폴더: path.join(homedir(), "Downloads"),
  applications: "/Applications",
  application: "/Applications",
  apps: "/Applications",
  app: "/Applications",
  응용프로그램: "/Applications"
};

let macAppCatalogPromise = null;

function normalizeAppToken(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\.app$/i, "")
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function splitSearchTokens(value = "") {
  return String(value)
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/g)
    .filter(Boolean);
}

function buildInitialism(value = "") {
  return splitSearchTokens(value)
    .map((token) => token[0] || "")
    .join("");
}

function escapeAppleScriptString(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function buildUsingClause(modifiers = []) {
  const normalized = [...new Set((modifiers || []).map((modifier) => APPLE_MODIFIERS[String(modifier).toLowerCase()]).filter(Boolean))];
  return normalized.length ? ` using {${normalized.join(", ")}}` : "";
}

function normalizeKeyToken(value = "") {
  return String(value).trim().toLowerCase();
}

function normalizeSingleLineText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeFinderToken(value = "") {
  return normalizeAppToken(
    String(value)
      .replace(/\b(folder|directory|path)\b/gi, "")
      .replace(/폴더|디렉터리|경로/g, "")
  );
}

function normalizeMenuPath(menuPath) {
  if (Array.isArray(menuPath)) {
    return menuPath.map((part) => String(part).trim()).filter(Boolean);
  }

  return String(menuPath)
    .split(/>|\/|→|›/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildWorkspaceQuickSwitchQuery(appName, target = "") {
  const cleanTarget = normalizeSingleLineText(target).replace(/^[@#]+/, "");
  const normalizedApp = normalizeAppToken(appName);

  if (!cleanTarget) {
    return "";
  }

  if (normalizedApp === "discord") {
    return cleanTarget;
  }

  return cleanTarget;
}

function stripWorkspaceWindowTitleSuffix(title = "", appName = "") {
  const cleanTitle = normalizeSingleLineText(title);
  const cleanAppName = normalizeSingleLineText(appName);

  if (!cleanTitle) {
    return "";
  }

  if (cleanAppName) {
    return cleanTitle.replace(new RegExp(`\\s+-\\s+${cleanAppName}\\s*$`, "i"), "").trim();
  }

  return cleanTitle.replace(/\s+-\s+(Discord|Slack)\s*$/i, "").trim();
}

function normalizeWorkspaceConversationToken(value = "") {
  return normalizeSingleLineText(
    String(value)
      .replace(/^[@#]+/, "")
      .replace(/\s+-\s+(Discord|Slack)\s*$/i, "")
  )
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function splitWorkspaceMeaningfulTokens(value = "") {
  return [...new Set(
    normalizeSingleLineText(value)
      .toLowerCase()
      .split(/[^a-z0-9가-힣]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  )];
}

function workspaceConversationTitleMatchesTarget(appName, title = "", target = "") {
  const strippedTitle = stripWorkspaceWindowTitleSuffix(title, appName);
  const normalizedTitle = normalizeWorkspaceConversationToken(strippedTitle);
  const normalizedTarget = normalizeWorkspaceConversationToken(target);
  const titleTokens = splitWorkspaceMeaningfulTokens(strippedTitle);
  const targetTokens = splitWorkspaceMeaningfulTokens(target);

  if (!normalizedTitle || !normalizedTarget) {
    return false;
  }

  if (normalizedTitle === normalizedTarget) {
    return true;
  }

  if (normalizedTarget.length <= 1) {
    return false;
  }

  return (
    normalizedTitle.startsWith(normalizedTarget) ||
    normalizedTarget.startsWith(normalizedTitle) ||
    normalizedTitle.includes(normalizedTarget) ||
    (targetTokens.length >= 2 && targetTokens.every((token) => titleTokens.some((candidate) => candidate.includes(token))))
  );
}

function buildDiscordTargetStrategies(target = "") {
  const destination = normalizeSingleLineText(target).replace(/^[@#]+/, "");
  const tokenQueries = splitWorkspaceMeaningfulTokens(destination);
  const queries = [
    destination,
    destination.toLowerCase(),
    `@${destination}`,
    `*${destination}`,
    `#${destination}`,
    ...tokenQueries,
    ...tokenQueries.map((token) => `*${token}`),
    ...tokenQueries.map((token) => `#${token}`)
  ].filter(Boolean);
  const uniqueQueries = [...new Set(queries)];
  const shortcuts = ["k", "t"];
  const strategies = [];

  for (const query of uniqueQueries) {
    for (const shortcut of shortcuts) {
      strategies.push({
        label: `${shortcut === "k" ? "quick-switch" : "find-conversation"}:${query}`,
        shortcut,
        query
      });
    }
  }

  return strategies;
}

function normalizeDiscordOcrText(value = "") {
  return normalizeSingleLineText(
    String(value)
      .replace(/^[@#]+/, "")
      .replace(/\s+members?$/i, "")
  ).toLowerCase();
}

function getObservationCenter(observation = {}) {
  return {
    x: Number(observation.x || 0) + Number(observation.width || 0) / 2,
    y: Number(observation.y || 0) + Number(observation.height || 0) / 2
  };
}

function observationMatchesDiscordRegion(observation = {}, region = {}) {
  const center = getObservationCenter(observation);

  if (Number.isFinite(region.minX) && center.x < region.minX) {
    return false;
  }

  if (Number.isFinite(region.maxX) && center.x > region.maxX) {
    return false;
  }

  if (Number.isFinite(region.minY) && center.y < region.minY) {
    return false;
  }

  if (Number.isFinite(region.maxY) && center.y > region.maxY) {
    return false;
  }

  return true;
}

function scoreDiscordTargetObservation(observation = {}, target = "") {
  const sourceText = normalizeSingleLineText(observation.text || "");
  const normalizedText = normalizeDiscordOcrText(sourceText);
  const normalizedTarget = normalizeDiscordOcrText(target);
  const textTokens = splitSearchTokens(normalizedText);
  const targetTokens = splitSearchTokens(normalizedTarget);
  const center = getObservationCenter(observation);

  if (!normalizedText || !normalizedTarget) {
    return Number.NEGATIVE_INFINITY;
  }

  if (/^(friends|message requests|nitro home|shop|quests|direct messages|search in dms|find or start a conversation|members?|drafts|mentions|protip)/i.test(sourceText)) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (normalizedText === normalizedTarget) {
    score += 140;
  }

  if (normalizedText.startsWith(normalizedTarget)) {
    score += 110;
  }

  if (normalizedText.includes(normalizedTarget)) {
    score += 80;
  }

  if (normalizedTarget.length === 1 && textTokens[0] === normalizedTarget) {
    score += 120;
  }

  if (targetTokens.length && targetTokens.every((token) => textTokens.some((candidate) => candidate.includes(token) || token.includes(candidate)))) {
    score += 70;
  }

  if (sourceText.toLowerCase().includes("members")) {
    score -= 30;
  }

  if (center.x <= 0.25) {
    score += 18;
  }

  if (center.x >= 0.28 && center.x <= 0.68 && center.y >= 0.34 && center.y <= 0.64) {
    score += 22;
  }

  return score;
}

function findBestDiscordObservation(observations = [], target = "", region = {}) {
  const candidates = observations
    .filter((observation) => observationMatchesDiscordRegion(observation, region))
    .map((observation) => ({
      observation,
      score: scoreDiscordTargetObservation(observation, target)
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.observation || null;
}

function parseDiscordMessageHeader(line = "") {
  const trimmed = normalizeSingleLineText(line);

  if (!trimmed) {
    return null;
  }

  const koreanMatch = trimmed.match(/^(.+?)\s+(오전|오후)\s+(\d{1,2}:\d{2})$/i);

  if (koreanMatch?.[1]) {
    return {
      author: cleanupWorkspaceLabel(koreanMatch[1]),
      time: `${koreanMatch[2]} ${koreanMatch[3]}`
    };
  }

  const englishMatch = trimmed.match(/^(.+?)\s+(\d{1,2}:\d{2}\s*(?:AM|PM))$/i);

  if (englishMatch?.[1]) {
    return {
      author: cleanupWorkspaceLabel(englishMatch[1]),
      time: englishMatch[2]
    };
  }

  return null;
}

function cleanupWorkspaceLabel(value = "") {
  return normalizeSingleLineText(
    String(value)
      .replace(/^[@#]+/, "")
      .replace(/[|·•]+$/g, "")
  );
}

function looksLikeDiscordUiNoise(line = "") {
  return /^(friends|nitro|shop|message requests|discover|apps|threads|message @|gif|sticker|emoji|today|yesterday|edited|new messages)$/i.test(
    normalizeSingleLineText(line)
  );
}

function parseVisibleDiscordMessages(ocrText = "") {
  const lines = String(ocrText)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const messages = [];
  let current = null;

  for (const line of lines) {
    const header = parseDiscordMessageHeader(line);

    if (header?.author) {
      if (current?.author && current.lines.length) {
        messages.push({
          author: current.author,
          time: current.time,
          text: current.lines.join(" ")
        });
      }

      current = {
        author: header.author,
        time: header.time,
        lines: []
      };
      continue;
    }

    if (!current || looksLikeDiscordUiNoise(line)) {
      continue;
    }

    current.lines.push(line);
  }

  if (current?.author && current.lines.length) {
    messages.push({
      author: current.author,
      time: current.time,
      text: current.lines.join(" ")
    });
  }

  return messages.slice(-8);
}

function buildAppEntry(appPath) {
  return {
    name: path.basename(appPath, ".app"),
    path: appPath
  };
}

function buildKeystrokeLines(text = "") {
  const parts = String(text).split(/\r?\n/g);
  const lines = [];

  parts.forEach((part, index) => {
    if (part) {
      lines.push(`keystroke "${escapeAppleScriptString(part)}"`);
    }

    if (index < parts.length - 1) {
      lines.push("key code 36");
    }
  });

  return lines;
}

async function runAppleScript(lines) {
  const scriptLines = Array.isArray(lines) ? lines : [lines];
  const args = [];

  scriptLines.forEach((line) => {
    args.push("-e", line);
  });

  try {
    const { stdout } = await execFileAsync("osascript", args);
    return stdout.trim();
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || "").trim();

    if (/assistive access|not authorized|not allowed|(-1719)|(-25211)/i.test(detail)) {
      throw new Error(
        "macOS Accessibility permission is required for app automation. Enable it for Electron or your terminal app in System Settings > Privacy & Security > Accessibility."
      );
    }

    throw new Error(detail || "AppleScript execution failed.");
  }
}

async function runSwiftScriptMac(script, args = []) {
  try {
    const swiftArgs = ["-e", script];

    if (args.length) {
      swiftArgs.push("--", ...args.map((value) => String(value)));
    }

    const { stdout } = await execFileAsync("swift", swiftArgs);
    return stdout.trim();
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || "").trim();
    throw new Error(detail || "Swift automation failed.");
  }
}

async function getVisibleWindowInfoMac(appName) {
  const output = await runSwiftScriptMac(
    `
import CoreGraphics
import Foundation

struct WindowInfo: Codable {
  let id: Int
  let title: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

func numberValue(_ value: Any?) -> Double {
  if let number = value as? NSNumber { return number.doubleValue }
  return 0
}

let owner = CommandLine.arguments[1]
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let raw = (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? [])
let windows = raw.compactMap { item -> WindowInfo? in
  guard (item[kCGWindowOwnerName as String] as? String) == owner else { return nil }
  let layer = (item[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
  let alpha = numberValue(item[kCGWindowAlpha as String])
  let bounds = item[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let width = numberValue(bounds["Width"])
  let height = numberValue(bounds["Height"])
  guard layer == 0, alpha > 0, width > 320, height > 240 else { return nil }
  return WindowInfo(
    id: (item[kCGWindowNumber as String] as? NSNumber)?.intValue ?? -1,
    title: item[kCGWindowName as String] as? String ?? "",
    x: numberValue(bounds["X"]),
    y: numberValue(bounds["Y"]),
    width: width,
    height: height
  )
}.sorted {
  let leftHasTitle = !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  let rightHasTitle = !$1.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty

  if leftHasTitle != rightHasTitle {
    return leftHasTitle && !rightHasTitle
  }

  return ($0.width * $0.height) > ($1.width * $1.height)
}

guard let first = windows.first else {
  fputs("window-not-found\\n", stderr)
  exit(1)
}

let data = try JSONEncoder().encode(first)
print(String(data: data, encoding: .utf8) ?? "{}")
    `,
    [appName]
  );

  return JSON.parse(output || "{}");
}

async function captureWindowImageMac(appName, label = "capture") {
  const window = await getVisibleWindowInfoMac(appName);
  const imagePath = path.join("/tmp", `jarvis-${normalizeAppToken(appName) || "app"}-${label}-${Date.now()}.png`);
  await execFileAsync("screencapture", ["-x", "-l", String(window.id), imagePath]);

  return {
    window,
    imagePath
  };
}

async function recognizeTextInImageMac(imagePath) {
  const output = await runSwiftScriptMac(
    `
import Vision
import AppKit
import Foundation

struct Observation: Codable {
  let text: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

let imagePath = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fputs("ocr-image-load-failed\\n", stderr)
  exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["en-US", "ko-KR"]
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])

let observations = (request.results ?? []).compactMap { observation -> Observation? in
  guard let candidate = observation.topCandidates(1).first else { return nil }
  let box = observation.boundingBox
  return Observation(
    text: candidate.string,
    x: box.origin.x,
    y: box.origin.y,
    width: box.size.width,
    height: box.size.height
  )
}

let data = try JSONEncoder().encode(observations)
print(String(data: data, encoding: .utf8) ?? "[]")
    `,
    [imagePath]
  );

  return JSON.parse(output || "[]");
}

async function clickScreenPointMac(x, y) {
  await runSwiftScriptMac(
    `
import ApplicationServices
import Foundation

let x = Double(CommandLine.arguments[1]) ?? 0
let y = Double(CommandLine.arguments[2]) ?? 0
let point = CGPoint(x: x, y: y)

func post(_ event: CGEvent?) {
  event?.post(tap: .cghidEventTap)
}

post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left))
usleep(120000)
post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left))
usleep(70000)
post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left))
    `,
    [x, y]
  );
}

async function postLowLevelKeyMac(keyCode, { command = false } = {}) {
  await runSwiftScriptMac(
    `
import ApplicationServices
import Foundation

let keyCode = CGKeyCode(Int(CommandLine.arguments[1]) ?? 0)
let usesCommand = (CommandLine.arguments[2] == "1")
let flags: CGEventFlags = usesCommand ? .maskCommand : []

func post(_ downValue: Bool) {
  let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: downValue)
  event?.flags = flags
  event?.post(tap: .cghidEventTap)
}

post(true)
usleep(50000)
post(false)
    `,
    [keyCode, command ? 1 : 0]
  );
}

async function pasteTextWithLowLevelInputMac(text = "", { clear = true } = {}) {
  const previousClipboard = await getClipboardTextMac().catch(() => null);
  await setClipboardTextMac(text);

  try {
    await runAppleScript(["delay 0.08"]);

    if (clear) {
      await postLowLevelKeyMac(0, { command: true });
      await postLowLevelKeyMac(51);
    }

    await postLowLevelKeyMac(9, { command: true });
    await runAppleScript(["delay 0.22"]);
  } finally {
    if (previousClipboard !== null) {
      await setClipboardTextMac(previousClipboard).catch(() => {});
    }
  }
}

async function clickAndPasteAtPointMac(x, y, text = "", { restoreClipboard = true } = {}) {
  const previousClipboard = await getClipboardTextMac().catch(() => null);
  await setClipboardTextMac(text);

  try {
    await runSwiftScriptMac(
      `
import ApplicationServices
import Foundation

let x = Double(CommandLine.arguments[1]) ?? 0
let y = Double(CommandLine.arguments[2]) ?? 0
let point = CGPoint(x: x, y: y)

func postMouse(_ event: CGEvent?) {
  event?.post(tap: .cghidEventTap)
}

func postPaste() {
  let keyCode = CGKeyCode(9)
  let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true)
  down?.flags = .maskCommand
  down?.post(tap: .cghidEventTap)
  usleep(50000)
  let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
  up?.flags = .maskCommand
  up?.post(tap: .cghidEventTap)
}

postMouse(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left))
usleep(120000)
postMouse(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left))
usleep(70000)
postMouse(CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left))
usleep(250000)
postPaste()
      `,
      [x, y]
    );
    await runAppleScript(["delay 0.9"]);
  } finally {
    if (restoreClipboard && previousClipboard !== null) {
      await setClipboardTextMac(previousClipboard).catch(() => {});
    }
  }

  return {
    previousClipboard
  };
}

function shouldPreferClipboardPaste(text = "") {
  return /[^\x00-\x7F]/.test(text) || /[\r\n]/.test(text) || String(text).length > 42;
}

async function getClipboardTextMac() {
  return runAppleScript([
    "try",
    "return the clipboard as text",
    "on error",
    'return ""',
    "end try"
  ]);
}

async function setClipboardTextMac(text = "") {
  await runAppleScript(`set the clipboard to "${escapeAppleScriptString(text)}"`);
}

async function pasteTextIntoFrontAppMac(text = "") {
  const previousClipboard = await getClipboardTextMac().catch(() => null);

  await setClipboardTextMac(text);

  try {
    await runAppleScript([
      'tell application "System Events"',
      'keystroke "v" using {command down}',
      "end tell"
    ]);
  } finally {
    if (previousClipboard !== null) {
      await setClipboardTextMac(previousClipboard).catch(() => {});
    }
  }
}

async function insertTextIntoFrontAppMac(text = "", { preferPaste = false } = {}) {
  const value = String(text);

  if (!value) {
    return {
      method: "none"
    };
  }

  if (preferPaste || shouldPreferClipboardPaste(value)) {
    await pasteTextIntoFrontAppMac(value);
    return {
      method: "paste"
    };
  }

  try {
    await runAppleScript([
      'tell application "System Events"',
      ...buildKeystrokeLines(value),
      "end tell"
    ]);

    return {
      method: "keystroke"
    };
  } catch (_error) {
    await pasteTextIntoFrontAppMac(value);
    return {
      method: "paste-fallback"
    };
  }
}

async function walkAppBundles(directory, depth = 2) {
  if (depth < 0) {
    return [];
  }

  let entries = [];

  try {
    entries = await fs.readdir(directory, {
      withFileTypes: true
    });
  } catch (_error) {
    return [];
  }

  const bundles = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.name.endsWith(".app")) {
      bundles.push({
        name: entry.name.replace(/\.app$/i, ""),
        path: fullPath
      });
      continue;
    }

    if (depth > 0 && !entry.name.startsWith(".")) {
      bundles.push(...(await walkAppBundles(fullPath, depth - 1)));
    }
  }

  return bundles;
}

async function querySpotlightApps() {
  try {
    const { stdout } = await execFileAsync("mdfind", ['kMDItemContentType == "com.apple.application-bundle"']);
    return stdout
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".app"))
      .map(buildAppEntry);
  } catch (_error) {
    return [];
  }
}

async function buildMacAppCatalog() {
  const allBundles = [];

  for (const directory of MAC_APP_SEARCH_DIRS) {
    allBundles.push(...(await walkAppBundles(directory, 2)));
  }

  allBundles.push(...(await querySpotlightApps()));

  const seen = new Set();
  return allBundles
    .filter((bundle) => {
      const normalizedPath = bundle.path.toLowerCase();
      if (!bundle.name || !bundle.path || seen.has(normalizedPath)) {
        return false;
      }

      seen.add(normalizedPath);
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function getMacAppCatalog({ forceRefresh = false } = {}) {
  if (forceRefresh) {
    macAppCatalogPromise = null;
  }

  if (!macAppCatalogPromise) {
    macAppCatalogPromise = buildMacAppCatalog();
  }

  return macAppCatalogPromise;
}

function scoreAppMatch(query, bundle) {
  const requestedTarget = String(query).trim();
  const normalizedQuery = normalizeAppToken(requestedTarget);

  if (!requestedTarget || !normalizedQuery) {
    return 0;
  }

  const normalizedName = normalizeAppToken(bundle.name);
  const queryWords = splitSearchTokens(requestedTarget);
  const nameWords = splitSearchTokens(bundle.name);
  const initialism = buildInitialism(bundle.name);
  let score = 0;

  if (normalizedName === normalizedQuery) {
    score = 120;
  } else if (bundle.name.toLowerCase() === requestedTarget.toLowerCase()) {
    score = 115;
  } else if (initialism && initialism === normalizedQuery) {
    score = 108;
  } else if (normalizedName.startsWith(normalizedQuery)) {
    score = 104;
  } else if (normalizedName.includes(normalizedQuery)) {
    score = 96;
  } else if (normalizedQuery.includes(normalizedName)) {
    score = 92;
  }

  if (queryWords.length && queryWords.every((word) => nameWords.some((candidate) => candidate.includes(word) || word.includes(candidate)))) {
    score = Math.max(score, 90 + Math.min(queryWords.length, 4));
  }

  return score;
}

async function searchMacApps(query, { limit = 20 } = {}) {
  const catalog = await getMacAppCatalog();

  if (!String(query).trim()) {
    return catalog.slice(0, limit);
  }

  return catalog
    .map((bundle) => ({
      ...bundle,
      score: scoreAppMatch(query, bundle)
    }))
    .filter((bundle) => bundle.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit);
}

async function listInstalledAppsMac({ query = "", limit = 200, forceRefresh = false } = {}) {
  const catalog = await getMacAppCatalog({
    forceRefresh
  });
  const apps = query ? await searchMacApps(query, { limit }) : catalog.slice(0, limit);

  return {
    query,
    totalCount: catalog.length,
    resultCount: apps.length,
    apps: apps.map((app) => ({
      name: app.name,
      path: app.path
    }))
  };
}

async function resolveMacAppTarget(appName = "", { allowDirect = true } = {}) {
  const requestedTarget = String(appName).trim();
  const normalized = normalizeAppToken(requestedTarget);

  if (!requestedTarget) {
    throw new Error("An app name is required.");
  }

  const aliasedName = APP_ALIASES[normalized];
  const matchedApp = (await searchMacApps(aliasedName || requestedTarget, { limit: 1 }))[0];

  if (matchedApp) {
    return {
      requestedTarget,
      resolvedTarget: matchedApp.name,
      openPath: matchedApp.path,
      strategy: aliasedName ? "alias-catalog" : "catalog-search"
    };
  }

  if (!allowDirect) {
    return null;
  }

  return {
    requestedTarget,
    resolvedTarget: aliasedName || requestedTarget,
    openPath: "",
    strategy: aliasedName ? "alias-direct" : "direct"
  };
}

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
  const standardTitle =
    titles.find((title) => title.endsWith(` - ${resolvedName}`)) ||
    titles[titles.length - 1] ||
    "";

  return standardTitle;
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
  return {
    target: url
  };
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
  const keyCode = APPLE_KEY_CODES[normalizedKey];
  const usingClause = buildUsingClause(modifiers);

  const actionLine = keyCode
    ? `key code ${keyCode}${usingClause}`
    : `keystroke "${escapeAppleScriptString(normalizedKey)}"${usingClause}`;

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

async function runShortcutMac(appName, key, modifiers = []) {
  return pressKeyMac(appName, key, modifiers);
}

function buildMenuClickExpression(menuPath) {
  const parts = normalizeMenuPath(menuPath);

  if (parts.length < 2) {
    throw new Error('Menu paths must include at least a top-level menu and one item, for example "File > New Window".');
  }

  const topLevel = escapeAppleScriptString(parts[0]);
  let menuExpression = `menu "${topLevel}" of menu bar item "${topLevel}" of menu bar 1`;

  for (const part of parts.slice(1, -1)) {
    menuExpression = `menu 1 of menu item "${escapeAppleScriptString(part)}" of ${menuExpression}`;
  }

  return `click menu item "${escapeAppleScriptString(parts[parts.length - 1])}" of ${menuExpression}`;
}

async function clickMenuItemMac(appName, menuPath) {
  const resolution = await focusAppMac(appName);
  const clickExpression = buildMenuClickExpression(menuPath);

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

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function resolveFinderPath(target = "") {
  const requested = String(target).trim().replace(/^["']|["']$/g, "");
  const normalized = normalizeFinderToken(requested);

  if (!requested) {
    return homedir();
  }

  if (FINDER_LOCATION_ALIASES[normalized]) {
    return FINDER_LOCATION_ALIASES[normalized];
  }

  const expanded = requested.replace(/^~(?=$|\/)/, homedir());
  const directCandidate = path.isAbsolute(expanded)
    ? expanded
    : expanded.startsWith(".") || expanded.includes("/")
      ? path.resolve(process.cwd(), expanded)
      : "";

  if (directCandidate && (await pathExists(directCandidate))) {
    return directCandidate;
  }

  const fallbackCandidates = [
    path.join(process.cwd(), requested),
    path.join(homedir(), requested),
    path.join(homedir(), "Desktop", requested),
    path.join(homedir(), "Documents", requested),
    path.join(homedir(), "Downloads", requested)
  ];

  for (const candidate of fallbackCandidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return "";
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
  const insertResult = await insertTextIntoFrontAppMac(text, {
    preferPaste: true
  });

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
    titleMethod = (await insertTextIntoFrontAppMac(cleanTitle, {
      preferPaste: true
    })).method;
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

    bodyMethod = (await insertTextIntoFrontAppMac(cleanBody, {
      preferPaste: true
    })).method;
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
  const insertResult = await insertTextIntoFrontAppMac(text, {
    preferPaste: true
  });

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
  const insertResult = await insertTextIntoFrontAppMac(destination, {
    preferPaste: true
  });
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

function convertObservationToScreenPoint(window = {}, observation = {}) {
  const center = getObservationCenter(observation);
  const clickX = center.x <= 0.25 && Number(observation.width || 0) < 0.025 ? 0.125 : center.x;

  return {
    x: Number(window.x || 0) + clickX * Number(window.width || 0),
    y: Number(window.y || 0) + (1 - center.y) * Number(window.height || 0)
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

function findDiscordSidebarConversationObservation(observations = [], target = "") {
  return findBestDiscordObservation(observations, target, {
    minX: 0.05,
    maxX: 0.24,
    minY: 0.14,
    maxY: 0.68
  });
}

function findDiscordQuickSwitcherResultObservation(observations = [], target = "") {
  const region = {
    minX: 0.28,
    maxX: 0.68,
    minY: 0.30,
    maxY: 0.62
  };
  const candidates = observations
    .filter((observation) => observationMatchesDiscordRegion(observation, region))
    .map((observation) => ({
      observation,
      score: scoreDiscordTargetObservation(observation, target),
      center: getObservationCenter(observation)
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > 0);

  if (normalizeDiscordOcrText(target).length <= 1) {
    candidates.sort((left, right) => (right.center.y - left.center.y) || (right.score - left.score));
    return candidates[0]?.observation || null;
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.observation || null;
}

function findDiscordSearchTriggerObservation(observations = []) {
  return observations.find((observation) => normalizeDiscordOcrText(observation.text).includes("find or start a conversation")) || null;
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
  const pasteSession = await clickAndPasteAtPointMac(searchPoint.x, searchPoint.y, target, {
    restoreClipboard: false
  });

  try {
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

    await clickDiscordObservationMac(appName, resultsSnapshot.window, observation, {
      activate: false
    });
    await runAppleScript(["delay 1.25"]);

    return {
      observation,
      strategy: "ocr-search"
    };
  } finally {
    if (pasteSession?.previousClipboard !== null && pasteSession?.previousClipboard !== undefined) {
      await setClipboardTextMac(pasteSession.previousClipboard).catch(() => {});
    }
  }
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
  const insertResult = await insertTextIntoFrontAppMac(quickSwitchQuery, {
    preferPaste: true
  });
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

  messageMethod = (await insertTextIntoFrontAppMac(cleanMessage, {
    preferPaste: true
  })).method;
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
  await runAppleScript([
    'tell application "Spotify" to playpause'
  ]);

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

  await runAppleScript([
    `tell application "Spotify" to ${action}`
  ]);

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
  return {
    target: url
  };
}

async function openUrlLinux(url) {
  await execFileAsync("xdg-open", [url]);
  return {
    target: url
  };
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
    browserAutomation: "planned",
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
        if (action.type === "open_app") {
          return openAppMac(action.target);
        }

        if (action.type === "focus_app") {
          return focusAppMac(action.target);
        }

        if (action.type === "open_url") {
          return openUrlMac(action.target);
        }

        if (action.type === "app_type") {
          return typeInAppMac(action.target, action.text || "");
        }

        if (action.type === "app_key") {
          return pressKeyMac(action.target, action.key, action.modifiers || []);
        }

        if (action.type === "app_shortcut") {
          return runShortcutMac(action.target, action.key, action.modifiers || []);
        }

        if (action.type === "app_menu_click") {
          return clickMenuItemMac(action.target, action.menuPath || []);
        }

        if (action.type === "finder_open_path") {
          return openFinderPathMac(action.target || "");
        }

        if (action.type === "finder_new_window") {
          return openFinderWindowMac(action.target || "");
        }

        if (action.type === "finder_search") {
          return searchFinderMac(action.query || action.target || "");
        }

        if (action.type === "notes_create_note") {
          return createNoteMac({
            title: action.title || "",
            body: action.body || ""
          });
        }

        if (action.type === "notes_search") {
          return searchNotesMac(action.query || action.target || "");
        }

        if (action.type === "chrome_navigate") {
          return navigateChromeMac(action.target || "", {
            newTab: Boolean(action.newTab)
          });
        }

        if (action.type === "workspace_switch_target") {
          return switchWorkspaceTargetMac(action.targetApp || action.target, action.destination || action.query || "");
        }

        if (action.type === "workspace_send_message") {
          return sendWorkspaceMessageMac(action.targetApp || action.target, {
            target: action.destination || "",
            message: action.message || ""
          });
        }

        if (action.type === "workspace_read_messages") {
          if (normalizeAppToken(action.targetApp || action.target) === "discord") {
            return readDiscordVisibleMessagesMac(screen);
          }

          throw new Error("Reading messages is only wired for Discord right now.");
        }

        if (action.type === "spotify_resume") {
          return resumeSpotifyMac();
        }

        if (action.type === "spotify_control") {
          return controlSpotifyMac(action.command || action.target || "");
        }

        return {
          skipped: true,
          reason: "Action is part of the scaffold but not wired yet."
        };
      },
      async typeText(text) {
        return insertTextIntoFrontAppMac(text);
      },
      async clickCoordinate(x, y) {
        return clickScreenPointMac(x, y);
      },
      async runShellCommand(command) {
        const { exec } = require("child_process");
        const { promisify } = require("util");
        const execAsync = promisify(exec);
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
        if (action.type === "open_app") {
          return openAppWindows(action.target);
        }

        if (action.type === "open_url") {
          return openUrlWindows(action.target);
        }

        return {
          skipped: true,
          reason: "App automation is not wired for Windows yet."
        };
      },
      async typeText(text) {
        // Windows implementation placeholder using powershell sendkeys
        const { exec } = require("child_process");
        exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')"`);
      },
      async clickCoordinate(x, y) {
        // Windows implementation placeholder
        throw new Error("clickCoordinate is not implemented for Windows yet.");
      },
      async runShellCommand(command) {
        const { exec } = require("child_process");
        const { promisify } = require("util");
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(command);
        return stdout.trim();
      },
      async getActiveApp() {
        return "Windows App";
      }
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
      if (action.type === "open_url") {
        return openUrlLinux(action.target);
      }

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
