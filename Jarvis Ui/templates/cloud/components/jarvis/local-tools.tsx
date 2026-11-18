"use client";

import {
  ArrowLeftIcon, ArrowUpIcon, ArrowUpRightIcon, ClockIcon,
  ListTodoIcon, PlusIcon, RotateCcwIcon, StickyNoteIcon, Trash2Icon, Volume2Icon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ThemeToggle } from "@/components/jarvis/theme-toggle";
import { WeatherPanel } from "@/components/jarvis/weather-panel";
import { LocalDataPanel } from "@/components/jarvis/local-data-panel";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { speakLocalResult } from "@/lib/local-speech";
import { useWorkspaceLocale } from "@/lib/workspace-language";
import { useLocalWorkspace, type LocalWorkspace } from "@/lib/use-local-workspace";
import {
  activityLabels, formatTimer, parseLocalCommand, recordActivity, remainingSeconds, runLocalCommand,
  type LocalCommand, type Result,
} from "@/lib/local-workspace";

type Receipt = Result & { timerDeadline?: number };
type LocalStart = { active: boolean; onSignIn: () => void };
export type ToolSection = "timer" | "tasks" | "notes" | "weather" | "activity" | "command" | "diagnostics";

export function TimerCompletionNotice({ onOpen }: {
  onOpen?: (trigger: HTMLButtonElement) => void;
}) {
  const ko = useWorkspaceLocale().startsWith("ko");
  return (
    <div className="jarvis-timer-notice">
      <p role="status">
        <ClockIcon size={16} aria-hidden="true" />
        {activityLabels["timer-complete"][ko ? 0 : 1]}
      </p>
      {onOpen && (
        <button type="button" className="jarvis-start-link jarvis-start-link-text" aria-haspopup="dialog"
          onClick={(event) => onOpen(event.currentTarget)}>
          {ko ? "타이머 열기" : "Open timer"}
        </button>
      )}
    </div>
  );
}

export function StandaloneLocalTools({ start }: { start?: LocalStart }) {
  const local = useLocalWorkspace();
  return <LocalTools local={local} start={start} />;
}

export function LocalTools({ local, embedded = false, initialSection, start }: {
  local: LocalWorkspace;
  embedded?: boolean;
  initialSection?: Exclude<ToolSection, "weather">;
  start?: LocalStart;
}) {
  const locale = useWorkspaceLocale();
  const { workspace, workspaceReady, storageAvailable, nativeStorage, latestWorkspace, saveWorkspace } = local;
  const [now, setNow] = useState(0);
  const [command, setCommand] = useState("");
  const [lastReceipt, setReceipt] = useState<Receipt | null>(null);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [undo, setUndo] = useState<(() => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLFieldSetElement>(null);
  const requestCounter = useRef(0);
  const ko = locale.startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const isStart = Boolean(start);
  const active = start?.active ?? true;

  useEffect(() => {
    setVoiceAvailable("speechSynthesis" in window);
    setNow(Date.now());
    return () => { requestCounter.current++; };
  }, []);

  useEffect(() => {
    if (!workspaceReady || !active) return;

    const section = initialSection && toolsRef.current?.querySelector(`[data-tool-section="${initialSection}"]`);
    const control = section ? section.querySelector<HTMLElement>("[data-tool-focus]") : inputRef.current;
    control?.focus();
  }, [active, initialSection, workspaceReady]);

  useEffect(() => {
    if (!active) return;
    function focusCommand() {
      if (!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) {
        inputRef.current?.focus();
      }
    }

    function keydown(event: KeyboardEvent) {
      if (inputRef.current && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        focusCommand();
      }
    }

    window.addEventListener("keydown", keydown);
    const unsubscribe = isStart ? window.assistantAPI?.onFocusCommandInput?.(focusCommand) : undefined;
    return () => {
      window.removeEventListener("keydown", keydown);
      unsubscribe?.();
    };
  }, [active, isStart]);

  const remaining = remainingSeconds(workspace.timer, now);
  const timerRunning = workspace.timer.endsAt !== null && remaining > 0;
  const timerFinished = workspace.timer.completedAt !== undefined;
  const timerPaused = workspace.timer.endsAt === null && !timerFinished && (
    workspace.timer.remaining < workspace.timer.seconds ||
    workspace.activity.find(({ kind }) => kind === "timer" || kind === "pause" || kind === "reset")?.kind === "pause"
  );
  const receipt = lastReceipt?.timerDeadline !== undefined && lastReceipt.timerDeadline !== workspace.timer.endsAt
    ? null
    : lastReceipt;

  useEffect(() => {
    if (!timerRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [timerRunning]);

  function showReceipt(result: Receipt) {
    requestCounter.current++;
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

  function execute(action: LocalCommand, onSaveFailure?: () => void) {
    if (action.kind === "clear") {
      requestCounter.current++;
      setReceipt(null);
      setUndo(null);
      setWeatherOpen(false);
      return;
    }
    if (action.kind === "weather") {
      setWeatherOpen(true);
      return;
    }

    const current = latestWorkspace();
    const timestamp = Date.now();
    const result = runLocalCommand(action, current, timestamp, crypto.randomUUID(), locale);
    if (action.kind === "diagnostics") {
      if (current.speakResults && voiceAvailable) speakLocalResult(result.result.title, locale);
      void diagnose(result.result.title);
      return;
    }
    setNow(timestamp);
    const timerDeadline = (action.kind === "timer" || action.kind === "resume") && !result.result.failed
      ? result.workspace.timer.endsAt ?? undefined
      : undefined;
    function finish() {
      if (result.workspace.speakResults && voiceAvailable && !result.result.failed) {
        speakLocalResult(result.result.title, locale);
      } else if (action.kind === "speech" && voiceAvailable) {
        window.speechSynthesis.cancel();
      }
      showReceipt({ ...result.result, timerDeadline });
    }
    if (result.workspace === current) {
      finish();
      return;
    }
    showReceipt({ title: t("기기에 저장하는 중…", "Saving on this device…") });
    const request = requestCounter.current;
    void saveWorkspace(result.workspace, current).then((saved) => {
      if (request !== requestCounter.current) return;
      if (saved) {
        finish();
      } else {
        onSaveFailure?.();
        showReceipt({ title: t("기기에 저장하지 못했습니다", "Couldn’t save on this device"), failed: true });
      }
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!command.trim()) return;
    const action = parseLocalCommand(command);
    if (!action) {
      showReceipt({
        title: t("이 로컬 명령을 이해하지 못했어요", "This local command wasn’t recognized"),
        detail: start
          ? t("“도움말”로 지원 명령을 보거나 로그인해 대화하세요.", "Type “help” for supported commands or sign in to chat.")
          : t("“도움말”로 지원 명령을 보거나 대화 화면에서 질문하세요.", "Type “help” for supported commands, or open chat to ask a question."),
        failed: true,
      });
      return;
    }
    execute(action, () => setCommand((draft) => draft || command));
    setCommand("");
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

  const show = (section: ToolSection) => start
    ? section === "command"
    : !embedded || initialSection === section;

  function fillExample(example: string) {
    if (!command.trim()) setCommand(example);
    inputRef.current?.focus();
  }
  const activityContent = workspace.activity.length ? (
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
        const target = embedded
          ? event.currentTarget.closest('[role="dialog"]')?.querySelector<HTMLElement>(".jarvis-tools-dialog-title")
          : event.currentTarget.closest("details")?.querySelector("summary");
        target?.focus();
      }}>
        {t("활동 지우기", "Clear activity")}
      </button>
    </>
  ) : <p className="jarvis-result-detail" role="status">{t("기록된 활동이 없습니다.", "No activity yet.")}</p>;

  return (
    <div className="jarvis-local" data-embedded={embedded || undefined} data-start={isStart || undefined}>
      {start ? <header className="jarvis-toolbar">
        <span className="font-semibold">Jarvis</span>
        <div className="flex items-center gap-1">
          <Link href="/tools" className="jarvis-toolbar-link">{t("로컬 도구", "Local tools")}</Link>
          <ThemeToggle />
          <button type="button" className="jarvis-toolbar-link jarvis-start-sign-in" onClick={start.onSignIn}>
            {t("로그인", "Sign in")}
          </button>
        </div>
      </header> : !embedded && <header className="jarvis-toolbar">
        <Link href="/" className="jarvis-toolbar-link">
          <ArrowLeftIcon size={16} aria-hidden="true" />
          {t("작업 공간", "Workspace")}
        </Link>
        <ThemeToggle />
      </header>}
      <div className="jarvis-local-content" role={embedded ? undefined : "main"}>
        {start ? <div className="jarvis-start">
          <h1>{t("무엇을 할까요?", "What would you like to do?")}</h1>
          <p className="jarvis-result-detail">{t("명령을 이 기기에서 실행합니다.", "Run commands on this device.")}</p>
        </div> : !embedded && <h1>{t("로컬 도구", "Local tools")}</h1>}
        {timerFinished && show("timer") && <TimerCompletionNotice />}
        <fieldset ref={toolsRef} className="min-w-0" disabled={!workspaceReady || local.clearingData}>
        {show("command") && <form className="jarvis-local-command" onSubmit={submit}>
          <input ref={inputRef} value={command} onChange={(event) => setCommand(event.target.value)}
            maxLength={600} aria-label={t("로컬 명령 입력", "Local command")}
            placeholder={t("예: 10분 타이머 맞춰줘", "Try “timer 10 minutes”")} />
          <button className="jarvis-icon-button jarvis-send" type="submit"
            aria-label={t("명령 실행", "Run command")} disabled={!command.trim()}>
            <ArrowUpIcon size={18} />
          </button>
        </form>}
        {!embedded && !start && <div className="flex flex-wrap gap-1">
          <button type="button" className="jarvis-toolbar-link"
            onClick={() => execute({ kind: "diagnostics" })}>
            {t("시스템 진단", "Diagnostics")}
          </button>
          <button type="button" className="jarvis-toolbar-link" aria-expanded={weatherOpen}
            aria-controls={weatherOpen ? "jarvis-weather-panel" : undefined}
            onClick={() => setWeatherOpen(!weatherOpen)}>
            {t("날씨", "Weather")}
          </button>
          <Dialog>
            <DialogTrigger asChild>
              <button type="button" className="jarvis-toolbar-link">{t("로컬 데이터", "Local data")}</button>
            </DialogTrigger>
            <DialogContent aria-describedby={undefined}
              className="jarvis-tools-dialog block w-full gap-0 overflow-y-auto p-0 motion-reduce:animate-none sm:max-w-xl">
              <div className="jarvis-tools-titlebar">
                <DialogTitle className="jarvis-tools-dialog-title">{t("로컬 데이터", "Local data")}</DialogTitle>
              </div>
              <LocalDataPanel local={local} onCleared={() => { requestCounter.current++; setReceipt(null); setUndo(null); }} />
            </DialogContent>
          </Dialog>
        </div>}
        {embedded && show("diagnostics") && (
          <section data-tool-section="diagnostics">
            <p className="jarvis-result-detail">
              {t("이 기기의 CPU와 메모리 사용량을 확인합니다.", "Check CPU and memory use on this device.")}
            </p>
            <button type="button" className="jarvis-secondary-button mt-3" data-tool-focus
              onClick={() => execute({ kind: "diagnostics" })}>{t("시스템 사용량 측정", "Measure system usage")}</button>
          </section>
        )}
        {weatherOpen && <WeatherPanel canUseBrowserLocation={!nativeStorage} />}
        {receipt && (
          <div className="jarvis-local-result" data-error={receipt.failed || undefined}>
            <div role={receipt.failed ? "alert" : "status"}>
              <p className="font-semibold">{receipt.title}</p>
              {receipt.detail && <p className="jarvis-result-detail">{receipt.detail}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {receipt.href && (
                <a className="jarvis-toolbar-link" href={receipt.href} target="_blank" rel="noreferrer">
                  {t("열기", "Open")} <ArrowUpRightIcon size={15} aria-hidden="true" />
                </a>
              )}
              {undo && (
                <button type="button" className="jarvis-secondary-button" onClick={() => {
                  undo();
                  showReceipt({ title: t("삭제 취소", "Deletion undone") });
                }}>
                  {t("되돌리기", "Undo")}
                </button>
              )}
              {voiceAvailable && (
                <button type="button" className="jarvis-icon-button" aria-label={t("결과 읽기", "Read result aloud")}
                  onClick={() => speakLocalResult([receipt.title, receipt.detail].filter(Boolean).join(". "), locale)}>
                  <Volume2Icon size={17} />
                </button>
              )}
            </div>
          </div>
        )}
        {start && <div className="jarvis-start-actions items-center" role="group" aria-label={t("명령 예시", "Example commands")}>
          <button type="button" className="jarvis-secondary-button"
            onClick={() => fillExample(t("3분 타이머 맞춰줘", "Set a timer for 3 minutes"))}>
            <ClockIcon size={16} aria-hidden="true" />{t("3분 타이머", "3-minute timer")}
          </button>
          <button type="button" className="jarvis-secondary-button"
            onClick={() => fillExample(t("할 일 추가 ", "Add task "))}>
            <ListTodoIcon size={16} aria-hidden="true" />{t("할 일 추가", "Add task")}
          </button>
          <button type="button" className="jarvis-secondary-button"
            onClick={() => fillExample(t("메모 ", "Note "))}>
            <StickyNoteIcon size={16} aria-hidden="true" />{t("메모 쓰기", "Write a note")}
          </button>
        </div>}
        {start && (timerRunning || timerPaused) && (
          <div className="jarvis-start-timer">
            <span>{t("타이머", "Timer")}</span>
            <span role="timer" aria-live="off">{formatTimer(remaining)}</span>
            <button type="button" className="jarvis-toolbar-link"
              onClick={() => execute({ kind: timerPaused ? "resume" : "pause" })}>
              {timerPaused ? t("재개", "Resume") : t("일시 정지", "Pause")}
            </button>
          </div>
        )}
        {start && timerFinished && <TimerCompletionNotice />}
        {!storageAvailable && <p role="alert" className="jarvis-result-detail">{t("변경사항을 저장하지 못했습니다. 창을 닫기 전에 필요한 내용을 복사하세요.", "Changes could not be saved. Copy anything you need before closing this window.")}</p>}
        {show("timer") && <section className="jarvis-tool-section" data-tool-section="timer" aria-labelledby={embedded ? undefined : "jarvis-timer"}>
          <div className="jarvis-timer-layout">
            <div>
              {!embedded && <h2 id="jarvis-timer">{t("타이머", "Timer")}</h2>}
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
          <div className="flex flex-wrap gap-2">
            {[5, 10, 25].map((minutes) => (
              <button key={minutes} type="button" className="jarvis-secondary-button"
                onClick={() => execute({ kind: "timer", seconds: minutes * 60 })}>
                {minutes}{t("분", " min")}
              </button>
            ))}
          </div>
        </section>}
        {show("tasks") && <EntrySection section="tasks" title={t("할 일", "Tasks")} label={t("할 일 추가", "Add task")}
          hideHeading={embedded} limit={160} onAdd={(text) => execute({ kind: "task", text })}>
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
        </EntrySection>}
        {show("notes") && <EntrySection section="notes" title={t("메모", "Notes")} label={t("메모 추가", "Add note")}
          hideHeading={embedded} limit={500} onAdd={(text) => execute({ kind: "note", text })}>
          {workspace.notes.map((note) => (
            <li key={note.id} className="jarvis-entry">
              <span>{note.text}</span>
              <button type="button" className="jarvis-icon-button" aria-label={t("메모 삭제", "Delete note") + ": " + note.text}
                onClick={() => removeEntry("notes", note.id)}><Trash2Icon size={16} /></button>
            </li>
          ))}
        </EntrySection>}
        {show("activity") && (embedded ? (
          <section className="jarvis-tool-section jarvis-activity" data-tool-section="activity">{activityContent}</section>
        ) : (
          <details className="jarvis-tool-section jarvis-activity">
            <summary>{t("최근 활동", "Recent activity")}</summary>
            {activityContent}
          </details>
        ))}
        </fieldset>
      </div>
    </div>
  );
}

function EntrySection({ section, title, label, limit, onAdd, children, hideHeading }: {
  section: "tasks" | "notes";
  title: string;
  label: string;
  limit: number;
  onAdd: (text: string) => void;
  children: ReactNode;
  hideHeading?: boolean;
}) {
  const [value, setValue] = useState("");
  const id = "jarvis-" + section;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    onAdd(value);
    setValue("");
  }

  return (
    <section className="jarvis-tool-section" data-tool-section={section} aria-labelledby={hideHeading ? undefined : id}>
      {!hideHeading && <h2 id={id}>{title}</h2>}
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
