"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useWorkspaceLocale } from "@/lib/workspace-language";
import type { GameView } from "@/lib/game-command";

type Platform = "steam" | "epic";
type Game = { id: string; name: string };
type Library = { platform: Platform; status: "available" | "missing" | "partial" | "unsupported"; games: Game[] };
type Results = { revision: number; results: Game[] };
type Destination = "steam-install" | "steam-downloads" | "epic-launcher" | "steam-store" | "epic-store";
type Result<T> = { ok: true; data: T } | { ok: false; reason: string };

export function GamesLibrary({ computerControl, initial, initialQuery = "" }: {
  computerControl: boolean | null;
  initial: GameView;
  initialQuery?: string;
}) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const [view, setView] = useState(initial === "library" ? "library" : "store");
  const [platform, setPlatform] = useState<Platform>(initial === "epic" ? "epic" : "steam");
  const [libraries, setLibraries] = useState<Library[] | null>(null);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Results | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState<"scan" | "search" | "open" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const request = useRef(0);
  const running = useRef(false);

  useEffect(() => {
    if (!computerControl) {
      setLibraries(null);
      setResults(null);
      setSelected("");
      setError(null);
      setDestination(null);
      setBusy(null);
    } else if (view === "library") {
      refresh();
    }
    return () => { request.current++; running.current = false; };
  }, [computerControl, view]);

  const errors: Record<string, string> = {
    GAMES_QUERY: t("게임 이름을 입력하세요.", "Enter a game name."),
    GAMES_SCAN: t("설치 기록을 읽지 못했습니다. 다시 시도하세요.", "Couldn’t read the installed games. Try again."),
    GAMES_SEARCH: t("Steam 검색에 실패했습니다. 다시 시도하거나 Steam 스토어를 여세요.", "Steam search failed. Try again or open the Steam Store."),
    GAMES_CHOOSE_RESULT: t("Steam을 다시 검색하고 게임을 선택하세요.", "Search Steam again and select a result."),
    GAMES_LAUNCHER_OPEN: t("런처를 열지 못했습니다. 설치 상태를 확인하세요.", "Couldn’t open the launcher. Check that it’s installed."),
    GAMES_STORE_OPEN: t("스토어를 열지 못했습니다. 기본 브라우저 설정을 확인하세요.", "Couldn’t open the store. Check your default browser."),
    GAMES_PERMISSION: t("툴바에서 컴퓨터 제어를 확인하세요.", "Check Computer control in the toolbar."),
    GAMES_BUSY: t("진행 중인 작업이 끝난 뒤 다시 시도하세요.", "Wait for the current operation to finish."),
  };
  const receipts: Record<Destination, string> = {
    "steam-install": t("Steam에 설치 요청을 보냈습니다. 진행 상태는 Steam에서 확인하세요.", "Install request sent to Steam. Check its progress in Steam."),
    "steam-downloads": t("Steam에 다운로드 화면 열기를 요청했습니다.", "Asked Steam to open Downloads."),
    "epic-launcher": t("Epic Games Launcher 열기를 요청했습니다. 라이브러리에서 설치와 업데이트를 관리할 수 있습니다.",
      "Asked Epic Games Launcher to open. Manage installs and updates in its Library."),
    "steam-store": t("브라우저에 Steam 스토어 검색을 요청했습니다.", "Asked your browser to open the Steam Store search."),
    "epic-store": t("브라우저에 Epic Games Store 검색을 요청했습니다.", "Asked your browser to open the Epic Games Store search."),
  };
  const platformName: Record<Platform, string> = { steam: "Steam", epic: "Epic Games" };

  async function run<T>(step: "scan" | "search" | "open", tool: string, payload: Record<string, unknown>, apply: (data: T) => void) {
    const invoke = window.assistantAPI?.invokeTool;
    if (running.current || !computerControl || !invoke) return;
    const ticket = ++request.current;
    running.current = true;
    setBusy(step);
    setError(null);
    setDestination(null);
    try {
      const result = await invoke(tool, payload) as Result<T>;
      if (ticket !== request.current) return;
      if (result.ok) apply(result.data);
      else setError(result.reason);
    } catch {
      if (ticket === request.current) setError("GAMES_PERMISSION");
    } finally {
      if (ticket === request.current) {
        running.current = false;
        setBusy(null);
      }
    }
  }

  function refresh() {
    void run<Library[]>("scan", "games:list", {}, setLibraries);
  }

  function open(tool: string, payload: Record<string, unknown>) {
    void run<{ destination: Destination }>("open", tool, payload, (data) => setDestination(data.destination));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (platform === "epic") {
      open("games:store", { platform, gameName: query });
      return;
    }
    setSelected("");
    setResults(null);
    void run<Results>("search", "games:search", { gameName: query }, setResults);
  }

  function switchView(next: "library" | "store") {
    setView(next);
    setError(null);
    setDestination(null);
  }

  function clearResults() {
    setResults(null);
    setSelected("");
    setError(null);
    setDestination(null);
  }

  function libraryStatus(library: Library) {
    if (library.status === "partial") return t("일부 설치 기록을 확인하지 못했습니다.", "Some installation records could not be checked.");
    if (library.status === "missing") return t("설치 기록 폴더를 찾지 못했습니다.", "No installation records folder found.");
    if (library.status === "unsupported") return t("이 OS에서는 설치 기록을 조회할 수 없습니다.", "Installation records are unavailable on this OS.");
    if (library.games.length === 0) return t("확인된 설치 항목이 없습니다.", "No installed games found.");
    return "";
  }

  const disabled = !computerControl || busy !== null;

  return (
    <div className="jarvis-text-tool">
      <div className="jarvis-games-views flex flex-wrap gap-2" aria-label={t("게임 보기", "Game views")} role="group">
        <button type="button" className="jarvis-secondary-button" aria-pressed={view === "library"} disabled={busy !== null}
          onClick={() => switchView("library")}>{t("설치된 게임", "Installed games")}</button>
        <button type="button" className="jarvis-secondary-button" aria-pressed={view === "store"} disabled={busy !== null}
          onClick={() => switchView("store")}>{t("게임 찾기", "Find a game")}</button>
      </div>
      {computerControl !== true && <p className="jarvis-result-detail" role="status">
        {computerControl === null
          ? t("게임 도구는 Jarvis 데스크톱에서 사용할 수 있습니다.", "Game tools are available in Jarvis Desktop.")
          : t("툴바에서 컴퓨터 제어를 켜세요.", "Turn on Computer control in the toolbar.")}
      </p>}
      {view === "library" && <>
        {(libraries ?? []).some(({ games }) => games.length > 0) && <label className="grid gap-2 text-sm">
          {t("설치 목록에서 찾기", "Filter installed games")}
          <input className="jarvis-text-tool-control" value={filter} maxLength={120}
            onChange={(event) => setFilter(event.target.value)} />
        </label>}
        {libraries?.map((library) => {
          const status = libraryStatus(library);
          const titles = library.games.filter((game) => game.name.toLowerCase().includes(filter.trim().toLowerCase()));
          return <section key={library.platform} aria-label={platformName[library.platform]} className="grid gap-2 border-t border-border pt-3">
            <h3 className="text-sm font-semibold">{platformName[library.platform]}</h3>
            {status && <p className="jarvis-result-detail">{status}</p>}
            {titles.length > 0 && <ul className="grid max-h-[28dvh] gap-1 overflow-auto text-sm">
              {titles.map((game) => <li key={game.id} className="break-words">{game.name}</li>)}
            </ul>}
            {library.games.length > 0 && titles.length === 0 &&
              <p className="jarvis-result-detail">{t("검색어와 일치하는 게임이 없습니다.", "No installed games match the filter.")}</p>}
          </section>;
        })}
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <button type="button" className="jarvis-secondary-button" disabled={disabled} onClick={refresh}>
            {t("새로 고침", "Refresh")}
          </button>
          <button type="button" className="jarvis-secondary-button" disabled={disabled} onClick={() => open("games:update", { platform: "steam" })}>
            {t("Steam 다운로드", "Steam Downloads")}
          </button>
          <button type="button" className="jarvis-secondary-button" disabled={disabled} onClick={() => open("games:update", { platform: "epic" })}>
            {t("Epic 런처 열기", "Open Epic Launcher")}
          </button>
        </div>
      </>}
      {view === "store" && <>
        <form className="grid gap-3" onSubmit={submit}>
          <label className="grid gap-2 text-sm">
            {t("스토어", "Store")}
            <select className="jarvis-text-tool-control" value={platform} disabled={busy !== null}
              onChange={(event) => { setPlatform(event.target.value as Platform); clearResults(); }}>
              <option value="steam">Steam</option>
              <option value="epic">Epic Games Store</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            {t("게임 이름", "Game name")}
            <input className="jarvis-text-tool-control" value={query} maxLength={120} disabled={busy !== null}
              onChange={(event) => { setQuery(event.target.value); clearResults(); }} />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            {platform === "steam" && <button className="jarvis-secondary-button" type="button"
              disabled={disabled || !query.trim()} onClick={() => open("games:store", { platform, gameName: query })}>
              {t("Steam 스토어 열기", "Open Steam Store")}
            </button>}
            <button className="jarvis-secondary-button" type="submit" disabled={disabled || !query.trim()}>
              {platform === "steam" ? t("Steam 검색", "Search Steam") : t("Epic 스토어에서 찾기", "Find in Epic Store")}
            </button>
          </div>
        </form>
        {results && results.results.length === 0 &&
          <p role="status" className="jarvis-result-detail">{t("Steam 검색 결과가 없습니다.", "No Steam search results.")}</p>}
        {results && results.results.length > 0 && <div className="grid gap-3 border-t border-border pt-3">
          <label className="grid gap-2 text-sm">
            {t("검색 결과", "Search results")}
            <select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={busy !== null} className="jarvis-text-tool-control">
              <option value="">{t("게임 선택", "Select a game")}</option>
              {results.results.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
            </select>
          </label>
          <button className="jarvis-secondary-button justify-self-end" type="button" disabled={disabled || !selected}
            onClick={() => open("games:install", { revision: results.revision, id: selected })}>
            {t("Steam에 설치 요청", "Send install request to Steam")}
          </button>
        </div>}
      </>}
      {busy && <p role="status" className="jarvis-result-detail">
        {busy === "scan" ? t("설치 목록 확인 중…", "Checking installed games…")
          : busy === "search" ? t("Steam 검색 중…", "Searching Steam…") : t("열기 요청 중…", "Sending open request…")}
      </p>}
      {error && <p role="alert" className="jarvis-result-detail">{errors[error] ?? errors.GAMES_SCAN}</p>}
      {destination && <p role="status" className="jarvis-result-detail">{receipts[destination]}</p>}
    </div>
  );
}
