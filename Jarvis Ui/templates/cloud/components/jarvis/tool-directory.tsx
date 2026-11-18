"use client";

import { ChevronRightIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useWorkspaceLocale } from "@/lib/workspace-language";

const names = {
  timer: ["타이머", "Timer", "focus 시간 알람 집중"],
  tasks: ["할 일", "Tasks", "todo to-do checklist 작업 체크리스트"],
  notes: ["메모", "Notes", "note memo 기록 노트"],
  weather: ["날씨", "Weather", "forecast 기온 예보"],
  activity: ["최근 활동", "Recent activity", "history 기록 이력"],
  command: ["로컬 명령", "Local command", "calculator calculate time date 계산 오늘 시간 도움말"],
  diagnostics: ["시스템 진단", "Diagnostics", "cpu memory 메모리 시스템"],
  folder: ["폴더 찾아보기", "Browse files", "directories directory folder 파일 목록 탐색"],
  "file-save": ["파일 저장", "Save file", "write edit text 문서 쓰기"],
  screen: ["화면 읽기", "Read screen", "ocr capture desktop 화면 텍스트"],
  browser: ["웹 페이지 읽기", "Read web page", "browser summarize page address url 브라우저 요약 웹 주소"],
  "project-create": ["코딩 프로젝트 만들기", "Create coding project", "scaffold template 개발 템플릿"],
  apps: ["앱", "Apps", "applications installed launch 프로그램 실행 설치"],
  spotify: ["Spotify", "Spotify", "music player audio 스포티파이 재생 음악"],
  games: ["게임", "Games", "steam epic library 스팀 에픽 설치"],
  obs: ["OBS", "OBS", "stream studio broadcast 방송 송출"],
} as const;

export type ToolId = keyof typeof names;

export function toolName(id: ToolId, ko: boolean) {
  return names[id][ko ? 0 : 1];
}

const groups = [
  { title: ["시간과 기록", "Time and notes"], items: ["timer", "tasks", "notes", "weather", "activity"] },
  { title: ["파일과 화면", "Files and screens"], native: true, items: ["folder", "file-save", "screen", "browser", "project-create"] },
  { title: ["앱과 서비스", "Apps and services"], native: true, items: ["apps", "spotify", "games", "obs"] },
  { title: ["명령과 진단", "Commands and diagnostics"], items: ["command", "diagnostics"] },
] as const;

export function ToolDirectory({ query, onQueryChange, lastTool, computerControl, onSelect }: {
  query: string;
  onQueryChange: (query: string) => void;
  lastTool: ToolId | null;
  computerControl: boolean | null;
  onSelect: (tool: ToolId) => void;
}) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const input = useRef<HTMLInputElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const restored = useRef(lastTool);
  const search = query.normalize("NFKC").toLowerCase().trim();
  const words = search.split(/\s+/).filter(Boolean);
  const visible = groups
    .filter((group) => computerControl !== null || !("native" in group))
    .map((group) => ({
      ...group,
      items: group.items.filter((key) => {
        const text = names[key].join(" ").toLowerCase();
        return words.every((word) => text.includes(word) ||
          (words.length === 1 && text.replace(/\s+/g, "").includes(word)));
      })
    }))
    .filter(({ items }) => items.length);
  const matches = visible.flatMap(({ items }) => items);

  useEffect(() => {
    const row = restored.current && rows.current?.querySelector<HTMLButtonElement>(`[data-tool-id="${restored.current}"]`);
    (row || input.current)?.focus();
  }, []);

  function move(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const buttons = [...(rows.current?.querySelectorAll<HTMLButtonElement>("[data-tool-id]") ?? [])];
    const active = document.activeElement;
    const index = buttons.findIndex((button) => button === active);
    if (index < 0 && active !== input.current) return;
    const next = event.key === "ArrowDown" ? buttons[index + 1] : index > 0 ? buttons[index - 1] : input.current;
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  return (
    <div className="jarvis-tool-directory" onKeyDown={move}>
      <form role="search" className="jarvis-tool-search" onSubmit={(event) => {
        event.preventDefault();
        if (search && matches.length === 1) onSelect(matches[0]);
      }}>
        <SearchIcon size={17} aria-hidden="true" />
        <input ref={input} value={query} onChange={(event) => onQueryChange(event.target.value)}
          aria-label={ko ? "도구 찾기" : "Find a tool"} placeholder={ko ? "도구 찾기" : "Find a tool"}
          autoComplete="off" maxLength={120} />
        {query && <button type="button" className="jarvis-icon-button" aria-label={ko ? "검색 지우기" : "Clear search"}
          onClick={() => { onQueryChange(""); input.current?.focus(); }}>
          <XIcon size={15} aria-hidden="true" />
        </button>}
      </form>
      <div ref={rows} className="jarvis-tool-groups">
        {visible.map((group) => (
          <section key={group.title[1]} className="jarvis-tool-group" aria-label={group.title[ko ? 0 : 1]}>
            <div className="jarvis-tool-group-heading">
              <h3>{group.title[ko ? 0 : 1]}</h3>
              {"native" in group && computerControl === false && (
                <span>{ko ? "컴퓨터 제어 필요" : "Requires Computer control"}</span>
              )}
            </div>
            <ul>
              {group.items.map((tool) => (
                <li key={tool}>
                  <button type="button" data-tool-id={tool} className="jarvis-tool-row" onClick={() => onSelect(tool)}>
                    <span>{toolName(tool, ko)}</span>
                    <ChevronRightIcon size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!matches.length && <p className="jarvis-result-detail" role="status">{ko ? "일치하는 도구가 없습니다." : "No matching tools."}</p>}
      </div>
    </div>
  );
}
