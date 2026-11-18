const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const { SpotifyService, buildSpotifyScript, parseSpotifyLink } = require("../../src/main/spotify-service.cjs");

const id = "Abcdefghijklmnopqrstuv";
const track = "spotify:track:" + id;
const shared = "https://open.spotify.com/track/" + id;
const allowed = () => {};

test("Spotify share URLs and URIs canonicalize to public Spotify destinations", () => {
  for (const input of [track, shared, shared + "?si=private-fixture", "https://open.spotify.com/intl-ko/track/" + id + "#context"]) {
    assert.deepEqual(parseSpotifyLink(input), { type: "track", uri: track, webUrl: shared });
  }
  const album = parseSpotifyLink("spotify:album:" + id);
  assert.equal(album.type, "album");
  assert.equal(album.webUrl, "https://open.spotify.com/album/" + id);
  for (const input of [
    "spotify:track:short", "https://open.spotify.com.example.invalid/track/" + id,
    "https://example.invalid/track/" + id, "https://owner@open.spotify.com/track/" + id,
    "https://open.spotify.com:444/track/" + id, "http://open.spotify.com/track/" + id,
    "spotify:track:" + id + ":unexpected", "https://open.spotify.com/track/" + id + "/more",
  ]) assert.equal(parseSpotifyLink(input), null);
});

test("Spotify search opens encoded text and validated links without invoking the player", async () => {
  const opens = [];
  const service = new SpotifyService({
    locateApp: () => assert.fail("Web searches do not inspect the app"),
    runScript: () => assert.fail("Web searches must not control playback"),
    openExternal: async (url) => opens.push(url)
  });
  assert.deepEqual(await service.openSearch("artist:테스트 & live", allowed), { destination: "search" });
  assert.equal(opens[0], "https://open.spotify.com/search/" + encodeURIComponent("artist:테스트 & live"));
  assert.deepEqual(await service.openSearch(shared + "?si=private-fixture", allowed), { destination: "link" });
  assert.equal(opens[1], shared);
  await assert.rejects(service.openSearch("https://example.invalid/path", allowed), { code: "SPOTIFY_LINK" });
  await assert.rejects(service.openSearch("a".repeat(161), allowed), { code: "SPOTIFY_INPUT" });
  const revoked = Object.assign(new Error("Permission revoked"), { code: "SPOTIFY_PERMISSION" });
  await assert.rejects(service.openSearch("Example", () => { throw revoked; }), revoked);
  assert.equal(opens.length, 2);
});

test("Mac commands use only supported transport and report Spotify's state", async () => {
  const appPath = path.resolve("Applications", "Spotify.app");
  const events = [];
  const service = new SpotifyService({
    currentPlatform: "darwin",
    locateApp: async () => appPath,
    openAppPath: async (value) => { events.push(value); return ""; },
    runScript: async (lines, { timeout }) => {
      assert.equal(timeout, 9000);
      assert.match(lines[0], /is not running then return "closed"/);
      events.push(lines);
      return "paused\u001fFixture track\u001fFixture artist";
    }
  });
  assert.deepEqual(await service.availability(), { native: "available" });
  assert.deepEqual(events, []);
  assert.deepEqual(await service.readPlayer({ assertAllowed: allowed }), {
    state: "paused", title: "Fixture track", artist: "Fixture artist", requested: false
  });
  assert.equal(events[0].includes("pause"), false);

  const requested = await service.readPlayer({ command: "resume", assertAllowed: allowed });
  assert.equal(requested.state, "paused");
  assert.equal(requested.requested, true);
  assert.ok(events[1].includes("play"));
  await service.readPlayer({ command: "track", link: shared + "?si=fixture", assertAllowed: allowed });
  assert.ok(events[2].includes('play track "' + track + '"'));
  await assert.rejects(service.readPlayer({ command: "track", link: "spotify:artist:" + id, assertAllowed: allowed }), {
    code: "SPOTIFY_LINK"
  });
  assert.throws(() => buildSpotifyScript("shuffle"), { code: "SPOTIFY_COMMAND" });
  assert.equal(events.length, 3);
  assert.deepEqual(await service.openPlayer(allowed), { destination: "app" });
  assert.equal(events[3], appPath);
});

test("closed, missing, restricted and unconfirmed native states stay distinct", async () => {
  let native = "closed";
  const opens = [];
  const service = new SpotifyService({
    currentPlatform: "darwin",
    locateApp: async () => path.resolve("Applications", "Spotify.app"),
    runScript: async () => {
      if (native === "denied") throw Object.assign(new Error("Synthetic permission denial"), { code: "APPLE_EVENTS_PERMISSION" });
      return native;
    },
    openAppPath: () => assert.fail("Reading and control must not launch Spotify")
  });
  assert.equal((await service.readPlayer({ assertAllowed: allowed })).state, "closed");
  await assert.rejects(service.readPlayer({ assertAllowed: allowed, command: "next" }), { code: "SPOTIFY_CLOSED" });
  native = "denied";
  await assert.rejects(service.readPlayer({ assertAllowed: allowed }), { code: "SPOTIFY_OS_PERMISSION" });
  native = "unknown";
  assert.deepEqual(await service.readPlayer({ assertAllowed: allowed, command: "next" }), {
    state: "unknown", title: "", artist: "", requested: true
  });
  const missing = new SpotifyService({
    currentPlatform: "darwin", locateApp: async () => path.resolve("Applications", "Other Player.app"),
    openExternal: async (url) => opens.push(url)
  });
  assert.deepEqual(await missing.availability(), { native: "missing" });
  assert.deepEqual(await missing.openPlayer(allowed), { destination: "web-player" });
  assert.deepEqual(opens, ["https://open.spotify.com/"]);
  const unsupported = new SpotifyService({ currentPlatform: "linux" });
  assert.deepEqual(await unsupported.availability(), { native: "unsupported" });
  await assert.rejects(unsupported.readPlayer({ assertAllowed: allowed }), { code: "SPOTIFY_UNAVAILABLE" });
});

test("Spotify requests guide to the workspace without sending playback to an assistant model", async () => {
  const { AssistantService } = require("../../src/main/assistant-service.cjs");
  const assistant = new AssistantService({ computerControl: { enabled: false } });
  assistant.handleModelConversation = () => assert.fail("Explicit Spotify requests stay local");
  for (const query of ["spotify", "Spotify search Example", "스포티파이 검색 예시", "pause Spotify"]) {
    const result = await assistant.handleInput(query);
    assert.equal(result.provider, "local");
    assert.deepEqual(result.actions, []);
    assert.match(result.reply, /Local tools|로컬 도구/);
  }
  const route = await assistant.handleSpotifyRoute("Play an example playlist on Spotify", { query: "example" });
  assert.equal(route.provider, "local");
  assert.deepEqual(route.actions, []);
});
