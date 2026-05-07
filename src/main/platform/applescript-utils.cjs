const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const { buildUsingClause } = require("./keymap.cjs");
const { normalizeAppToken } = require("./app-registry.cjs");

const execFileAsync = promisify(execFile);

function escapeAppleScriptString(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
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

function buildMenuClickExpression(menuPath, normalizeMenuPath) {
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

function buildAppKeyActionLine(normalizedKey, keyCode, modifiers = []) {
  const usingClause = buildUsingClause(modifiers);
  return keyCode
    ? `key code ${keyCode}${usingClause}`
    : `keystroke "${escapeAppleScriptString(normalizedKey)}"${usingClause}`;
}

module.exports = {
  buildAppKeyActionLine,
  buildKeystrokeLines,
  buildMenuClickExpression,
  clickAndPasteAtPointMac,
  clickScreenPointMac,
  captureWindowImageMac,
  escapeAppleScriptString,
  getClipboardTextMac,
  getVisibleWindowInfoMac,
  insertTextIntoFrontAppMac,
  pasteTextIntoFrontAppMac,
  postLowLevelKeyMac,
  recognizeTextInImageMac,
  runAppleScript,
  runSwiftScriptMac,
  setClipboardTextMac,
  shouldPreferClipboardPaste
};
