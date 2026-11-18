"use client";

const AUTH_TOKEN_KEY = "jarvis_auth_token";
const AUTH_USER_KEY = "jarvis_auth_user";
const AUTH_REMEMBER_KEY = "jarvis_auth_remember";
export const AUTH_SESSION_CHANGED = "jarvis:auth-session-changed";

export type AuthSettings = {
  autoSync?: boolean;
  preferWebAi?: boolean;
  language?: "auto" | "ko" | "en";
  geminiKey?: string;
  planConfirmed?: boolean;
};

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  plan?: "free" | "pro";
  settings?: AuthSettings;
};

type StoredAuthSession = {
  token: string | null;
  user: AuthUser | null;
  canRemember?: boolean;
  remembered?: boolean;
  status?: "unavailable" | "save-failed" | "read-failed";
};

type DesktopAccountBridge = {
  restoreAccountSession(allowLegacy: boolean): Promise<StoredAuthSession>;
  saveAccountSession(payload: { token: string; user: AuthUser; remember: boolean }): Promise<StoredAuthSession>;
  clearAccountSession(): Promise<void>;
};

const EMPTY_SESSION = { token: null, user: null };
let desktopSession: StoredAuthSession = EMPTY_SESSION;
let accountOperation: Promise<unknown> = Promise.resolve();

function desktopBridge() {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { assistantAPI?: DesktopAccountBridge }).assistantAPI;
}

function runAccountOperation<T>(operation: () => Promise<T>) {
  const next = accountOperation.then(operation);
  accountOperation = next.catch(() => {});
  return next;
}

function removeBrowserSessionCopies() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    storage.removeItem(AUTH_TOKEN_KEY);
    storage.removeItem(AUTH_USER_KEY);
  }
}

function notifySessionChanged() {
  window.dispatchEvent(new Event(AUTH_SESSION_CHANGED));
}

function readStorageSession(storage: Storage | undefined): StoredAuthSession {
  if (!storage) {
    return { token: null, user: null };
  }

  const token = storage.getItem(AUTH_TOKEN_KEY);
  const rawUser = storage.getItem(AUTH_USER_KEY);

  if (!rawUser) {
    return { token, user: null };
  }

  try {
    return {
      token,
      user: JSON.parse(rawUser) as AuthUser,
    };
  } catch {
    return { token, user: null };
  }
}

export function readStoredAuthSession(): StoredAuthSession {
  if (typeof window === "undefined") {
    return { token: null, user: null };
  }

  if (desktopBridge()) return desktopSession;

  const session = readStorageSession(window.sessionStorage);
  if (session.token && session.user) {
    return session;
  }

  if (!isAuthRemembered()) {
    return { token: null, user: null };
  }

  return readStorageSession(window.localStorage);
}

export function isAuthRemembered(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  return desktopSession.token
    ? desktopSession.remembered === true
    : window.localStorage.getItem(AUTH_REMEMBER_KEY) !== "0";
}

export function setAuthRemembered(remember: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AUTH_REMEMBER_KEY, remember ? "1" : "0");
}

export async function restoreAuthSession(): Promise<StoredAuthSession> {
  const bridge = desktopBridge();
  if (!bridge) return readStoredAuthSession();

  return runAccountOperation(async () => {
    removeBrowserSessionCopies();
    desktopSession = await bridge.restoreAccountSession(window.localStorage.getItem(AUTH_REMEMBER_KEY) !== "0");
    return desktopSession;
  });
}

export async function persistAuthSession(
  token: string,
  user: AuthUser,
  options: { remember?: boolean } = {},
): Promise<StoredAuthSession> {
  if (typeof window === "undefined") return EMPTY_SESSION;

  const remember = options.remember ?? true;
  const bridge = desktopBridge();
  if (bridge) {
    return runAccountOperation(async () => {
      removeBrowserSessionCopies();
      desktopSession = await bridge.saveAccountSession({ token, user, remember });
      setAuthRemembered(remember);
      notifySessionChanged();
      return desktopSession;
    });
  }

  const storage = remember ? window.localStorage : window.sessionStorage;
  removeBrowserSessionCopies();
  storage.setItem(AUTH_TOKEN_KEY, token);
  storage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  setAuthRemembered(remember);
  notifySessionChanged();
  return { token, user, remembered: remember };
}

export async function clearAuthSession() {
  if (typeof window === "undefined") return;

  const bridge = desktopBridge();
  if (bridge) {
    await runAccountOperation(async () => {
      removeBrowserSessionCopies();
      await bridge.clearAccountSession();
      desktopSession = EMPTY_SESSION;
      notifySessionChanged();
    });
    return;
  }

  removeBrowserSessionCopies();
  notifySessionChanged();
}
