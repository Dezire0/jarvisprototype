"use client";

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

const API_BASE = "https://jarvis-backend.a01044622139.workers.dev";

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
      const CURRENT_VERSION = "1.5.3";
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

      try {
        const session = await restoreAuthSession();
        if (session.token && session.user) {
          const user = session.user as any;
          const isValidPlan = user.plan === "pro" || user.plan === "free";
          const hasSetup = user.plan === "pro" || (user.plan === "free" && user.settings?.geminiKey);
          
          if (isValidPlan && hasSetup) {
            setStep("ready");
          } else {
            // 데이터가 꼬여있으면(구버전) 아예 세션 초기화 후 재인증 유도
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
        console.error("Critical error during session restoration:", err);
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
    <div className="flex h-dvh w-full items-center justify-center bg-[#0a0a0a] text-white">
      <div className="w-full max-w-lg px-8">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight">{t("플랜 선택 및 설정", "Select Plan & Setup")}</h2>
          <p className="mt-2 text-zinc-400">{t("Jarvis를 어떻게 사용하실지 선택해 주세요.", "Choose how you want to use Jarvis.")}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Free Plan Card */}
          <div 
            onClick={() => setSelectedPlan("free")}
            className={`cursor-pointer rounded-2xl border-2 p-5 transition-all ${selectedPlan === "free" ? "border-white bg-white/5" : "border-white/10 bg-transparent hover:border-white/30"}`}
          >
            <div className="mb-3 flex justify-between">
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">{t("무료", "FREE")}</span>
              {selectedPlan === "free" && <CheckIcon className="size-5 text-white" />}
            </div>
            <h3 className="text-xl font-bold">{t("개인 계정", "BYOK Mode")}</h3>
            <p className="mt-2 text-xs text-zinc-400">{t("본인의 Gemini API 키를 사용하여 무료로 이용합니다.", "Use your own Gemini API key for free.")}</p>
          </div>

          {/* Pro Plan Card */}
          <div 
            onClick={() => setSelectedPlan("pro")}
            className={`cursor-pointer rounded-2xl border-2 p-5 transition-all ${selectedPlan === "pro" ? "border-white bg-white/5" : "border-white/10 bg-transparent hover:border-white/30"}`}
          >
            <div className="mb-3 flex justify-between">
              <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">{t("프로", "PRO")}</span>
              {selectedPlan === "pro" && <CheckIcon className="size-5 text-white" />}
            </div>
            <h3 className="text-xl font-bold">{t("중앙 집중형", "Managed AI")}</h3>
            <p className="mt-2 text-xs text-zinc-400">{t("키 입력 없이 최고 속도의 AI를 경험하세요. (월 $1 예정)", "High-speed AI without keys. ($1/mo planned)")}</p>
          </div>
        </div>

        {/* API Key Input (only for Free Plan) */}
        <div className={`mt-8 overflow-hidden transition-all duration-300 ${selectedPlan === "free" ? "max-h-40 opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-300">
              <KeyIcon className="size-4" />
              <span>Gemini API Key</span>
            </div>
            <Input 
              value={userApiKey}
              onChange={(e) => setUserApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="h-10 rounded-lg bg-black/50 text-white placeholder:text-zinc-600"
            />
            <p className="mt-2 text-[10px] text-zinc-500">
              {t("* 키는 본인의 장치와 백엔드에 안전하게 암호화되어 저장됩니다.", "* Your key is encrypted and stored securely.")}
            </p>
          </div>
        </div>

        <Button 
          onClick={handleSetup}
          disabled={setupLoading}
          className="mt-8 h-14 w-full rounded-2xl bg-white text-lg font-bold text-black transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          {setupLoading ? <LoaderCircleIcon className="animate-spin" /> : t("Jarvis 시작하기", "Get Started with Jarvis")}
          <ArrowRightIcon className="ml-2 size-5" />
        </Button>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-zinc-500">
          <ShieldCheckIcon className="size-4" />
          <span>{t("데이터는 안전하게 보호됩니다.", "Your data is protected and secure.")}</span>
        </div>
      </div>
    </div>
  );
}
