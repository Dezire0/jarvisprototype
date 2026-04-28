"use client";

const AUTH_TOKEN_KEY = "jarvis_auth_token";
const AUTH_USER_KEY = "jarvis_auth_user";
const AUTH_REMEMBER_KEY = "jarvis_auth_remember";

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
};

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

function readLocalSession(): StoredAuthSession {
  if (typeof window === "undefined") {
    return { token: null, user: null };
  }

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

  return window.localStorage.getItem(AUTH_REMEMBER_KEY) !== "0";
}

export function setAuthRemembered(remember: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AUTH_REMEMBER_KEY, remember ? "1" : "0");
}

export async function restoreAuthSession(): Promise<StoredAuthSession> {
  const local = readLocalSession();
  if (local.token && local.user) {
    return local;
  }

  if (
    typeof window === "undefined" ||
    !isAuthRemembered() ||
    !(window as any).assistantAPI?.invokeTool
  ) {
    return local;
  }

  try {
    const restored = (await (window as any).assistantAPI.invokeTool(
      "auth:session-restore",
    )) as {
      token?: string | null;
      user?: AuthUser | null;
    };

    const token = restored?.token || null;
    const user = restored?.user || null;

    if (token) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    }
    if (user) {
      window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    }

    return {
      token,
      user,
    };
  } catch {
    return local;
  }
}

export async function persistAuthSession(
  token: string,
  user: AuthUser,
  options: { remember?: boolean } = {},
) {
  if (typeof window === "undefined") {
    return;
  }

  const remember = options.remember ?? true;
  const targetStorage = remember ? window.localStorage : window.sessionStorage;
  const otherStorage = remember ? window.sessionStorage : window.localStorage;

  targetStorage.setItem(AUTH_TOKEN_KEY, token);
  targetStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  otherStorage.removeItem(AUTH_TOKEN_KEY);
  otherStorage.removeItem(AUTH_USER_KEY);
  setAuthRemembered(remember);

  try {
    if (remember) {
      await (window as any).assistantAPI?.invokeTool("auth:session-save", {
        token,
        user,
      });
    } else {
      await (window as any).assistantAPI?.invokeTool("auth:session-clear");
    }
  } catch {
    // Keep browser storage as the fallback.
  }
}

export async function updateStoredAuthUser(user: AuthUser) {
  if (typeof window === "undefined") {
    return;
  }

  const sessionStorageToken = window.sessionStorage.getItem(AUTH_TOKEN_KEY);
  const localStorageToken = window.localStorage.getItem(AUTH_TOKEN_KEY);
  const token = sessionStorageToken || localStorageToken;
  const targetStorage = sessionStorageToken ? window.sessionStorage : window.localStorage;

  targetStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));

  if (!token) {
    return;
  }

  try {
    if (targetStorage === window.localStorage) {
      await (window as any).assistantAPI?.invokeTool("auth:session-save", {
        token,
        user,
      });
    }
  } catch {
    // Browser session remains available.
  }
}

export async function clearAuthSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_USER_KEY);
  window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
  window.sessionStorage.removeItem(AUTH_USER_KEY);

  try {
    await (window as any).assistantAPI?.invokeTool("auth:session-clear");
  } catch {
    // Best effort.
  }
}
