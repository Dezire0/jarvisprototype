"use client";

// Global CSS to enable copy-paste and text selection in Electron
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.innerHTML = `
    * {
      -webkit-user-select: text !important;
      user-select: text !important;
    }
    input, textarea {
      -webkit-user-select: auto !important;
      user-select: auto !important;
    }
    button, [role="button"], .no-select {
      -webkit-user-select: none !important;
      user-select: none !important;
    }
  `;
  document.head.appendChild(style);
}


import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoaderCircleIcon } from "lucide-react";
import {
  AUTH_SESSION_CHANGED,
  clearAuthSession,
  readStoredAuthSession,
  restoreAuthSession,
  persistAuthSession,
  isAuthRemembered,
  setAuthRemembered,
  type AuthUser,
} from "@/components/jarvis/auth-session";
import { ThemeToggle } from "@/components/jarvis/theme-toggle";
import { GoogleSignIn } from "@/components/jarvis/google-sign-in";
import { LocalToolsLink } from "@/components/jarvis/local-tools-link";
import { Assistant } from "./assistant";
const {
  markPlanConfirmed,
  resolveFreshAuthStep,
  resolveRestoredSessionStep,
  selectInitialPlan,
} = require("../lib/onboarding-flow.cjs");

const API_BASE = "https://jarvis-auth-service.dexproject.workers.dev";
type OnboardingStep = "loading" | "auth" | "setup" | "ready";

export function OnboardingGate() {
  const [step, setStep] = useState<OnboardingStep>("loading");

  // Auth state
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberLogin, setRememberLogin] = useState(true);
  const [canRemember, setCanRemember] = useState(true);
  const [storageWarning, setStorageWarning] = useState(false);
  const [sessionOnly, setSessionOnly] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Setup state
  const [selectedPlan, setSelectedPlan] = useState<"free" | "pro">("free");
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const planHeading = useRef<HTMLHeadingElement>(null);

  const isKo =
    typeof navigator !== "undefined" && navigator.language.startsWith("ko");
  const t = (ko: string, en: string) => (isKo ? ko : en);
  const planOptions = {
    free: {
      name: t("무료", "Free"),
      limit: t("하루 메시지 15회", "15 messages per day"),
      submit: t("무료 플랜으로 시작", "Continue with Free"),
    },
    pro: {
      name: "Pro",
      limit: t("하루 토큰 20만 개", "200,000 tokens per day"),
      submit: t("Pro 플랜으로 시작", "Continue with Pro"),
    },
  } as const;

  function syncSelectedPlan(user?: Partial<AuthUser> | null) {
    setSelectedPlan(selectInitialPlan(user || {}));
  }

  function handleRememberLoginChange(remember: boolean) {
    setRememberLogin(remember);
    setAuthRemembered(remember);
  }

  async function saveNewSession(token: string, user: AuthUser) {
    const session = await persistAuthSession(token, user, {
      remember: canRemember && rememberLogin,
    });
    setStorageWarning(session.status === "save-failed");
    setSessionOnly(session.remembered === false);
    syncSelectedPlan(user);
    setStep(resolveFreshAuthStep(user));
  }

  async function acceptGoogleSession(token: string, user: AuthUser) {
    const nextUser = { ...user, settings: { planConfirmed: false } };
    await saveNewSession(token, nextUser);
  }

  useEffect(() => {
    if (step === "setup") planHeading.current?.focus();
  }, [step]);

  // Check session on mount. Version tracking is intentionally non-destructive:
  // users should not be logged out just because the desktop/web build updated.
  useEffect(() => {
    setRememberLogin(isAuthRemembered());
  }, []);

  useEffect(() => {
    function sessionChanged() {
      if (!readStoredAuthSession().token) setStep((current) => current === "ready" ? "auth" : current);
    }
    window.addEventListener(AUTH_SESSION_CHANGED, sessionChanged);
    return () => window.removeEventListener(AUTH_SESSION_CHANGED, sessionChanged);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const CURRENT_VERSION = "1.8.9";
        const lastVersion = localStorage.getItem("jarvis_last_version");

        if (lastVersion !== CURRENT_VERSION) {
          localStorage.setItem("jarvis_last_version", CURRENT_VERSION);
        }

        const url = new URL(window.location.href);
        if (url.searchParams.has("token") || url.searchParams.has("user")) {
          url.searchParams.delete("token");
          url.searchParams.delete("user");
          window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        }

        const session = await restoreAuthSession();
        setCanRemember(session.canRemember !== false);
        setStorageWarning(session.status === "save-failed");
        setSessionOnly(Boolean(session.token) && session.remembered === false);
        if (session.status === "read-failed") {
          setAuthError(t("저장된 로그인 정보를 열 수 없습니다. 다시 로그인해 주세요.", "Couldn’t open your saved session. Sign in again."));
        }
        if (session.token && session.user) {
          const user = session.user as AuthUser;
          syncSelectedPlan(user);
          setStep(resolveRestoredSessionStep(user));
        } else {
          setStep("auth");
        }
      } catch {
        console.error("Could not restore the sign-in session.");
        // 어떤 에러가 나도 로딩에 멈추지 않고 로그인 화면으로 보냄
        setStep("auth");
      }
    })();
  }, []);

  async function handleAuth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (googleBusy) return;
    setAuthLoading(true);
    setAuthError(null);

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name.trim() || undefined }),
      });

      const data = (await res.json()) as any;
      if (!res.ok) {
        setAuthError(data.error || t("오류가 발생했습니다.", "Error occurred."));
        return;
      }

      let token = data.token;
      let user = data.user;

      if (mode === "register") {
        const lr = await fetch(`${API_BASE}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const ld = await lr.json() as any;
        token = ld.token;
        user = ld.user;
      }

      const nextUser: AuthUser = {
        ...user,
        plan: user.plan,
        settings: {
          autoSync: false,
          preferWebAi: true,
          language: "auto",
          planConfirmed: false,
        },
      };

      try {
        await saveNewSession(token, nextUser);
      } catch {
        setAuthError(t("로그인 상태를 설정하지 못했습니다. 다시 시도해 주세요.", "Couldn’t start your session. Try again."));
      }
    } catch {
      setAuthError(t("네트워크 오류", "Network error"));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (setupLoading) return;
    setSetupLoading(true);
    setSetupError(null);
    try {
      const session = await restoreAuthSession();
      if (!session.token || !session.user) {
        await clearAuthSession();
        setAuthError(t("다시 로그인해 주세요.", "Please sign in again."));
        setStep("auth");
        return;
      }

      const response = await fetch(`${API_BASE}/api/auth/plan`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.token}`,
        },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      if (response.status === 401) {
        await clearAuthSession();
        setAuthError(t("세션이 만료되었습니다. 다시 로그인해 주세요.", "Your session expired. Sign in again."));
        setStep("auth");
        return;
      }
      if (!response.ok) {
        setSetupError(t("플랜을 저장하지 못했습니다. 잠시 후 다시 시도하세요.", "Couldn’t save your plan. Try again in a moment."));
        return;
      }

      const updatedUser = markPlanConfirmed(session.user, selectedPlan) as AuthUser;

      try {
        await persistAuthSession(session.token, updatedUser, { remember: isAuthRemembered() });
      } catch {
        setSetupError(t("로그인 상태를 갱신하지 못했습니다. 다시 시도해 주세요.", "Couldn’t update your session. Try again."));
        return;
      }
      setStep("ready");
    } catch {
      setSetupError(t("계정 서비스에 연결하지 못했습니다. 다시 시도하세요.", "Couldn’t reach the account service. Try again."));
    } finally {
      setSetupLoading(false);
    }
  }

  if (step === "loading") {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-background"><LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" /></div>
    );
  }

  if (step === "ready") {
    return <Assistant />;
  }

  return (
    <div className="jarvis-auth-shell">
      <header className="jarvis-toolbar">
        <span className="font-semibold">Jarvis</span>
        <div className="flex items-center gap-1">
          <LocalToolsLink />
          <ThemeToggle />
        </div>
      </header>
      {step === "auth" ? (
        <main className="jarvis-auth-panel">
          <h1 className="mb-5">{mode === "login" ? t("로그인", "Sign in") : t("회원가입", "Create account")}</h1>
          <form onSubmit={handleAuth} className="flex flex-col gap-3">
            {mode === "register" && (
              <label className="jarvis-auth-field">
                {t("이름", "Name")}
                <Input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="h-11" />
              </label>
            )}
            <label className="jarvis-auth-field">
              {t("이메일", "Email")}
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className="h-11" />
            </label>
            <label className="jarvis-auth-field">
              {t("비밀번호", "Password")}
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"} required className="h-11" />
            </label>
            {authError && <p role="alert" className="jarvis-auth-error">{authError}</p>}
            <label className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={canRemember && rememberLogin}
                disabled={authLoading || googleBusy || !canRemember}
                onChange={(e) => handleRememberLoginChange(e.target.checked)}
                className="size-4 accent-primary"
              />
              <span>{t("자동 로그인", "Auto login")}</span>
            </label>
            {!canRemember && (
              <p className="text-xs text-muted-foreground">
                {t("앱을 종료할 때까지 로그인 상태가 유지됩니다.", "You’ll stay signed in until you quit Jarvis.")}
              </p>
            )}
            <Button disabled={authLoading || googleBusy} className="jarvis-send h-11 font-medium active:scale-[.98]">{authLoading ? <LoaderCircleIcon className="animate-spin" /> : t("이메일로 계속하기", "Continue with Email")}</Button>

            <GoogleSignIn disabled={authLoading} onBusyChange={setGoogleBusy} onSession={acceptGoogleSession} />
          </form>
          <button disabled={googleBusy} onClick={() => setMode(mode === "login" ? "register" : "login")} className="mt-4 min-h-10 w-full rounded-md text-sm text-muted-foreground underline underline-offset-4">{mode === "login" ? t("계정이 없으신가요? 회원가입", "No account? Register") : t("이미 계정이 있나요? 로그인", "Already have account? Login")}</button>
        </main>
      ) : (
        <main className="jarvis-auth-panel jarvis-plan-panel">
          <h1 tabIndex={-1} ref={planHeading} className="outline-none">
            {t("클라우드 플랜 선택", "Choose a cloud plan")}
          </h1>
          <p className="mt-2 break-keep text-sm leading-6 text-muted-foreground">
            {t(
              "플랜은 클라우드 사용량에만 적용됩니다. 타이머, 할 일, 메모는 이 기기에서 바로 쓸 수 있습니다.",
              "This sets your cloud usage limit. Timer, tasks and notes work on this device without a plan."
            )}
          </p>
          <form onSubmit={handleSetup} className="mt-5 flex flex-col gap-4">
            <fieldset disabled={setupLoading} className="grid min-w-0 gap-2">
              <legend className="sr-only">{t("클라우드 플랜", "Cloud plan")}</legend>
              {(["free", "pro"] as const).map((plan) => (
                <label key={plan} className="jarvis-plan-option">
                  <input
                    type="radio"
                    name="cloud-plan"
                    value={plan}
                    checked={selectedPlan === plan}
                    onChange={() => {
                      setSelectedPlan(plan);
                      setSetupError(null);
                    }}
                    aria-labelledby={`plan-${plan}-name`}
                    aria-describedby={`plan-${plan}-limit`}
                  />
                  <span>
                    <span id={`plan-${plan}-name`} className="block text-sm font-semibold">{planOptions[plan].name}</span>
                    <span id={`plan-${plan}-limit`} className="block text-sm text-muted-foreground">{planOptions[plan].limit}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {sessionOnly && (
              <p role="status" className="text-sm text-muted-foreground">
                {storageWarning
                  ? t("로그인 정보를 저장하지 못했습니다. 앱을 종료하면 다시 로그인해야 합니다.", "Your session couldn’t be saved. Sign in again after quitting Jarvis.")
                  : t("앱을 종료할 때까지 로그인 상태가 유지됩니다.", "You’ll stay signed in until you quit Jarvis.")}
              </p>
            )}
            {setupError && <p id="plan-error" role="alert" className="jarvis-auth-error">{setupError}</p>}
            <Button
              type="submit"
              aria-disabled={setupLoading}
              aria-describedby={setupError ? "plan-error" : undefined}
              className="jarvis-send h-11 w-full aria-disabled:opacity-70 motion-reduce:transition-none"
            >
              {setupLoading && <LoaderCircleIcon aria-hidden="true" className="motion-safe:animate-spin" />}
              {setupLoading ? t("저장 중…", "Saving…") : planOptions[selectedPlan].submit}
            </Button>
          </form>
        </main>
      )}
    </div>
  );
}
