"use client";

const AUTH_TOKEN_KEY = "jarvis_auth_token";
const AUTH_USER_KEY = "jarvis_auth_user";

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

function readLocalSession(): StoredAuthSession {
  if (typeof window === "undefined") {
    return { token: null, user: null };
  }

  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  const rawUser = window.localStorage.getItem(AUTH_USER_KEY);

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

export async function restoreAuthSession(): Promise<StoredAuthSession> {
  const local = readLocalSession();
  if (local.token && local.user) {
    return local;
  }

  if (typeof window === "undefined" || !(window as any).assistantAPI?.invokeTool) {
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

export async function persistAuthSession(token: string, user: AuthUser) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));

  try {
    await (window as any).assistantAPI?.invokeTool("auth:session-save", {
      token,
      user,
    });
  } catch {
    // Keep localStorage as the online fallback.
  }
}

export async function updateStoredAuthUser(user: AuthUser) {
  if (typeof window === "undefined") {
    return;
  }

  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));

  if (!token) {
    return;
  }

  try {
    await (window as any).assistantAPI?.invokeTool("auth:session-save", {
      token,
      user,
    });
  } catch {
    // Local session remains available.
  }
}

export async function clearAuthSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_USER_KEY);

  try {
    await (window as any).assistantAPI?.invokeTool("auth:session-clear");
  } catch {
    // Best effort.
  }
}
