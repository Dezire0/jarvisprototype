export type Timer = { seconds: number; remaining: number; endsAt: number | null };
export type Entry = { id: string; text: string };
export type Task = Entry & { done: boolean };
export type Workspace = { timer: Timer; tasks: Task[]; notes: Entry[]; speakResults: boolean };
export type Result = { title: string; detail?: string; href?: string; failed?: boolean };

export const emptyWorkspace: Workspace = {
  timer: { seconds: 25 * 60, remaining: 25 * 60, endsAt: null },
  tasks: [],
  notes: [],
  speakResults: false,
};

export const workspaceKey = "jarvis-local-workspace:v1";
const MAX_DURATION = 24 * 60 * 60;
const TIME_UNITS: Record<string, number> = { h: 3600, m: 60, s: 1, 시간: 3600, 분: 60, 초: 1 };
const SHORTCUTS = new Map([
  ["github", "https://github.com/"],
  ["youtube", "https://www.youtube.com/"],
  ["gmail", "https://mail.google.com/"],
  ["wikipedia", "https://www.wikipedia.org/"],
  ["google", "https://www.google.com/"],
  ["calendar", "https://calendar.google.com/"],
]);

export function remainingSeconds(timer: Timer, now: number) {
  return timer.endsAt === null
    ? timer.remaining
    : Math.min(timer.seconds, Math.max(0, Math.ceil((timer.endsAt - now) / 1000)));
}

export function formatTimer(seconds: number) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  return minutes + ":" + String(seconds % 60).padStart(2, "0");
}

function parseDuration(input: string) {
  const pattern = /([+-]?\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s|시간|분|초)(?![a-z])/gi;
  const matches = [...input.matchAll(pattern)];
  if (matches.some(([, value]) => Number(value) <= 0)) return 0;
  const seconds = matches.reduce((sum, [, value, unit]) => {
    const key = /^[a-z]/i.test(unit) ? unit[0].toLowerCase() : unit;
    return sum + Number(value) * TIME_UNITS[key];
  }, 0);
  return Math.round(seconds);
}

export function readWorkspace(value: string | null): Workspace {
  if (!value) return emptyWorkspace;

  try {
    const saved = JSON.parse(value) as Partial<Workspace> | null;
    const validEntry = (entry: unknown): entry is Entry => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as Partial<Entry>;
      return typeof value.id === "string" && typeof value.text === "string";
    };
    const timer = saved?.timer;
    const validTimer = timer &&
      Number.isInteger(timer.seconds) && timer.seconds >= 1 && timer.seconds <= MAX_DURATION &&
      Number.isInteger(timer.remaining) && timer.remaining >= 0 && timer.remaining <= timer.seconds &&
      (timer.endsAt === null || Number.isFinite(timer.endsAt));
    return {
      timer: validTimer ? timer : emptyWorkspace.timer,
      tasks: Array.isArray(saved?.tasks)
        ? saved.tasks.filter((task) => validEntry(task) && typeof (task as Task).done === "boolean")
        : [],
      notes: Array.isArray(saved?.notes) ? saved.notes.filter(validEntry) : [],
      speakResults: saved?.speakResults === true,
    };
  } catch {
    return emptyWorkspace;
  }
}

export type LocalCommand =
  | { kind: "help" | "time" | "date" | "diagnostics" | "pause" | "resume" | "reset" | "tasks" | "notes" | "clear" }
  | { kind: "weather" }
  | { kind: "speech"; enabled: boolean }
  | { kind: "timer"; seconds: number }
  | { kind: "complete"; position: number }
  | { kind: "task" | "note" | "calculate" | "shortcut" | "search"; text: string };

export function parseLocalCommand(input: string): LocalCommand | null {
  const raw = input.trim().replace(/^(?:(?:hey\s+)?jarvis|자비스)(?:[,:\s]+|$)/i, "");
  if (/^(help|commands|capabilities|what can you do\??|도움말|명령어|명령)$/i.test(raw)) return { kind: "help" };
  if (/^(time|what time is it\??|current time\??|몇 시|지금 몇 시|시간)$/i.test(raw)) return { kind: "time" };
  if (/^(date|what is the date\??|today|오늘 날짜|날짜)$/i.test(raw)) return { kind: "date" };
  if (/^(run diagnostics|diagnostics|scan|scan system|system status|status|시스템|진단)$/i.test(raw)) return { kind: "diagnostics" };
  if (/^(weather|check weather|날씨|현재 날씨)$/i.test(raw)) return { kind: "weather" };
  if (/^(pause timer|stop timer|타이머 (정지|멈춰))$/i.test(raw)) return { kind: "pause" };
  if (/^(resume timer|start timer|타이머 시작)$/i.test(raw)) return { kind: "resume" };
  if (/^(reset timer|타이머 초기화)$/i.test(raw)) return { kind: "reset" };
  if (/^(list tasks|show tasks|objectives|할 ?일|작업 목록)$/i.test(raw)) return { kind: "tasks" };
  if (/^(notes|show notes|list notes|메모 (목록|보기))$/i.test(raw)) return { kind: "notes" };

  if (/^(clear chat|clear result|clear conversation|대화 삭제|결과 지우기)$/i.test(raw)) return { kind: "clear" };
  if (/^(speak on|voice on|unmute|음성 켜|말하기 켜)$/i.test(raw)) return { kind: "speech", enabled: true };
  if (/^(speak off|voice off|mute|음성 꺼|말하기 꺼)$/i.test(raw)) return { kind: "speech", enabled: false };

  const completion = /^(?:complete task|finish task|mark task|(?:할 ?일|작업) 완료)\s+(\d+)$/i.exec(raw);
  if (completion) return { kind: "complete", position: Number(completion[1]) };

  const task = /^(?:(?:add task|create task|new task|할 ?일 추가|작업 추가)\s*:?\s+|task:\s*)([\s\S]*)$/i.exec(raw);
  if (task) return { kind: "task", text: task[1].trim() };

  const note = /^(?:note|remember|save note|메모|기록)\s*(?::\s*|\s+)([\s\S]*)$/i.exec(raw);
  if (note) return { kind: "note", text: note[1].trim() };

  const math = /^(?:calculate|calc|compute|계산(?:해줘|해)?)\s*(?::\s*|\s+)(.*)$/i.exec(raw);
  if (math) return { kind: "calculate", text: math[1] };

  const search = /^(?:search(?: for)?|google|검색(?:해줘)?)\s*(?::\s*|\s+)(.*)$/i.exec(raw);
  if (search) return { kind: "search", text: search[1].trim() };

  const open = /^(?:open|launch|go to|열어|열기)\s+([\w.-]+)$/i.exec(raw);
  if (open) return { kind: "shortcut", text: open[1].toLowerCase() };

  const focus = /^(?:focus|pomodoro|집중)(?:\s*(\d+))?$/i.exec(raw);
  if (focus) return { kind: "timer", seconds: 60 * Number(focus[1] ?? 25) };

  if (/^(?:(?:set\s+)?(?:a\s+)?(?:timer|countdown)\b|타이머|집중|focus\b|pomodoro\b)/i.test(raw) || /^\d.*타이머(?:\s|$)/i.test(raw)) {
    return { kind: "timer", seconds: parseDuration(raw) };
  }
  return null;
}

// The Protocol arithmetic grammar, with bounded input and no expression evaluation.
export function calculate(expression: string) {
  const source = expression.replace(/×/g, "*").replace(/÷/g, "/").replace(/[−–]/g, "-").replace(/\s+/g, "");
  if (source.length > 150 || !source || /[^0-9eE.+*/()%^-]/.test(source)) {
    throw new Error("Enter a numeric expression using +, −, ×, ÷, %, ^ or parentheses.");
  }

  let cursor = 0;
  function consume(token: string) {
    if (!source.startsWith(token, cursor)) return false;
    cursor += token.length;
    return true;
  }

  function primary(): number {
    if (consume("(")) {
      const value = add();
      if (!consume(")")) throw new Error("Missing closing parenthesis.");
      return value;
    }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(cursor));
    if (!match) throw new Error("A number was expected.");
    cursor += match[0].length;
    return Number(match[0]);
  }

  function unary(): number {
    if (consume("+")) return unary();
    if (consume("-")) return -unary();
    const left = primary();
    return consume("^") ? left ** unary() : left;
  }

  function multiply() {
    let value = unary();
    while (true) {
      const operator = source[cursor];
      if (operator !== "*" && operator !== "/" && operator !== "%") return value;
      cursor++;
      const right = unary();
      if (operator !== "*" && right === 0) throw new Error("Division by zero is undefined.");
      if (operator === "*") value *= right;
      if (operator === "/") value /= right;
      if (operator === "%") value %= right;
    }
  }

  function add() {
    let value = multiply();
    while (true) {
      if (consume("+")) value += multiply();
      else if (consume("-")) value -= multiply();
      else return value;
    }
  }

  const value = add();
  if (cursor !== source.length || !Number.isFinite(value)) throw new Error("This expression has no finite result.");
  return Number(value.toPrecision(12));
}

export function runLocalCommand(
  command: Exclude<LocalCommand, { kind: "weather" }>,
  workspace: Workspace,
  now: number,
  id: string,
  locale: string,
): { workspace: Workspace; result: Result } {
  const ko = locale.startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const finish = (result: Result, next = workspace) => ({ workspace: next, result });
  const timer = workspace.timer;

  switch (command.kind) {
    case "help":
      return finish({
        title: t("로컬 명령", "Local commands"),
        detail: t("10분 타이머 맞춰줘\n할 일 추가 초안 검토\n메모 다음 회의 준비\n계산 (12 + 4) * 3", "timer 10 minutes\nadd task Review the draft\nnote Prepare for the meeting\ncalculate (12 + 4) * 3"),
      });
    case "time":
      return finish({ title: new Date(now).toLocaleTimeString(locale, { timeStyle: "short" }) });
    case "date":
      return finish({ title: new Date(now).toLocaleDateString(locale, { dateStyle: "full" }) });
    case "diagnostics":
      return finish({ title: t("로컬 명령 엔진 사용 가능", "Local command engine available") });
    case "clear":
      return finish({ title: t("결과를 지웠습니다", "Result cleared") });
    case "speech":
      return finish({ title: command.enabled
        ? t("결과 읽기 켜짐", "Spoken results on")
        : t("결과 읽기 꺼짐", "Spoken results off")
      }, { ...workspace, speakResults: command.enabled });
    case "timer": {
      const seconds = command.seconds;
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_DURATION) {
        return finish({ title: t("1초에서 24시간 사이로 지정하세요", "Choose a duration from one second to 24 hours"), failed: true });
      }
      return finish({ title: t("타이머 시작", "Timer started"), detail: formatTimer(seconds) }, {
        ...workspace, timer: { seconds, remaining: seconds, endsAt: now + seconds * 1000 },
      });
    }
    case "pause": {
      const remaining = remainingSeconds(timer, now);
      if (timer.endsAt === null || remaining === 0) {
        return finish({ title: t("실행 중인 타이머가 없습니다", "No timer is running"), failed: true });
      }
      return finish({ title: t("타이머 일시 정지", "Timer paused"), detail: formatTimer(remaining) }, {
        ...workspace, timer: { ...timer, remaining, endsAt: null },
      });
    }
    case "resume": {
      const remaining = remainingSeconds(timer, now);
      if (timer.endsAt !== null && remaining > 0) {
        return finish({ title: t("타이머 실행 중", "Timer already running"), detail: formatTimer(remaining) });
      }
      const seconds = remaining || timer.seconds;
      return finish({ title: t("타이머 시작", "Timer started"), detail: formatTimer(seconds) }, {
        ...workspace, timer: { ...timer, remaining: seconds, endsAt: now + seconds * 1000 },
      });
    }
    case "reset":
      return finish({ title: t("타이머 초기화", "Timer reset"), detail: formatTimer(timer.seconds) }, {
        ...workspace, timer: { ...timer, remaining: timer.seconds, endsAt: null },
      });
    case "tasks":
      return finish({
        title: t("할 일", "Tasks"),
        detail: workspace.tasks.map((task, index) => String(index + 1) + ". " + (task.done ? "✓ " : "") + task.text).join("\n"),
      });
    case "notes":
      return finish({ title: t("메모", "Notes"), detail: workspace.notes.map((item) => item.text).join("\n") });
    case "task":
    case "note": {
      const text = command.text.trim().slice(0, command.kind === "task" ? 160 : 500);
      if (!text) return finish({ title: t("내용을 입력해 주세요", "Enter some text"), failed: true });
      return command.kind === "task"
        ? finish({ title: t("할 일 추가", "Task added"), detail: text }, { ...workspace, tasks: [{ id, text, done: false }, ...workspace.tasks] })
        : finish({ title: t("메모 저장", "Note saved"), detail: text }, { ...workspace, notes: [{ id, text }, ...workspace.notes] });
    }
    case "complete": {
      const task = workspace.tasks[command.position - 1];
      if (!task) return finish({ title: t("해당 번호의 할 일이 없습니다", "No task matches that number"), failed: true });
      return finish({ title: t("할 일 완료", "Task completed"), detail: task.text }, {
        ...workspace, tasks: workspace.tasks.map((item) => item.id === task.id ? { ...item, done: true } : item),
      });
    }
    case "calculate":
      try {
        return finish({ title: new Intl.NumberFormat(locale, { maximumFractionDigits: 12 }).format(calculate(command.text)), detail: command.text });
      } catch (error) {
        return finish({ title: t("계산할 수 없습니다", "Could not calculate"), detail: ko ? undefined : (error as Error).message, failed: true });
      }
    case "shortcut": {
      const href = SHORTCUTS.get(command.text);
      return finish(href
        ? { title: command.text, href }
        : { title: t("등록된 바로가기가 없습니다", "Unknown shortcut"), failed: true });
    }
    case "search":
      return finish(command.text
        ? { title: t("웹 검색", "Web search"), detail: command.text, href: "https://www.google.com/search?q=" + encodeURIComponent(command.text) }
        : { title: t("검색어를 입력해 주세요", "Enter a search term"), failed: true });
  }
  return finish({ title: t("로컬 명령을 실행할 수 없습니다", "Local command unavailable"), failed: true });
}
