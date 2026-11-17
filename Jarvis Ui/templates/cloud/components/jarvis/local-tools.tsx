"use client";

import {
  ArrowLeftIcon, ArrowUpIcon, ArrowUpRightIcon, ClockIcon,
  PlusIcon, RotateCcwIcon, Trash2Icon, Volume2Icon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ThemeToggle } from "@/components/jarvis/theme-toggle";
import {
  activityLabels, emptyWorkspace, formatTimer, parseLocalCommand, readWorkspace, recordActivity,
  remainingSeconds, runLocalCommand, workspaceKey,
  type LocalCommand, type Result, type Workspace,
} from "@/lib/local-workspace";

type Receipt = Result & { offerWeather?: boolean };
export type ToolSection = "timer" | "tasks" | "notes";

function speak(text: string, language: string) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function loadWorkspace() {
  return readWorkspace(window.localStorage.getItem(workspaceKey));
}

export function LocalTools({ embedded = false, initialSection }: {
  embedded?: boolean;
  initialSection?: ToolSection;
}) {
  const [locale, setLocale] = useState("en");
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [now, setNow] = useState(0);
  const [command, setCommand] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [weatherPending, setWeatherPending] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [nativeStorage, setNativeStorage] = useState(false);
  const [undo, setUndo] = useState<(() => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLFieldSetElement>(null);
  const requestCounter = useRef(0);
  const latestNativeWorkspace = useRef(emptyWorkspace);
  const nativeReadSucceeded = useRef(false);
  const latestSave = useRef(0);
  const ko = locale.startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;

  useEffect(() => {
    setLocale(navigator.language || "en");
    setVoiceAvailable("speechSynthesis" in window);
    setNow(Date.now());
    let mounted = true;
    const bridge = window.assistantAPI;
    const loadNative = bridge?.loadLocalWorkspace;
    const useNative = Boolean(loadNative && bridge?.saveLocalWorkspace);
    setNativeStorage(useNative);

    const syncWorkspace = async () => {
      try {
        const persisted = useNative && loadNative ? await loadNative() : null;
        if (!mounted) return;
        nativeReadSucceeded.current = useNative;
        const next = persisted === null ? loadWorkspace() : readWorkspace(persisted);
        latestNativeWorkspace.current = next;
        setWorkspace(next);
      } catch {
        if (mounted) setStorageAvailable(false);
      } finally {
        if (mounted) setWorkspaceReady(true);
      }
    };
    void syncWorkspace();
    const onStorage = (event: StorageEvent) => {
      if (!useNative && (event.key === null || event.key === workspaceKey)) {
        void syncWorkspace();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      mounted = false;
      requestCounter.current++;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!workspaceReady) return;

    const section = initialSection && toolsRef.current?.querySelector(`[aria-labelledby="jarvis-${initialSection}"]`);
    const control = section ? section.querySelector<HTMLElement>("[data-tool-focus]") : inputRef.current;
    control?.focus();
  }, [initialSection, workspaceReady]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const remaining = remainingSeconds(workspace.timer, now);
  const timerRunning = workspace.timer.endsAt !== null && remaining > 0;
  const timerFinished = workspace.timer.endsAt !== null && remaining === 0;

  useEffect(() => {
    if (!timerRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [timerRunning]);

  function latestWorkspace() {
    if (nativeStorage) return latestNativeWorkspace.current;
    if (!storageAvailable) return workspace;
    try {
      return loadWorkspace();
    } catch {
      setStorageAvailable(false);
      return workspace;
    }
  }

  function saveWorkspace(next: Workspace) {
    setWorkspace(next);
    const serialized = JSON.stringify(next);
    if (nativeStorage && window.assistantAPI?.saveLocalWorkspace) {
      latestNativeWorkspace.current = next;
      if (!nativeReadSucceeded.current) return;
      const save = ++latestSave.current;
      void window.assistantAPI.saveLocalWorkspace(serialized).then(
        () => { if (save === latestSave.current) setStorageAvailable(true); },
        () => { if (save === latestSave.current) setStorageAvailable(false); },
      );
      return;
    }
    try {
      window.localStorage.setItem(workspaceKey, serialized);
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }

  function showReceipt(result: Receipt) {
    requestCounter.current++;
    setWeatherPending(false);
    setReceipt(result);
    setUndo(null);
  }

  async function diagnose(title: string) {
    const storage = storageAvailable
      ? nativeStorage
        ? t("데스크톱 저장소 사용 가능", "Desktop storage is available")
        : t("브라우저 저장소 사용 가능", "Browser storage is available")
      : t("저장소에 접근할 수 없습니다.", "Storage is unavailable.");
    const read = window.assistantAPI?.readHostDiagnostics;
    const unavailable = t("측정 불가", "Unavailable");
    const draw = (cpu: string, memory: string) => {
      setReceipt({ title, detail: [storage, `CPU ${cpu}`, `${t("메모리", "Memory")} ${memory}`].join("\n") });
    };
    if (!read) {
      showReceipt({ title, detail: storage + "\n" + t("시스템 측정은 Jarvis 데스크톱에서 사용할 수 있습니다.", "Host measurements are available in Jarvis Desktop.") });
      return;
    }

    showReceipt({ title, detail: storage + "\n" + t("시스템 사용량 측정 중…", "Measuring host usage…") });
    const request = requestCounter.current;
    try {
      const { cpuPercent, memoryPercent } = await read();
      if (request === requestCounter.current) {
        draw(cpuPercent === null ? unavailable : `${cpuPercent}%`, memoryPercent === null ? unavailable : `${memoryPercent}%`);
      }
    } catch {
      if (request === requestCounter.current) draw(unavailable, unavailable);
    }
  }

  function execute(action: LocalCommand) {
    if (action.kind === "clear") {
      requestCounter.current++;
      setWeatherPending(false);
      setReceipt(null);
      setUndo(null);
      return;
    }
    if (action.kind === "weather") {
      showReceipt({
        title: t("현재 위치의 날씨", "Weather at your location"),
        detail: t("현재 위치를 Open-Meteo에 보내 날씨를 조회합니다.", "The current location is sent to Open-Meteo to look up the weather."),
        offerWeather: true,
      });
      return;
    }

    const current = latestWorkspace();
    const timestamp = Date.now();
    const result = runLocalCommand(action, current, timestamp, crypto.randomUUID(), locale);
    if (action.kind === "diagnostics") {
      if (current.speakResults && voiceAvailable) speak(result.result.title, locale);
      void diagnose(result.result.title);
      return;
    }
    if (result.workspace !== current) saveWorkspace(result.workspace);
    if (result.workspace.speakResults && voiceAvailable && !result.result.failed) {
      speak(result.result.title, locale);
    } else if (action.kind === "speech" && voiceAvailable) {
      window.speechSynthesis.cancel();
    }
    setNow(timestamp);
    showReceipt(result.result);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!command.trim()) return;
    const action = parseLocalCommand(command);
    if (!action) {
      showReceipt({
        title: t("이 로컬 명령을 이해하지 못했어요", "This local command wasn’t recognized"),
        detail: t("“도움말”로 지원 명령을 보거나 대화 화면에서 질문하세요.", "Type “help” for supported commands, or open chat to ask a question."),
        failed: true,
      });
      return;
    }
    execute(action);
    setCommand("");
  }

  async function lookUpWeather() {
    const request = ++requestCounter.current;
    setWeatherPending(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("Location unavailable"));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 12000, maximumAge: 300000 });
      });
      if (request !== requestCounter.current) return;

      const { latitude, longitude } = position.coords;
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({
        latitude: latitude.toFixed(2),
        longitude: longitude.toFixed(2),
        current: "temperature_2m,relative_humidity_2m,wind_speed_10m",
      }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("Weather unavailable");
      const { current } = await response.json();
      if (!Number.isFinite(current?.temperature_2m)) throw new Error("Weather unavailable");
      if (request === requestCounter.current) {
        showReceipt({
          title: t("현재 기온", "Current temperature") + " " + current.temperature_2m + " °C",
          detail: t("습도", "Humidity") + " " + current.relative_humidity_2m + "% · " + t("바람", "Wind") + " " + current.wind_speed_10m + " km/h",
        });
      }
    } catch {
      if (request === requestCounter.current) {
        showReceipt({ title: t("날씨를 불러올 수 없습니다", "Could not read the weather"), failed: true });
      }
    } finally {
      if (request === requestCounter.current) setWeatherPending(false);
    }
  }

  function toggleTask(id: string) {
    const current = latestWorkspace();
    const task = current.tasks.find((item) => item.id === id);
    if (!task) return;
    const next = { ...current, tasks: current.tasks.map((item) => item.id === id ? { ...item, done: !item.done } : item) };
    saveWorkspace(recordActivity(next, task.done ? "reopen" : "complete", Date.now(), crypto.randomUUID()));
    showReceipt({ title: task.done ? t("할 일 다시 열기", "Task reopened") : t("할 일 완료", "Task completed"), detail: task.text });
  }

  function removeEntry(kind: "tasks" | "notes", id: string) {
    const current = latestWorkspace();
    const entry = current[kind].find((item) => item.id === id);
    if (!entry) return;
    requestCounter.current++;
    setWeatherPending(false);

    if (kind === "tasks") {
      const task = current.tasks.find((item) => item.id === id)!;
      const next = { ...current, tasks: current.tasks.filter((item) => item.id !== id) };
      saveWorkspace(recordActivity(next, "remove-task", Date.now(), crypto.randomUUID()));
      setUndo(() => () => {
        const latest = latestWorkspace();
        saveWorkspace(recordActivity({ ...latest, tasks: [task, ...latest.tasks] }, "undo", Date.now(), crypto.randomUUID()));
      });
    } else {
      const next = { ...current, notes: current.notes.filter((item) => item.id !== id) };
      saveWorkspace(recordActivity(next, "remove-note", Date.now(), crypto.randomUUID()));
      setUndo(() => () => {
        const latest = latestWorkspace();
        saveWorkspace(recordActivity({ ...latest, notes: [entry, ...latest.notes] }, "undo", Date.now(), crypto.randomUUID()));
      });
    }
    setReceipt({ title: kind === "tasks" ? t("할 일 삭제", "Task deleted") : t("메모 삭제", "Note deleted"), detail: entry.text });
  }

  return (
    <div className="jarvis-local" data-embedded={embedded || undefined}>
      {!embedded && <header className="jarvis-toolbar">
        <Link href="/" className="jarvis-toolbar-link">
          <ArrowLeftIcon size={16} aria-hidden="true" />
          {t("대화 및 계정", "Chat and account")}
        </Link>
        <ThemeToggle />
      </header>}
      <div className="jarvis-local-content" role={embedded ? undefined : "main"}>
        {!embedded && <h1>{t("로컬 도구", "Local tools")}</h1>}
        <fieldset ref={toolsRef} className="min-w-0" disabled={!workspaceReady}>
        <form className="jarvis-local-command" onSubmit={submit}>
          <input ref={inputRef} value={command} onChange={(event) => setCommand(event.target.value)}
            maxLength={600} aria-label={t("로컬 명령 입력", "Local command")}
            placeholder={t("예: 10분 타이머 맞춰줘", "Try “timer 10 minutes”")} />
          <button className="jarvis-icon-button jarvis-send" type="submit"
            aria-label={t("명령 실행", "Run command")} disabled={!command.trim()}>
            <ArrowUpIcon size={18} />
          </button>
        </form>
        <button type="button" className="jarvis-toolbar-link"
          onClick={() => execute({ kind: "diagnostics" })}>
          {t("시스템 진단", "Diagnostics")}
        </button>
        {receipt && (
          <div className="jarvis-local-result" data-error={receipt.failed || undefined}>
            <div role="status">
              <p className="font-semibold">{receipt.title}</p>
              {receipt.detail && <p className="jarvis-result-detail">{receipt.detail}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {receipt.href && (
                <a className="jarvis-toolbar-link" href={receipt.href} target="_blank" rel="noreferrer">
                  {t("열기", "Open")} <ArrowUpRightIcon size={15} aria-hidden="true" />
                </a>
              )}
              {receipt.offerWeather && (
                <button type="button" className="jarvis-secondary-button" onClick={() => void lookUpWeather()} disabled={weatherPending}>
                  {weatherPending ? t("조회 중", "Looking up…") : t("현재 위치 사용", "Use current location")}
                </button>
              )}
              {undo && (
                <button type="button" className="jarvis-secondary-button" onClick={() => {
                  undo();
                  showReceipt({ title: t("삭제 취소", "Deletion undone") });
                }}>
                  {t("되돌리기", "Undo")}
                </button>
              )}
              {voiceAvailable && !receipt.offerWeather && (
                <button type="button" className="jarvis-icon-button" aria-label={t("결과 읽기", "Read result aloud")}
                  onClick={() => speak([receipt.title, receipt.detail].filter(Boolean).join(". "), locale)}>
                  <Volume2Icon size={17} />
                </button>
              )}
            </div>
          </div>
        )}
        {!storageAvailable && <p role="alert" className="jarvis-result-detail">{t("변경사항을 저장하지 못했습니다. 창을 닫기 전에 필요한 내용을 복사하세요.", "Changes could not be saved. Copy anything you need before closing this window.")}</p>}
        <section className="jarvis-tool-section" aria-labelledby="jarvis-timer">
          <div className="jarvis-timer-layout">
            <div>
              <h2 id="jarvis-timer">{t("타이머", "Timer")}</h2>
              <p className="jarvis-timer-value" role="timer" aria-live="off">{formatTimer(remaining)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="jarvis-secondary-button" data-tool-focus onClick={() => execute({ kind: timerRunning ? "pause" : "resume" })}>
                <ClockIcon size={16} aria-hidden="true" />
                {timerRunning ? t("일시 정지", "Pause") : t("시작", "Start")}
              </button>
              <button type="button" className="jarvis-icon-button" aria-label={t("타이머 초기화", "Reset timer")} onClick={() => execute({ kind: "reset" })}>
                <RotateCcwIcon size={16} />
              </button>
            </div>
          </div>
          {timerFinished && <p role="status" className="jarvis-timer-message">{t("타이머 완료", "Timer finished")}</p>}
          <div className="flex flex-wrap gap-2">
            {[5, 10, 25].map((minutes) => (
              <button key={minutes} type="button" className="jarvis-secondary-button"
                onClick={() => execute({ kind: "timer", seconds: minutes * 60 })}>
                {minutes}{t("분", " min")}
              </button>
            ))}
          </div>
        </section>
        <EntrySection id="jarvis-tasks" title={t("할 일", "Tasks")} label={t("할 일 추가", "Add task")}
          limit={160} onAdd={(text) => execute({ kind: "task", text })}>
          {workspace.tasks.map((task) => (
            <li key={task.id} className="jarvis-entry">
              <label>
                <input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id)} />
                <span className={task.done ? "line-through" : ""}>{task.text}</span>
              </label>
              <button type="button" className="jarvis-icon-button" aria-label={t("할 일 삭제", "Delete task") + ": " + task.text}
                onClick={() => removeEntry("tasks", task.id)}><Trash2Icon size={16} /></button>
            </li>
          ))}
        </EntrySection>
        <EntrySection id="jarvis-notes" title={t("메모", "Notes")} label={t("메모 추가", "Add note")}
          limit={500} onAdd={(text) => execute({ kind: "note", text })}>
          {workspace.notes.map((note) => (
            <li key={note.id} className="jarvis-entry">
              <span>{note.text}</span>
              <button type="button" className="jarvis-icon-button" aria-label={t("메모 삭제", "Delete note") + ": " + note.text}
                onClick={() => removeEntry("notes", note.id)}><Trash2Icon size={16} /></button>
            </li>
          ))}
        </EntrySection>
        <details className="jarvis-tool-section jarvis-activity">
          <summary>{t("최근 활동", "Recent activity")}</summary>
          {workspace.activity.length ? (
            <>
              <ol>
                {workspace.activity.map(({ id, kind, at }) => (
                  <li key={id} className="jarvis-result-detail">
                    <span>{activityLabels[kind][ko ? 0 : 1]}</span>
                    <time dateTime={new Date(at).toISOString()}>
                      {new Date(at).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}
                    </time>
                  </li>
                ))}
              </ol>
              <button type="button" className="jarvis-toolbar-link" onClick={(event) => {
                saveWorkspace({ ...latestWorkspace(), activity: [] });
                showReceipt({ title: t("활동을 지웠습니다", "Activity cleared") });
                event.currentTarget.closest("details")?.querySelector("summary")?.focus();
              }}>
                {t("활동 지우기", "Clear activity")}
              </button>
            </>
          ) : <p className="jarvis-result-detail" role="status">{t("기록된 활동이 없습니다.", "No activity yet.")}</p>}
        </details>
        </fieldset>
      </div>
    </div>
  );
}

function EntrySection({ id, title, label, limit, onAdd, children }: {
  id: string;
  title: string;
  label: string;
  limit: number;
  onAdd: (text: string) => void;
  children: ReactNode;
}) {
  const [value, setValue] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    onAdd(value);
    setValue("");
  }

  return (
    <section className="jarvis-tool-section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ul>{children}</ul>
      <form className="jarvis-entry-form" onSubmit={submit}>
        <input data-tool-focus aria-label={label} placeholder={label} maxLength={limit} value={value}
          onChange={(event) => setValue(event.target.value)} />
        <button type="submit" className="jarvis-icon-button" aria-label={label} disabled={!value.trim()}>
          <PlusIcon size={18} />
        </button>
      </form>
    </section>
  );
}
