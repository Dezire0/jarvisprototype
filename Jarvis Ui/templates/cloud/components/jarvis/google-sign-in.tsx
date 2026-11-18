"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/components/jarvis/auth-session";
import { useWorkspaceLocale } from "@/lib/workspace-language";

const API_BASE = "https://jarvis-auth-service.dexproject.workers.dev";
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

type Flow = { controller: AbortController; popup: Window | null; attempt?: string; verifier?: string };
type Failure = "unavailable" | "not-opened" | "expired" | "link-required" | "failed";

function post(route: string, body: object, signal: AbortSignal) {
  return fetch(`${API_BASE}/api/auth/google/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
}

function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    const timer = setTimeout(finish, milliseconds);
    if (signal.aborted) finish();
    else signal.addEventListener("abort", finish, { once: true });
  });
}

function readSession(value: unknown): { token: string; user: AuthUser } | null {
  if (!value || typeof value !== "object") return null;
  const { token, user } = value as { token?: unknown; user?: AuthUser };
  if (typeof token !== "string" || token.length > 4096 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) ||
      !user || typeof user.id !== "string" || !user.id || typeof user.email !== "string" || !user.email ||
      (user.plan !== "free" && user.plan !== "pro")) return null;
  return { token, user };
}

export function GoogleSignIn({ disabled, onBusyChange, onSession }: {
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
  onSession: (token: string, user: AuthUser) => Promise<void> | void;
}) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const active = useRef<Flow | null>(null);
  const [progress, setProgress] = useState<"opening" | "waiting" | "finishing" | null>(null);
  const [error, setError] = useState<Failure | null>(null);

  useEffect(() => () => {
    active.current?.controller.abort();
    active.current?.popup?.close();
    active.current = null;
  }, []);

  function finish(flow: Flow) {
    if (active.current !== flow) return;
    active.current = null;
    setProgress(null);
    onBusyChange(false);
  }

  function cancel() {
    const flow = active.current;
    if (!flow) return;
    flow.controller.abort();
    flow.popup?.close();
    if (flow.attempt && flow.verifier) {
      void post("cancel", { attempt: flow.attempt, verifier: flow.verifier }, AbortSignal.timeout(5000)).catch(() => {});
    }
    finish(flow);
  }

  async function start() {
    if (active.current || disabled) return;
    setError(null);
    const desktop = window.assistantAPI;
    const popup = desktop ? null : window.open("about:blank", "_blank");
    if (!desktop && !popup) {
      setError("not-opened");
      return;
    }
    if (popup) popup.opener = null;

    const flow: Flow = { controller: new AbortController(), popup };
    const signal = flow.controller.signal;
    active.current = flow;
    setProgress("opening");
    onBusyChange(true);
    let failure: Failure = "failed";

    try {
      const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      const started = await post("attempt", { challenge }, signal);
      if (!started.ok) {
        failure = "unavailable";
        throw new Error("Google sign-in could not start");
      }
      const { attempt, expiresInMs } = await started.json();
      if (typeof attempt !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(attempt) ||
          !Number.isFinite(expiresInMs) || expiresInMs <= 0) throw new Error("Invalid sign-in attempt");
      if (signal.aborted) return;
      flow.attempt = attempt;
      flow.verifier = verifier;

      const url = new URL("/api/auth/google", API_BASE);
      url.searchParams.set("attempt", attempt);
      if (desktop) {
        failure = "not-opened";
        const opened = await desktop.invokeTool("system:open-external", { url: url.toString() }) as { ok?: boolean };
        if (!opened?.ok) throw new Error("Browser did not open");
      } else {
        popup?.location.replace(url.toString());
      }
      if (signal.aborted) return;
      setProgress("waiting");
      failure = "failed";
      const expiresAt = Date.now() + Math.min(expiresInMs, 10 * 60 * 1000);
      while (Date.now() < expiresAt) {
        await pause(2500, signal);
        if (signal.aborted) return;
        const response = await post("complete", { attempt, verifier }, signal);
        if (response.status === 202) continue;
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          if (result?.code === "link_required") failure = "link-required";
          else if (response.status === 404) failure = "expired";
          throw new Error("Google sign-in did not complete");
        }
        const session = readSession(await response.json());
        if (!session) throw new Error("Invalid Google sign-in response");
        if (signal.aborted) return;
        setProgress("finishing");
        await onSession(session.token, session.user);
        return;
      }
      failure = "expired";
      throw new Error("Google sign-in expired");
    } catch {
      if (!signal.aborted) {
        if (failure === "unavailable" || failure === "not-opened") popup?.close();
        setError(failure);
      }
    } finally {
      finish(flow);
    }
  }

  const messages: Record<Failure, string> = {
    unavailable: t("Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도하세요.", "Couldn’t start Google sign-in. Try again in a moment."),
    "not-opened": t("브라우저를 열지 못했습니다. 팝업 허용 여부를 확인하세요.", "Couldn’t open a browser tab. Check whether pop-ups are allowed."),
    expired: t("로그인 요청이 만료되었습니다. 다시 시도하세요.", "The sign-in request expired. Try again."),
    "link-required": t("기존 계정과 Google을 연결해야 합니다. 기존 계정에 비밀번호가 있다면 이메일로 로그인하세요.",
      "This Google account needs to be linked. If your Jarvis account has a password, sign in with email."),
    failed: t("Google 로그인이 완료되지 않았습니다. 다시 시도하세요.", "Google sign-in didn’t finish. Try again."),
  };

  return (
    <div className="grid gap-2">
      {progress && <p role="status" className="text-sm text-muted-foreground">
        {progress === "opening" ? t("브라우저를 여는 중…", "Opening your browser…")
          : progress === "waiting" ? t("브라우저에서 로그인한 뒤 이 창으로 돌아오세요.", "Finish signing in in your browser, then return here.")
          : t("로그인을 마치는 중…", "Finishing sign-in…")}
      </p>}
      <Button type="button" variant="outline" className="h-11" hidden={progress === "finishing"} disabled={disabled}
        onClick={progress ? cancel : () => void start()}>
        {progress ? t("Google 로그인 취소", "Cancel Google sign-in") : t("Google 계정으로 로그인", "Sign in with Google")}
      </Button>
      {error && <p role="alert" className="jarvis-auth-error">{messages[error]}</p>}
    </div>
  );
}
