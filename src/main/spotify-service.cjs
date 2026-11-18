const path = require("node:path");
const { runAppleScript } = require("./platform/applescript-utils.cjs");

const SPOTIFY_WEB = "https://open.spotify.com";
const SPOTIFY_ID = "[A-Za-z0-9]{22}";
const CONTENT_TYPE = "track|album|artist|playlist|episode|show";
const SPOTIFY_URI = new RegExp("^spotify:(" + CONTENT_TYPE + "):(" + SPOTIFY_ID + ")$");
const SPOTIFY_PATH = new RegExp("^/(?:intl-[a-z]{2}(?:-[a-z]{2})?/)?(" + CONTENT_TYPE + ")/(" + SPOTIFY_ID + ")/?$");
const PLAYER_STATES = new Set(["playing", "paused", "stopped", "closed", "unknown"]);
const TRANSPORT = new Map([
  ["resume", "play"],
  ["pause", "pause"],
  ["next", "next track"],
  ["previous", "previous track"]
]);

function spotifyError(code) {
  return Object.assign(new Error(code), { code });
}

function parseSpotifyLink(input) {
  if (typeof input !== "string" || input.length > 512) return null;
  const value = input.trim();
  let match = value.match(SPOTIFY_URI);
  if (!match) {
    if (!/^https:\/\//i.test(value) || /[\x00-\x20\x7f\\]/.test(value)) return null;
    try {
      const url = new URL(value);
      if (url.origin !== SPOTIFY_WEB || url.username || url.password) return null;
      match = url.pathname.match(SPOTIFY_PATH);
    } catch {
      return null;
    }
  }
  if (!match) return null;
  const [, type, id] = match;
  return { type, uri: "spotify:" + type + ":" + id, webUrl: SPOTIFY_WEB + "/" + type + "/" + id };
}

function spotifyGuidance(language) {
  const reply = language === "ko"
    ? "로컬 도구에서 Spotify를 열어 곡을 찾거나 재생을 제어하세요."
    : "Open Spotify from Local tools to search or control playback.";
  return { reply, language, provider: "local", actions: [] };
}

function buildSpotifyScript(command, link) {
  const action = command === "track" ? parseSpotifyLink(link) : null;
  if (command === "track" && action?.type !== "track") throw spotifyError("SPOTIFY_LINK");
  const instruction = action ? 'play track "' + action.uri + '"' : TRANSPORT.get(command);
  if (command && !instruction) throw spotifyError("SPOTIFY_COMMAND");

  const readState = [
    "set reportedState to player state",
    'set observedState to "unknown"',
    'if reportedState is playing then set observedState to "playing"',
    'if reportedState is paused then set observedState to "paused"',
    'if reportedState is stopped then set observedState to "stopped"'
  ];
  const lines = [
    'if application id "com.spotify.client" is not running then return "closed"',
    "with timeout of 5 seconds",
    'tell application id "com.spotify.client"'
  ];
  if (instruction) {
    // Once a command is sent, a failed status read must not imply it can be safely repeated.
    lines.push(instruction, "try", ...readState, "on error", 'return "unknown"', "end try");
  } else {
    lines.push(...readState);
  }
  lines.push(
    'set trackName to ""',
    'set trackArtist to ""',
    'if observedState is not "stopped" then',
    "try",
    "set trackName to name of current track",
    "set trackArtist to artist of current track",
    "end try",
    "end if",
    "end tell",
    "end timeout",
    "set oldDelimiters to AppleScript's text item delimiters",
    "set AppleScript's text item delimiters to ASCII character 31",
    "set reportText to {observedState, trackName, trackArtist} as text",
    "set AppleScript's text item delimiters to oldDelimiters",
    "return reportText"
  );
  return lines;
}

function normalizeLabel(value) {
  return value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, 180);
}

class SpotifyService {
  constructor({ locateApp, openAppPath, openExternal, currentPlatform = process.platform, runScript = runAppleScript } = {}) {
    this.locateApp = locateApp;
    this.openAppPath = openAppPath;
    this.openExternal = openExternal;
    this.currentPlatform = currentPlatform;
    this.runScript = runScript;
  }

  async nativePath() {
    if (this.currentPlatform !== "darwin" || !this.locateApp) return null;
    const candidate = await this.locateApp().catch(() => null);
    return typeof candidate === "string" && path.isAbsolute(candidate) && path.basename(candidate) === "Spotify.app"
      ? candidate : null;
  }

  async availability() {
    if (this.currentPlatform !== "darwin") return { native: "unsupported" };
    return { native: await this.nativePath() ? "available" : "missing" };
  }

  async openPlayer(assertAllowed) {
    const appPath = await this.nativePath();
    assertAllowed();
    if (appPath) {
      if (await this.openAppPath(appPath)) throw spotifyError("SPOTIFY_OPEN");
      return { destination: "app" };
    }
    await this.openExternal(SPOTIFY_WEB + "/");
    return { destination: "web-player" };
  }

  async openSearch(input, assertAllowed) {
    const text = typeof input === "string" ? input.trim() : "";
    if (!text || text.length > 512) throw spotifyError("SPOTIFY_INPUT");
    const link = parseSpotifyLink(text);
    const looksLikeLink = /^spotify:|^[a-z][a-z0-9+.-]*:\/\/|^www\./i.test(text);
    if (!link && looksLikeLink) throw spotifyError("SPOTIFY_LINK");
    if (!link && text.length > 160) throw spotifyError("SPOTIFY_INPUT");
    const url = link?.webUrl || SPOTIFY_WEB + "/search/" + encodeURIComponent(text.toWellFormed());
    assertAllowed();
    await this.openExternal(url);
    return { destination: link ? "link" : "search" };
  }

  async readPlayer({ command, link, assertAllowed } = {}) {
    const lines = buildSpotifyScript(command, link);
    if (!(await this.nativePath())) throw spotifyError("SPOTIFY_UNAVAILABLE");
    assertAllowed();
    let raw;
    try {
      raw = await this.runScript(lines, { timeout: 9000 });
    } catch (error) {
      if (error.code === "APPLE_EVENTS_PERMISSION") throw spotifyError("SPOTIFY_OS_PERMISSION");
      throw spotifyError("SPOTIFY_PLAYER");
    }
    assertAllowed();
    const parts = raw.split("\u001f");
    const state = PLAYER_STATES.has(parts[0]) ? parts[0] : "unknown";
    if (command && state === "closed") throw spotifyError("SPOTIFY_CLOSED");
    return {
      state,
      title: parts.length === 3 ? normalizeLabel(parts[1]) : "",
      artist: parts.length === 3 ? normalizeLabel(parts[2]) : "",
      requested: Boolean(command)
    };
  }
}

module.exports = { SpotifyService, buildSpotifyScript, parseSpotifyLink, spotifyGuidance };
