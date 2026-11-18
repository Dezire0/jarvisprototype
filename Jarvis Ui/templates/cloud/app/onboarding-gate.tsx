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


import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SparklesIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
  ArrowRightIcon,
  CheckIcon,
} from "lucide-react";
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

  const isKo =
    typeof navigator !== "undefined" && navigator.language.startsWith("ko");
  const t = (ko: string, en: string) => (isKo ? ko : en);
  const selectedPlanLabel = selectedPlan === "free" ? t("무료", "Free") : t("유료", "Paid");
  const planCards = {
    free: {
      title: t("무료", "Free"),
      price: "$0",
      summary: t(
        "0달러로 시작하지만 하루 사용량 한도가 있는 플랜입니다.",
        "Start at $0 with a daily usage limit."
      ),
      details: t(
        "가볍게 시작하기 좋은 플랜이에요. 기본 모델과 정해진 무료 한도로 대화를 이어갈 수 있습니다.",
        "A good starting plan with the standard model and a fixed free usage allowance."
      ),
      features: [
        t("하루 15회 메시지", "15 messages per day"),
        t("기본 모델 사용", "Standard model access"),
        t("가벼운 질문과 짧은 작업에 적합", "Best for lighter chats and short tasks"),
      ],
    },
    pro: {
      title: t("유료", "Paid"),
      price: "$1",
      summary: t(
        "거의 제한 없이 더 넉넉한 사용량과 더 강한 모델을 쓰는 플랜입니다.",
        "Use roomier limits and a stronger model for $1."
      ),
      details: t(
        "긴 대화나 반복 사용이 많다면 유료 플랜이 더 안정적이에요. 더 빠른 응답과 더 넓은 작업량을 기대할 수 있습니다.",
        "Paid is better for longer chats and heavier usage, with faster responses and more room to work."
      ),
      features: [
        t("훨씬 넉넉한 사용량", "Much roomier usage"),
        t("더 빠르고 강한 모델", "Faster and stronger model"),
        t("긴 작업과 멀티턴 대화에 유리", "Better for long tasks and multi-turn chats"),
      ],
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

  const currentPlan = planCards[selectedPlan];

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

  async function handleAuth(e: React.FormEvent) {
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

  async function handleSetup() {
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

  // ─── Step 1: Auth (Login/Register) ───
  if (step === "auth") {
    return (
      <div className="jarvis-auth-shell">
        <header className="jarvis-toolbar">
          <span className="font-semibold">Jarvis</span>
          <div className="flex items-center gap-1">
            <LocalToolsLink />
            <ThemeToggle />
          </div>
        </header>
        <div className="jarvis-auth-panel">
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
        </div>
      </div>
    );
  }

  // ─── Step 2: Setup (Plan Selection) ───
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background py-12 text-foreground">
      <div className="w-full max-w-5xl px-6">
        <div className="mb-12 text-center">
          <h2 className="mt-4 text-4xl font-bold tracking-tight">
            {t("플랜을 선택하고 시작하세요", "Choose your plan and continue")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t(
              "로그인만으로는 아직 채팅을 시작할 수 없어요. 먼저 무료 또는 유료 플랜을 선택해야 API가 활성화됩니다.",
              "Signing in is not enough yet. Pick Free or Paid first so API access can be enabled."
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {(["free", "pro"] as const).map((planKey) => {
            const plan = planCards[planKey];
            const isActive = selectedPlan === planKey;

            return (
              <button
                type="button"
                key={planKey}
                onClick={() => setSelectedPlan(planKey)}
                className={`rounded-2xl border p-6 text-left transition-colors ${
                  isActive
                    ? "border-[var(--jarvis-focus)] bg-card"
                    : "border-border bg-card hover:border-[var(--jarvis-control-border)]"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
                      {plan.title}
                    </p>
                    <h3 className="mt-3 text-4xl font-semibold">{plan.price}</h3>
                    <p className="mt-4 text-sm leading-6 text-muted-foreground">{plan.summary}</p>
                  </div>
                  <div
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      isActive
                        ? "border-white/60 bg-white text-black"
                        : "border-white/15 text-muted-foreground"
                    }`}
                  >
                    {isActive ? t("선택됨", "Selected") : t("선택", "Select")}
                  </div>
                </div>

                <div className="mt-8 flex flex-col gap-4 text-sm text-muted-foreground">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-3">
                      <CheckIcon className={`mt-0.5 size-4 ${isActive ? "text-white" : "text-zinc-500"}`} />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-8 rounded-[32px] border border-white/10 bg-white/[0.03] p-8">
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
              {selectedPlan === "free" ? (
                <SparklesIcon className="size-5 text-white" />
              ) : (
                <ShieldCheckIcon className="size-5 text-white" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                {t("현재 선택한 플랜", "Selected plan")}: {selectedPlanLabel}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{currentPlan.details}</p>
              <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
                <ArrowRightIcon className="size-4" />
                <span>
                  {selectedPlan === "free"
                    ? t("무료 플랜은 사용량이 정해져 있어요.", "Free comes with a fixed usage allowance.")
                    : t("유료 플랜은 더 빠른 모델과 넉넉한 사용량을 제공합니다.", "Paid gives you a faster model and roomier usage.")}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center gap-4">
          {sessionOnly && (
            <p role="status" className="text-sm text-muted-foreground">
              {storageWarning
                ? t("로그인 정보를 저장하지 못했습니다. 앱을 종료하면 다시 로그인해야 합니다.", "Your session couldn’t be saved. Sign in again after quitting Jarvis.")
                : t("앱을 종료할 때까지 로그인 상태가 유지됩니다.", "You’ll stay signed in until you quit Jarvis.")}
            </p>
          )}
          {setupError && <p role="alert" className="jarvis-auth-error">{setupError}</p>}
          <Button
            disabled={setupLoading}
            onClick={handleSetup}
            className="h-14 w-full max-w-sm rounded-full bg-white text-lg font-bold text-black transition-all hover:scale-105 active:scale-95 disabled:opacity-50 shadow-[0_0_30px_rgba(255,255,255,0.15)]"
          >
            {setupLoading ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              t(`${selectedPlanLabel} 플랜으로 시작하기`, `Continue with ${selectedPlanLabel}`)
            )}
          </Button>
          <p className="text-xs text-zinc-500">
            {t("플랜은 나중에 다시 변경할 수 있어요.", "You can change your plan later.")}
          </p>
        </div>
      </div>
    </div>
  );
}
