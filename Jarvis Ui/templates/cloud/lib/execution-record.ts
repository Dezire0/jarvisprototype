export const actionLabels = {
  open_url: ["페이지 열기", "Open page"],
  browser_open: ["페이지 열기", "Open page"],
  browser_open_url: ["페이지 열기", "Open page"],
  browser_navigate: ["페이지 이동", "Navigate to page"],
  chrome_navigate: ["페이지 이동", "Navigate to page"],
  open_app: ["앱 열기", "Open app"],
  desktop_open_app: ["앱 열기", "Open app"],
  app_missing: ["앱 열기", "Open app"],
  browser_login: ["사이트 로그인", "Sign in to site"],
  browser_search: ["브라우저 검색", "Search browser"],
  browser_search_google: ["웹 검색", "Search the web"],
  browser_search_youtube: ["YouTube 검색", "Search YouTube"],
  browser_click: ["페이지에서 선택", "Select on page"],
  browser_click_text: ["페이지에서 선택", "Select on page"],
  browser_click_search_result: ["검색 결과 선택", "Select search result"],
  browser_read_page: ["페이지 읽기", "Read page"],
  browser_type: ["브라우저 텍스트 입력", "Enter text in browser"],
  desktop_type: ["앱에 텍스트 입력", "Enter text in app"],
  read_page: ["페이지 읽기", "Read page"],
  app_key: ["키보드 입력", "Send keyboard shortcut"],
  app_shortcut: ["키보드 입력", "Send keyboard shortcut"],
  app_type: ["텍스트 입력", "Enter text"],
  app_menu_click: ["메뉴 선택", "Choose menu item"],
  file_read: ["파일 읽기", "Read file"],
  file_write: ["파일 저장", "Save file"],
  finder_open_path: ["Finder에서 열기", "Open in Finder"],
  finder_search: ["Finder 검색", "Search Finder"],
  finder_new_window: ["Finder 새 창", "New Finder window"],
  notes_create_note: ["메모 만들기", "Create note"],
  notes_search: ["메모 검색", "Search notes"],
  obs_connect: ["OBS 연결", "Connect to OBS"],
  obs_scene: ["OBS 장면 전환", "Switch OBS scene"],
  obs_status: ["OBS 상태 확인", "Check OBS status"],
  workspace_send_message: ["메시지 보내기", "Send message"],
  workspace_read_messages: ["메시지 읽기", "Read messages"],
  workspace_switch_target: ["대화 이동", "Switch conversation"],
  system_briefing: ["시스템 상태 확인", "Check system status"],
  other: ["동작", "Action"],
} as const;

export const actionStatuses = {
  executed: ["실행됨", "Executed"],
  failed: ["실패", "Failed"],
  "needs-confirmation": ["승인 필요", "Approval required"],
  "needs-install": ["설치 필요", "Installation needed"],
  unknown: ["결과 알 수 없음", "Outcome unavailable"],
} as const;

type ActionType = keyof typeof actionLabels;
type ActionStatus = keyof typeof actionStatuses;
export type ExecutionRecord = { type: ActionType; status: ActionStatus; host?: string; appName?: string };

function canonicalHost(value: unknown) {
  if (typeof value !== "string" || value.length > 253) return undefined;
  try {
    return new URL(`https://${value}`).hostname === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function hostFromUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 8192) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? canonicalHost(url.hostname) : undefined;
  } catch {
    return undefined;
  }
}

function displayAppName(value: unknown) {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &()+_-]{0,63}$/u.test(name) ? name : undefined;
}

export function executionRecords(value: unknown): ExecutionRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry.type !== "string" || typeof entry.status !== "string") return [];
    const type: ActionType = Object.hasOwn(actionLabels, entry.type) ? entry.type as ActionType : "other";
    const status: ActionStatus = Object.hasOwn(actionStatuses, entry.status) ? entry.status as ActionStatus : "unknown";
    const record: ExecutionRecord = { type, status };
    if (type === "open_url" || type === "browser_open" || type === "browser_open_url" ||
        type === "browser_navigate" || type === "chrome_navigate") {
      const target = type === "chrome_navigate" && typeof entry.target === "string"
        ? entry.target.replace(/^new-tab:/, "") : entry.target;
      const host = canonicalHost(entry.host) ?? hostFromUrl(target);
      if (host) record.host = host;
    }
    if ((type === "open_app" || type === "desktop_open_app") && status === "executed") {
      const appName = displayAppName(entry.appName);
      if (appName) record.appName = appName;
    }
    return [record];
  });
}
