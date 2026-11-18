"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useWorkspaceLocale } from "@/lib/workspace-language";

type Native = "available" | "missing" | "unsupported";
type Player = { state: "playing" | "paused" | "stopped" | "closed" | "unknown"; title: string; artist: string; requested: boolean };
type Destination = "app" | "web-player" | "link" | "search";
type Result<T> = { ok: true; data: T } | { ok: false; reason: string };

export function SpotifyPanel({ computerControl, initialQuery = "" }: { computerControl: boolean | null; initialQuery?: string }) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const [native, setNative] = useState<Native | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [input, setInput] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Destination | "transport" | null>(null);
  const ticket = useRef(0);
  const running = useRef(false);

  useEffect(() => {
    if (computerControl) {
      void run<{ native: Native }>("spotify:availability", {}, (data) => setNative(data.native));
    } else {
      setNative(null);
      setPlayer(null);
      setError(null);
      setNotice(null);
      setBusy(false);
    }
    return () => { ticket.current++; running.current = false; };
  }, [computerControl]);

  const unavailable = t("macOS용 Spotify 앱에서 재생을 제어할 수 있습니다.", "Playback controls use the Spotify app for macOS.");
  const errors: Record<string, string> = {
    SPOTIFY_INPUT: t("검색어를 160자 이내로 입력하거나 Spotify 공유 링크를 붙여넣으세요.", "Enter up to 160 search characters or paste a Spotify share link."),
    SPOTIFY_LINK: t("Spotify에서 복사한 공유 링크를 확인하세요.", "Check the share link copied from Spotify."),
    SPOTIFY_OPEN: t("Spotify를 열지 못했습니다. 앱 또는 기본 브라우저 설정을 확인하세요.", "Couldn’t open Spotify. Check the app or your default browser."),
    SPOTIFY_CLOSED: t("Spotify 앱을 연 뒤 다시 시도하세요.", "Open the Spotify app, then try again."),
    SPOTIFY_UNAVAILABLE: unavailable,
    SPOTIFY_OS_PERMISSION: t("macOS 시스템 설정의 개인정보 보호 및 보안 → 자동화에서 Spotify 제어를 허용하세요.",
      "Allow Spotify control in macOS System Settings → Privacy & Security → Automation."),
    SPOTIFY_PLAYER: t("Spotify 플레이어의 응답을 확인하지 못했습니다. 현재 상태를 확인하세요.",
      "Couldn’t confirm a response from the Spotify player. Check its current state."),
    SPOTIFY_PERMISSION: t("툴바에서 컴퓨터 제어를 확인하세요.", "Check Computer control in the toolbar."),
    SPOTIFY_BUSY: t("진행 중인 작업이 끝난 뒤 다시 시도하세요.", "Wait for the current Spotify action to finish."),
  };
  const states: Record<Player["state"], string> = {
    playing: t("재생 중", "Playing"),
    paused: t("일시정지됨", "Paused"),
    stopped: t("재생 정지", "Stopped"),
    closed: t("Spotify 앱이 닫혀 있습니다.", "The Spotify app is closed."),
    unknown: t("재생 상태를 확인할 수 없습니다.", "Playback state unavailable."),
  };
  const notices: Record<Destination | "transport", string> = {
    app: t("Spotify 앱 열기를 요청했습니다.", "Asked the system to open the Spotify app."),
    "web-player": t("브라우저에 Spotify 웹 플레이어를 요청했습니다.", "Asked your browser to open the Spotify web player."),
    link: t("브라우저에 Spotify 링크 열기를 요청했습니다.", "Asked your browser to open the Spotify link."),
    search: t("브라우저에 Spotify 검색 화면을 요청했습니다.", "Asked your browser to open Spotify search."),
    transport: t("Spotify 플레이어에 요청을 보냈습니다.", "Sent a request to the Spotify player."),
  };
  const ready = computerControl === true && !busy;
  const controlsReady = ready && native === "available" && player?.state !== "closed";
  const possibleLink = /^spotify:|^https?:\/\//i.test(input.trim());
  const possibleTrack = /^spotify:track:|^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\//i.test(input.trim());

  async function run<T>(tool: string, payload: Record<string, unknown>, apply: (data: T) => void) {
    const invoke = window.assistantAPI?.invokeTool;
    if (running.current || !computerControl || !invoke) return;
    const current = ++ticket.current;
    running.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await invoke(tool, payload) as Result<T>;
      if (current !== ticket.current) return;
      if (result.ok) apply(result.data);
      else {
        setError(result.reason);
        if (result.reason === "SPOTIFY_CLOSED") setPlayer({ state: "closed", title: "", artist: "", requested: false });
        if (result.reason === "SPOTIFY_UNAVAILABLE") setNative("missing");
        if (["SPOTIFY_UNAVAILABLE", "SPOTIFY_OS_PERMISSION", "SPOTIFY_PLAYER"].includes(result.reason)) setPlayer(null);
      }
    } catch {
      if (current === ticket.current) setError("SPOTIFY_PERMISSION");
    } finally {
      if (current === ticket.current) { running.current = false; setBusy(false); }
    }
  }

  function play(tool: string, payload: Record<string, unknown> = {}) {
    void run<Player>(tool, payload, (data) => {
      setNative("available");
      setPlayer(data);
      if (data.requested) setNotice("transport");
    });
  }

  function browse(event: FormEvent) {
    event.preventDefault();
    void run<{ destination: Destination }>("spotify:search", { text: input }, (data) => setNotice(data.destination));
  }

  return (
    <div className="jarvis-text-tool">
      {computerControl !== true && <p role="status" className="jarvis-result-detail">
        {computerControl === null ? t("Spotify 도구는 Jarvis 데스크톱에서 사용할 수 있습니다.", "Spotify tools are available in Jarvis Desktop.")
          : t("툴바에서 컴퓨터 제어를 켜세요.", "Turn on Computer control in the toolbar.")}
      </p>}
      {native === "unsupported" && <p className="jarvis-result-detail">{unavailable}</p>}
      {native === "missing" && <p className="jarvis-result-detail">
        {t("Spotify 앱을 찾지 못했습니다. 웹 플레이어를 열 수 있습니다.", "Spotify app unavailable. You can open the web player.")}
      </p>}
      {player && <div className="grid gap-1" role="status">
        <p className="text-sm font-semibold">{states[player.state]}</p>
        {player.title && <p className="break-words text-sm">{player.title}</p>}
        {player.artist && <p className="jarvis-result-detail break-words">{player.artist}</p>}
      </div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="jarvis-secondary-button" disabled={!ready} onClick={() =>
          void run<{ destination: Destination }>("spotify:open", {}, (data) => {
            if (data.destination === "app") { setNative("available"); setPlayer(null); }
            setNotice(data.destination);
          })}>
          {native === "missing" || native === "unsupported" ? t("웹 플레이어 열기", "Open web player") : t("Spotify 열기", "Open Spotify")}
        </button>
        {native !== "unsupported" && <button type="button" className="jarvis-secondary-button" disabled={!ready}
          onClick={() => play("spotify:status")}>{t("재생 상태 확인", "Check playback")}</button>}
      </div>
      {native === "available" && <div className="flex flex-wrap gap-2" role="group" aria-label={t("재생 제어", "Playback controls")}>
        {[
          { command: "previous", label: t("이전 곡", "Previous") },
          { command: "resume", label: t("재생", "Play") },
          { command: "pause", label: t("일시정지", "Pause") },
          { command: "next", label: t("다음 곡", "Next") },
        ].filter(({ command }) =>
          (command !== "resume" || player?.state !== "playing") &&
          (command !== "pause" || (player?.state !== "paused" && player?.state !== "stopped"))
        ).map(({ command, label }) => (
          <button type="button" key={command} className="jarvis-secondary-button" disabled={!controlsReady}
            onClick={() => play("spotify:control", { command })}>{label}</button>
        ))}
      </div>}
      <form className="grid gap-3 border-t border-border pt-3" onSubmit={browse}>
        <label className="grid gap-2 text-sm">
          {t("검색어 또는 Spotify 링크", "Search term or Spotify link")}
          <input className="jarvis-text-tool-control" value={input} maxLength={512} disabled={busy}
            onChange={(event) => { setInput(event.target.value); setError(null); setNotice(null); }} autoComplete="off" />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="submit" className="jarvis-secondary-button" disabled={!ready || !input.trim()}>
            {possibleLink ? t("링크 열기", "Open link") : t("Spotify에서 검색", "Search on Spotify")}
          </button>
          {possibleTrack && native === "available" && <button type="button" className="jarvis-secondary-button"
            disabled={!controlsReady} onClick={() => play("spotify:play-track", { text: input })}>
            {t("링크의 곡 재생", "Play linked track")}
          </button>}
        </div>
      </form>
      {busy && <p role="status" className="jarvis-result-detail">{t("Spotify 확인 중…", "Checking Spotify…")}</p>}
      {error && <p role="alert" className="jarvis-result-detail">{errors[error] ?? errors.SPOTIFY_PLAYER}</p>}
      {notice && <p role="status" className="jarvis-result-detail">{notices[notice]}</p>}
    </div>
  );
}
