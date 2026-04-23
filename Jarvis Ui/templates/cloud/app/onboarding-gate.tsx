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
  restoreAuthSession,
  persistAuthSession,
  type AuthUser,
} from "@/components/jarvis/auth-session";
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
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Setup state
  const [selectedPlan, setSelectedPlan] = useState<"free" | "pro">("free");
  const [setupLoading, setSetupLoading] = useState(false);

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

  const currentPlan = planCards[selectedPlan];

  // Check session on mount + Auto-wipe on version change
  useEffect(() => {
    void (async () => {
      try {
        const CURRENT_VERSION = "1.7.8";
        const lastVersion = localStorage.getItem("jarvis_last_version");

        // 버전이 바뀌었으면(업데이트됨) 로컬 + Electron 데이터 싹 밀기
        if (lastVersion !== CURRENT_VERSION) {
          console.log("Version changed! Auto-wiping all session data...");
          
          // 1. 브라우저 캐시 삭제
          localStorage.clear();
          
          // 2. Electron 저장소 삭제 (zombie session 방지)
          try {
            const { clearAuthSession } = await import("@/components/jarvis/auth-session");
            await clearAuthSession();
          } catch (e) {
            console.error("Failed to clear electron session:", e);
          }

          localStorage.setItem("jarvis_last_version", CURRENT_VERSION);
        }

        // URL 파라미터에서 토큰 확인 (구글 로그인 콜백 대응)
        const urlParams = new URLSearchParams(window.location.search);
        const urlToken = urlParams.get("token");
        const urlUserRaw = urlParams.get("user");

        if (urlToken && urlUserRaw) {
          try {
            const urlUser = JSON.parse(decodeURIComponent(urlUserRaw));
            const nextUser: AuthUser = {
              ...urlUser,
              settings: {
                ...(urlUser.settings || {}),
                planConfirmed: false,
              },
            };
            await persistAuthSession(urlToken, nextUser);
            syncSelectedPlan(nextUser);
            // URL 파라미터 제거 (깔끔한 UI를 위해)
            window.history.replaceState({}, document.title, window.location.pathname);

            setStep(resolveFreshAuthStep(nextUser));
            return;
          } catch (e) {
            console.error("Failed to parse user from URL", e);
          }
        }

        // Listen for deep link callbacks from Electron main process
        if (typeof window !== "undefined" && (window as any).assistantAPI) {
          (window as any).assistantAPI.onEvent("auth:callback", async (data: any) => {
            console.log("Received auth callback from deep link:", data);
            if (data.token && data.user) {
              const nextUser: AuthUser = {
                ...data.user,
                settings: {
                  ...(data.user.settings || {}),
                  planConfirmed: false,
                },
              };
              await persistAuthSession(data.token, nextUser);
              syncSelectedPlan(nextUser);
              setStep(resolveFreshAuthStep(nextUser));
            }
          });
        }

        const session = await restoreAuthSession();
        if (session.token && session.user) {
          const user = session.user as AuthUser;
          syncSelectedPlan(user);
          setStep(resolveRestoredSessionStep(user));
        } else {
          setStep("auth");
        }
      } catch (err) {
        console.error("Critical onboarding initialization error:", err);
        // 어떤 에러가 나도 로딩에 멈추지 않고 로그인 화면으로 보냄
        setStep("auth");
      }
    })();
  }, []);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
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
          autoSync: true,
          preferWebAi: true,
          language: "auto",
          planConfirmed: false,
        },
      };

      await persistAuthSession(token, nextUser);
      syncSelectedPlan(nextUser);
      setStep(resolveFreshAuthStep(nextUser));
    } catch {
      setAuthError(t("네트워크 오류", "Network error"));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSetup() {
    setSetupLoading(true);
    try {
      const session = await restoreAuthSession();
      if (!session.token || !session.user) return;

      // 서버 DB에 플랜 업데이트 요청 (강력한 동기화)
      try {
        const planRes = await fetch(`${API_BASE}/api/auth/plan`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.token}`
          },
          body: JSON.stringify({ plan: selectedPlan })
        });
        
        if (!planRes.ok) {
          const errData = await planRes.json().catch(() => ({}));
          console.error("Plan update failed. Server response:", errData);
          
          const mainError = errData.error || "Failed to update plan on server";
          const detailedInfo = errData.details ? ` (${errData.details})` : "";
          const fullErrorMsg = `${mainError}${detailedInfo}`;
          
          if (planRes.status === 401 || fullErrorMsg.includes("Unauthorized")) {
            setSetupLoading(false);
            alert(t("세션이 만료되었습니다. 보안을 위해 다시 로그인해 주세요.", "Session expired. Please login again for security."));
            
            localStorage.removeItem("jarvis_auth_token");
            localStorage.removeItem("jarvis_auth_user");
            (window as any).electron?.ipcRenderer.send("auth:logout");
            
            setStep("auth");
            return;
          }
          
          throw new Error(fullErrorMsg);
        }
        console.log("Plan updated on server successfully:", selectedPlan);
      } catch (err: any) {
        setSetupLoading(false);
        const detailedMsg = err.message || "Unknown error";
        console.error("Critical Plan Update Error:", err);
        alert(`[CRITICAL] ${t("서버 플랜 업데이트 실패", "Server Plan Sync Failed")}: ${detailedMsg}`);
        return;
      }

      const updatedUser = markPlanConfirmed(session.user, selectedPlan) as AuthUser;

      await persistAuthSession(session.token, updatedUser);
      setStep("ready");
    } finally {
      setSetupLoading(false);
    }
  }

  if (step === "loading") {
    return <div className="flex h-dvh w-full items-center justify-center bg-[#0a0a0a]"><LoaderCircleIcon className="size-6 animate-spin text-white/40" /></div>;
  }

  if (step === "ready") {
    return <Assistant />;
  }

  // ─── Step 1: Auth (Login/Register) ───
  if (step === "auth") {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[#0a0a0a]">
        <div className="w-full max-w-sm px-6">
          <div className="mb-8 flex flex-col items-center gap-3">
            <div className="flex size-14 items-center justify-center rounded-[22px] border border-white/10 bg-white/5">
              <SparklesIcon className="size-6 text-white" />
            </div>
            <h1 className="text-2xl font-semibold text-white">Jarvis</h1>
            <p className="text-sm text-zinc-400">{mode === "login" ? t("로그인", "Sign In") : t("회원가입", "Sign Up")}</p>
          </div>
          <form onSubmit={handleAuth} className="flex flex-col gap-3">
            {mode === "register" && (
              <Input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("이름", "Name")} className="h-11 rounded-xl bg-white/5 text-white" />
            )}
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("이메일", "Email")} required className="h-11 rounded-xl bg-white/5 text-white" />
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("비밀번호", "Password")} required className="h-11 rounded-xl bg-white/5 text-white" />
            {authError && <p className="text-xs text-red-400">{authError}</p>}
            <Button disabled={authLoading} className="h-11 rounded-xl bg-white text-black font-medium transition-all active:scale-95">{authLoading ? <LoaderCircleIcon className="animate-spin" /> : t("이메일로 계속하기", "Continue with Email")}</Button>
            
            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-white/5"></span></div>
              <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-[#0a0a0a] px-2 text-zinc-500">{t("또는", "OR")}</span></div>
            </div>

            <Button 
              type="button"
              variant="outline"
              className="h-11 rounded-xl border-white/10 bg-white/5 text-white hover:bg-white/10 transition-all active:scale-95 flex gap-2"
              onClick={() => {
                // Open the Google OAuth URL from the backend
                window.location.href = `${API_BASE}/api/auth/google`;
              }}
            >
              <svg className="size-4" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1 .67-2.28 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.67-.35-1.39-.35-2.09s.13-1.42.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1.7.8 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {t("Google 계정으로 로그인", "Sign in with Google")}
            </Button>
          </form>
          <button onClick={() => setMode(mode === "login" ? "register" : "login")} className="mt-4 w-full text-xs text-zinc-500 underline">{mode === "login" ? t("계정이 없으신가요? 회원가입", "No account? Register") : t("이미 계정이 있나요? 로그인", "Already have account? Login")}</button>
        </div>
      </div>
    );
  }

  // ─── Step 2: Setup (Plan Selection) ───
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[#0a0a0a] py-12 text-white">
      <div className="w-full max-w-5xl px-6">
        <div className="mb-12 text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
            {t("로그인 완료", "Login Complete")}
          </p>
          <h2 className="mt-4 text-4xl font-bold tracking-tight">
            {t("플랜을 선택하고 시작하세요", "Choose your plan and continue")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
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
                className={`rounded-[32px] border p-8 text-left transition-all duration-300 ${
                  isActive
                    ? "border-white bg-white/[0.05] shadow-[0_0_40px_rgba(255,255,255,0.08)]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/25"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
                      {plan.title}
                    </p>
                    <h3 className="mt-3 text-4xl font-semibold">{plan.price}</h3>
                    <p className="mt-4 text-sm leading-6 text-zinc-300">{plan.summary}</p>
                  </div>
                  <div
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      isActive
                        ? "border-white/60 bg-white text-black"
                        : "border-white/15 text-zinc-400"
                    }`}
                  >
                    {isActive ? t("선택됨", "Selected") : t("선택", "Select")}
                  </div>
                </div>

                <div className="mt-8 flex flex-col gap-4 text-sm text-zinc-400">
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
              <p className="mt-2 text-sm leading-6 text-zinc-400">{currentPlan.details}</p>
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
