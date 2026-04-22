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
  KeyIcon,
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
  const [userApiKey, setUserApiKey] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);

  const isKo =
    typeof navigator !== "undefined" && navigator.language.startsWith("ko");
  const t = (ko: string, en: string) => (isKo ? ko : en);

  // Check session on mount + Auto-wipe on version change
  useEffect(() => {
    void (async () => {
      try {
        const CURRENT_VERSION = "1.5.9";
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
            await persistAuthSession(urlToken, urlUser);
            // URL 파라미터 제거 (깔끔한 UI를 위해)
            window.history.replaceState({}, document.title, window.location.pathname);
            
            const isValidPlan = urlUser.plan === "pro" || urlUser.plan === "free";
            if (isValidPlan) {
              setStep("ready");
            } else {
              setStep("setup");
            }
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
              await persistAuthSession(data.token, data.user);
              const isValidPlan = data.user.plan === "pro" || data.user.plan === "free";
              if (isValidPlan) {
                setStep("ready");
              } else {
                setStep("setup");
              }
            }
          });
        }

        const session = await restoreAuthSession();
        if (session.token && session.user) {
          const user = session.user as any;
          const isValidPlan = user.plan === "pro" || user.plan === "free";
          // hasSetup logic remains same
          const hasSetup = user.plan === "pro" || (user.plan === "free" && (user.geminiApiKeyEncrypted || user.settings?.geminiKey));
          
          if (isValidPlan && hasSetup) {
            setStep("ready");
          } else {
            if (!isValidPlan) {
              localStorage.clear();
              setStep("auth");
            } else {
              setStep("setup");
            }
          }
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
        plan: user.plan, // 서버에서 받은 플랜 정보 (없으면 undefined)
        settings: { autoSync: true, preferWebAi: true, language: "auto" },
      };

      await persistAuthSession(token, nextUser);

      // 이미 서버에 플랜이 등록된 유저라면 즉시 준비 완료, 아니면 셋업 화면으로
      if (nextUser.plan === "pro" || (nextUser.plan === "free" && user.hasGeminiKey)) {
        setStep("ready");
      } else {
        setStep("setup");
      }
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

      // 만약 무료 플랜인데 키를 안 넣었으면 경고
      if (selectedPlan === "free" && !userApiKey.trim()) {
        alert(t("무료 플랜을 사용하려면 Gemini API 키를 입력해야 합니다.", "Please enter your Gemini API key for the free plan."));
        return;
      }

      // 서버 DB에 플랜 업데이트 요청 (강력한 동기화)
      try {
        const planRes = await fetch("https://jarvis-backend.a01044622139.workers.dev/api/auth/plan", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.token}`
          },
          body: JSON.stringify({ plan: selectedPlan })
        });
        
        if (!planRes.ok) {
          const errData = await planRes.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to update plan on server");
        }
        console.log("Plan updated on server successfully:", selectedPlan);
      } catch (err: any) {
        setSetupLoading(false);
        alert(t("서버 플랜 업데이트에 실패했습니다: ", "Failed to sync plan with server: ") + err.message);
        return;
      }

      // 서버에 플랜 및 키 저장 (로컬 세션에도 저장)
      const updatedUser: AuthUser = {
        ...session.user,
        plan: selectedPlan,
        settings: {
          ...session.user.settings,
          geminiKey: selectedPlan === "free" ? userApiKey.trim() : undefined,
        }
      };

      await persistAuthSession(session.token, updatedUser);

      // Electron 메인 프로세스에 세션 동기화
      if (typeof window !== "undefined" && (window as any).assistantAPI) {
        await (window as any).assistantAPI.invokeTool("auth:session-save", { 
          token: session.token, 
          user: updatedUser 
        });
      }

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
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {t("Google 계정으로 로그인", "Sign in with Google")}
            </Button>
          </form>
          <button onClick={() => setMode(mode === "login" ? "register" : "login")} className="mt-4 w-full text-xs text-zinc-500 underline">{mode === "login" ? t("계정이 없으신가요? 회원가입", "No account? Register") : t("이미 계정이 있나요? 로그인", "Already have account? Login")}</button>
        </div>
      </div>
    );
  }

  // ─── Step 2: Setup (Plan & API Key) ───
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[#0a0a0a] py-12 text-white">
      <div className="w-full max-w-6xl px-6">
        {/* Title & Toggle */}
        <div className="mb-12 text-center">
          <h2 className="text-4xl font-bold tracking-tight">{t("플랜 업그레이드", "Upgrade Your Plan")}</h2>
          <div className="mt-6 inline-flex rounded-full bg-zinc-900 p-1">
            <button className="rounded-full bg-zinc-700 px-6 py-1.5 text-sm font-medium">{t("개인", "Personal")}</button>
            <button className="rounded-full px-6 py-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-300">{t("비즈니스", "Business")}</button>
          </div>
        </div>

        {/* 3-Column Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          
          {/* Card 1: Go (BYOK) */}
          <div 
            onClick={() => setSelectedPlan("free")}
            className={`flex flex-col rounded-[32px] border-2 p-8 transition-all duration-300 ${selectedPlan === "free" ? "border-white bg-white/[0.03]" : "border-white/5 bg-transparent hover:border-white/20"}`}
          >
            <div className="mb-6 flex flex-col gap-1">
              <h3 className="text-3xl font-bold">Go</h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-sm text-zinc-400">CAD$</span>
                <span className="text-5xl font-bold">11</span>
                <span className="text-sm text-zinc-400">/ {t("월", "mo")}</span>
              </div>
              <p className="mt-4 text-sm font-medium text-zinc-300">{t("향상된 이용 한도로 끊김 없는 대화", "Seamless conversations with enhanced limits")}</p>
            </div>

            <Button 
              variant={selectedPlan === "free" ? "default" : "outline"}
              className={`mb-8 h-12 w-full rounded-full transition-all ${selectedPlan === "free" ? "bg-white text-black" : "border-white/20 bg-transparent text-white hover:bg-white/5"}`}
            >
              {selectedPlan === "free" ? t("현재 선택됨", "Current Selection") : t("Go로 전환하기", "Switch to Go")}
            </Button>

            <div className="flex flex-col gap-4 text-sm text-zinc-400">
              <div className="flex items-center gap-3"><SparklesIcon className="size-4" /> <span>{t("코어 모델", "Core Models")}</span></div>
              <div className="flex items-center gap-3"><LoaderCircleIcon className="size-4" /> <span>{t("메시지 및 업로드 한도 증가", "Increased message & upload limits")}</span></div>
              <div className="flex items-center gap-3"><KeyIcon className="size-4" /> <span>{t("더 많은 이미지 생성", "Generate more images")}</span></div>
              <div className="flex items-center gap-3"><ShieldCheckIcon className="size-4" /> <span>{t("더 많이 기억하는 메모리", "Longer memory retention")}</span></div>
              <div className="flex items-center gap-3"><ArrowRightIcon className="size-4" /> <span>{t("확장된 음성 모드", "Extended voice mode")}</span></div>
            </div>
          </div>

          {/* Card 2: Plus (Standard Managed) */}
          <div 
            onClick={() => setSelectedPlan("pro")}
            className={`flex flex-col rounded-[32px] border-2 p-8 transition-all duration-300 ${selectedPlan === "pro" ? "border-white bg-white/[0.03]" : "border-white/5 bg-transparent hover:border-white/20"}`}
          >
            <div className="mb-6 flex flex-col gap-1">
              <h3 className="text-3xl font-bold">Plus</h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-sm text-zinc-400">CAD$</span>
                <span className="text-5xl font-bold">25</span>
                <span className="text-sm text-zinc-400">/ {t("월", "mo")}</span>
              </div>
              <p className="mt-4 text-sm font-medium text-zinc-300">{t("모든 기능을 폭넓게 이용", "Access to all features broadly")}</p>
            </div>

            <Button 
              variant={selectedPlan === "pro" ? "default" : "outline"}
              className={`mb-8 h-12 w-full rounded-full transition-all ${selectedPlan === "pro" ? "bg-white text-black" : "border-white/20 bg-transparent text-white hover:bg-white/5"}`}
            >
              {selectedPlan === "pro" ? t("현재 선택됨", "Current Selection") : t("Plus로 업그레이드", "Upgrade to Plus")}
            </Button>

            <div className="flex flex-col gap-4 text-sm text-zinc-400">
              <div className="flex items-center gap-3"><SparklesIcon className="size-4 text-white" /> <span className="text-white">{t("고급 모델", "Advanced Models")}</span></div>
              <div className="flex items-center gap-3"><LoaderCircleIcon className="size-4" /> <span>{t("더 많은 메시지와 업로드", "Even more messages & uploads")}</span></div>
              <div className="flex items-center gap-3"><KeyIcon className="size-4" /> <span>{t("더 많은 이미지를 더 빠르게 생성", "Generate more images faster")}</span></div>
              <div className="flex items-center gap-3"><ShieldCheckIcon className="size-4" /> <span>{t("더 많은 메모리로 채팅 지원", "Chat support with more memory")}</span></div>
              <div className="flex items-center gap-3"><ArrowRightIcon className="size-4" /> <span>{t("Codex 코딩 에이전트", "Codex Coding Agent")}</span></div>
              <div className="flex items-center gap-3"><CheckIcon className="size-4" /> <span>{t("확장된 심층 리서치", "Extended deep research")}</span></div>
            </div>
          </div>

          {/* Card 3: Pro (Ultra Managed) */}
          <div 
            className="flex flex-col rounded-[32px] border-2 border-indigo-500/50 bg-indigo-500/[0.02] p-8 transition-all hover:border-indigo-500"
          >
            <div className="mb-6 flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <h3 className="text-3xl font-bold text-indigo-400">Pro</h3>
                <div className="flex gap-1 rounded-full bg-zinc-800 p-1">
                  <span className="px-3 py-0.5 text-[10px] font-bold bg-zinc-700 rounded-full">5x</span>
                  <span className="px-3 py-0.5 text-[10px] font-bold text-zinc-500">20x</span>
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-sm text-zinc-400">CAD$</span>
                <span className="text-5xl font-bold">136</span>
                <span className="text-sm text-zinc-400">/ {t("월", "mo")}</span>
              </div>
              <p className="mt-4 text-sm font-medium text-zinc-300">{t("최상급 AI로 생산성 최대화", "Maximize productivity with elite AI")}</p>
            </div>

            <Button 
              className="mb-8 h-12 w-full rounded-full bg-indigo-600 text-white hover:bg-indigo-500 transition-all shadow-[0_0_20px_rgba(79,70,229,0.3)]"
            >
              {t("Pro로 업그레이드", "Upgrade to Pro")}
            </Button>

            <div className="mb-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">{t("Plus의 모든 기능, 그리고", "EVERYTHING IN PLUS, AND")}</div>
            <div className="flex flex-col gap-4 text-sm text-zinc-400">
              <div className="flex items-center gap-3"><ArrowRightIcon className="size-4 text-indigo-400" /> <span>{t("Plus보다 5배 더 많은 사용량", "5x more usage than Plus")}</span></div>
              <div className="flex items-center gap-3"><SparklesIcon className="size-4 text-indigo-400" /> <span>{t("Frontier Pro 모델", "Frontier Pro Models")}</span></div>
              <div className="flex items-center gap-3"><CheckIcon className="size-4 text-indigo-400" /> <span>{t("Codex 액세스 최대화", "Maximize Codex access")}</span></div>
              <div className="flex items-center gap-3"><ShieldCheckIcon className="size-4 text-indigo-400" /> <span>{t("최대 심층 리서치", "Maximum deep research")}</span></div>
            </div>
          </div>
        </div>

        {/* API Key Input (Bottom Section) */}
        <div className={`mt-12 overflow-hidden transition-all duration-500 ${selectedPlan === "free" ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.02] p-8 backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-3 text-lg font-semibold text-white">
              <div className="flex size-10 items-center justify-center rounded-xl bg-white/10 text-white">
                <KeyIcon className="size-5" />
              </div>
              <span>Gemini API Key</span>
            </div>
            <p className="mb-6 text-sm text-zinc-400 leading-relaxed">
              {t("개인 API 키를 사용하시면 Jarvis의 모든 기능을 무료로(BYOK) 이용하실 수 있습니다.", "Use your personal API key to access all Jarvis features for free (BYOK).")}
            </p>
            <Input 
              value={userApiKey}
              onChange={(e) => setUserApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="h-12 rounded-xl border-white/10 bg-black/40 px-4 text-white placeholder:text-zinc-600 focus:border-white/30"
            />
            <div className="mt-6 flex items-start gap-3 rounded-2xl bg-indigo-500/10 p-4 border border-indigo-500/20">
              <ShieldCheckIcon className="mt-0.5 size-4 text-indigo-400" />
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                {t("입력하신 키는 사용자의 장치에만 안전하게 저장되며, 어떠한 경우에도 외부로 유출되지 않습니다. 안심하고 사용하세요.", "Your key is stored securely on your device and will never be shared. Use with confidence.")}
              </p>
            </div>
          </div>
        </div>

        {/* Final CTA Button */}
        <div className="mt-12 flex flex-col items-center gap-4">
          <Button 
            disabled={setupLoading}
            onClick={handleSetup}
            className="h-14 w-full max-w-sm rounded-full bg-white text-lg font-bold text-black transition-all hover:scale-105 active:scale-95 disabled:opacity-50 shadow-[0_0_30px_rgba(255,255,255,0.15)]"
          >
            {setupLoading ? <LoaderCircleIcon className="animate-spin" /> : t("설정 완료하고 시작하기", "Complete Setup & Start")}
          </Button>
          <p className="text-xs text-zinc-500">
            {t("데이터는 안전하게 보호됩니다.", "Your data is protected securely.")}
          </p>
        </div>
      </div>
    </div>
  );
}
