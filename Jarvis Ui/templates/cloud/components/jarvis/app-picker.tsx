"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useWorkspaceLocale } from "@/lib/workspace-language";

type App = { id: string; name: string; location: string };
type Catalog = { supported: false; apps: [] } | { supported: true; revision: number; more: boolean; apps: App[] };
type Result<T> = { ok: true; data: T } | { ok: false; reason: string };

export function AppPicker({ computerControl, initialQuery = "" }: { computerControl: boolean | null; initialQuery?: string }) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const [query, setQuery] = useState(initialQuery);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [operation, setOperation] = useState<"search" | "launch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState("");
  const ticket = useRef(0);
  const busy = useRef(false);
  const firstResult = useRef(true);
  const queryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (computerControl) {
      search(false);
    } else {
      setCatalog(null);
      setRequested("");
      setError(null);
      setOperation(null);
    }
    return () => { ticket.current++; busy.current = false; };
  }, [computerControl]);

  useEffect(() => {
    if (catalog?.supported && firstResult.current && !operation) {
      firstResult.current = false;
      queryInput.current?.focus();
    }
  }, [catalog, operation]);

  const errors: Record<string, string> = {
    APPS_PERMISSION: t("툴바에서 컴퓨터 제어를 확인하세요.", "Check Computer control in the toolbar."),
    APPS_QUERY: t("앱 이름을 짧게 입력하세요.", "Enter a shorter app name."),
    APPS_SCAN_FAILED: t("설치된 앱을 확인하지 못했습니다. 다시 시도하세요.", "Couldn’t read installed apps. Try again."),
    APPS_STALE: t("앱 목록을 다시 불러온 뒤 선택하세요.", "Refresh the app list before choosing."),
    APPS_CHANGED: t("선택한 앱이 바뀌었습니다. 목록을 새로 고치세요.", "The selected app changed. Refresh the list."),
    APPS_OPEN_FAILED: t("시스템에서 앱을 열지 못했습니다.", "The system couldn’t open the app."),
  };

  async function run<T>(tool: string, step: "search" | "launch", payload: Record<string, unknown>, apply: (data: T) => void) {
    const invoke = window.assistantAPI?.invokeTool;
    if (!computerControl || busy.current || !invoke) return;
    const request = ++ticket.current;
    busy.current = true;
    setOperation(step);
    setError(null);
    setRequested("");
    if (step === "search") setCatalog(null);
    try {
      const result = await invoke(tool, payload) as Result<T>;
      if (request !== ticket.current) return;
      if (result.ok) apply(result.data);
      else setError(result.reason);
    } catch {
      if (request === ticket.current) setError("APPS_PERMISSION");
    } finally {
      if (request === ticket.current) { setOperation(null); busy.current = false; }
    }
  }

  function search(refresh: boolean) {
    void run<Catalog>("apps:catalog", "search", { query, refresh }, setCatalog);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    search(false);
  }

  const disabled = !computerControl || operation !== null;
  const supported = catalog?.supported !== false;

  return (
    <div className="jarvis-text-tool">
      {computerControl !== true && <p role="status" className="jarvis-result-detail">
        {computerControl === null ? t("앱 목록은 Jarvis 데스크톱에서 사용할 수 있습니다.", "The app catalog is available in Jarvis Desktop.")
          : t("툴바에서 컴퓨터 제어를 켜세요.", "Turn on Computer control in the toolbar.")}
      </p>}
      {supported ? (
        <form className="grid gap-3" onSubmit={submit}>
          <label className="grid gap-2 text-sm">
            {t("앱 이름", "App name")}
            <input ref={queryInput} className="jarvis-text-tool-control" value={query} maxLength={120} disabled={operation !== null}
              onChange={(event) => { setQuery(event.target.value); setCatalog(null); setRequested(""); setError(null); }} />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="jarvis-secondary-button" disabled={disabled} onClick={() => search(true)}>
              {t("목록 새로 고침", "Refresh catalog")}
            </button>
            <button type="submit" className="jarvis-secondary-button" disabled={disabled}>{t("앱 검색", "Search apps")}</button>
          </div>
        </form>
      ) : <p role="status" className="jarvis-result-detail">
        {t("설치된 앱 목록 조회는 macOS에서 사용할 수 있습니다.", "The installed app catalog is available on macOS.")}
      </p>}
      {catalog?.supported && catalog.apps.length === 0 && <p role="status" className="jarvis-result-detail">
        {catalog.more ? t("현재 결과에서 열 수 있는 앱을 확인하지 못했습니다. 이름으로 검색하세요.",
          "No accessible apps in these results. Search by name.")
          : t("확인된 앱이 없습니다.", "No matching apps found.")}
      </p>}
      {catalog?.supported && catalog.apps.length > 0 && <>
        <ul className="grid max-h-[45dvh] overflow-y-auto border-y border-border">
          {catalog.apps.map((app) => (
            <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3 last:border-b-0" key={app.id}>
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold">{app.name}</p>
                <p dir="ltr" className="jarvis-result-detail break-all">{app.location}</p>
              </div>
              <button type="button" className="jarvis-secondary-button" disabled={disabled}
                aria-label={t(app.name + " 열기", "Open " + app.name) + " · " + app.location}
                onClick={() => void run<{ name: string }>("apps:open-selected", "launch",
                  { revision: catalog.revision, id: app.id }, (data) => setRequested(data.name))}>{t("열기", "Open")}</button>
            </li>
          ))}
        </ul>
        {catalog.more && <p className="jarvis-result-detail">{t("일부 결과를 표시합니다. 앱 이름으로 더 좁힐 수 있습니다.",
          "Showing some results. Narrow the list by app name.")}</p>}
      </>}
      {operation && <p role="status" className="jarvis-result-detail">
        {operation === "search" ? t("설치된 앱을 확인하는 중…", "Checking installed apps…") : t("앱 열기 요청 중…", "Sending the open request…")}
      </p>}
      {requested && <p role="status" className="jarvis-result-detail">{t(requested + " 열기를 요청했습니다.", "Asked the system to open " + requested + ".")}</p>}
      {error && <p role="alert" className="jarvis-result-detail">{errors[error] ?? errors.APPS_SCAN_FAILED}</p>}
    </div>
  );
}
