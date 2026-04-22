"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SparklesIcon,
  LoaderCircleIcon,
  KeyIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
} from "lucide-react";
import {
  restoreAuthSession,
  persistAuthSession,
  type AuthUser,
} from "@/components/jarvis/auth-session";
import { Assistant } from "./assistant";

const API_BASE = "https://jarvis-backend.a01044622139.workers.dev";

type OnboardingStep = "loading" | "auth" | "api-key" | "ready";

export function OnboardingGate() {
  const [step, setStep] = useState<OnboardingStep>("loading");
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  // Auth form state
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // API key form state
  const [apiKey, setApiKey] = useState("");
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  const isKo = typeof navigator !== "undefined" && navigator.language.startsWith("ko");
  const t = (ko: string, en: string) => (isKo ? ko : en);

  // Check existing session on mount
  useEffect(() => {
    void (async () => {
      const session = await restoreAuthSession();
      if (session.token && session.user) {
        setAuthToken(session.token);
        setAuthUser(session.user);
        setStep("ready");
      } else {
        setStep("auth");
      }
    })();
  }, []);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    const endpoint =
      mode === "login" ? "/api/auth/login" : "/api/auth/register";

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: name.trim() || undefined,
        }),
      });

      const data = (await res.json()) as any;

      if (!res.ok) {
        setAuthError(data.error || "Something went wrong");
        return;
      }

      // If register, auto-login
      let token = data.token;
      let user = data.user;
      let hasGeminiKey = data.hasGeminiKey;

      if (mode === "register") {
        const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const loginData = (await loginRes.json()) as any;
        if (!loginRes.ok) {
          setAuthError(loginData.error || "Auto-login failed");
          return;
        }
        token = loginData.token;
        user = loginData.user;
        hasGeminiKey = loginData.hasGeminiKey;
      }

      const nextUser: AuthUser = {
        ...user,
        name: user?.name || name.trim() || email.split("@")[0],
        settings: { autoSync: true, preferWebAi: true },
      };

      await persistAuthSession(token, nextUser);
      setAuthToken(token);
      setAuthUser(nextUser);

      // If user already has Gemini key saved, fetch it and sync to Electron
      if (hasGeminiKey) {
        try {
          const settingsRes = await fetch(`${API_BASE}/api/settings/gemini-key`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const settingsData = await settingsRes.json();
          if (settingsRes.ok && settingsData.key) {
            if (typeof window !== "undefined" && (window as any).electron?.invoke) {
              await (window as any).electron.invoke("assistant:save-gemini-key", {
                key: settingsData.key,
              });
            }
          }
        } catch (err) {
          console.error("Failed to sync remote key:", err);
        }
        setStep("ready");
      } else {
        setStep("api-key");
      }
    } catch {
      setAuthError(t("네트워크 오류입니다. 연결을 확인해 주세요.", "Network error. Please check your connection."));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSaveApiKey() {
    if (!apiKey.trim() || !authToken) return;
    setApiKeyLoading(true);
    setApiKeyError(null);

    try {
      const res = await fetch(`${API_BASE}/api/settings/gemini-key`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ key: apiKey.trim() }),
      });

      const data = (await res.json()) as any;

      if (!res.ok) {
        setApiKeyError(data.error || t("저장에 실패했습니다.", "Failed to save key."));
        return;
      }

      // Also save to local Electron SettingsStore if available
      if (typeof window !== "undefined" && (window as any).electron?.invoke) {
        try {
          await (window as any).electron.invoke("assistant:save-gemini-key", {
            key: apiKey.trim(),
          });
        } catch {
          // Non-critical: Electron not available (web-only mode)
        }
      }

      setStep("ready");
    } catch {
      setApiKeyError(t("네트워크 오류입니다.", "Network error."));
    } finally {
      setApiKeyLoading(false);
    }
  }

  function handleSkipApiKey() {
    setStep("ready");
  }

  // ─── Loading ───
  if (step === "loading") {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[#0a0a0a]">
        <LoaderCircleIcon className="size-6 animate-spin text-white/40" />
      </div>
    );
  }

  // ─── Ready → Show the actual Assistant ───
  if (step === "ready") {
    return <Assistant />;
  }

  // ─── Auth Step ───
  if (step === "auth") {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[#0a0a0a]">
        <div className="w-full max-w-sm px-6">
          {/* Logo + Title */}
          <div className="mb-8 flex flex-col items-center gap-3">
            <div className="flex size-14 items-center justify-center rounded-[22px] border border-white/10 bg-white/5 shadow-[0_12px_50px_rgba(255,255,255,0.06)]">
              <SparklesIcon className="size-6 text-white" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Jarvis
            </h1>
            <p className="text-center text-sm text-zinc-400">
              {mode === "login"
                ? t("로그인하여 시작하세요", "Login to continue")
                : t("계정을 만들어 시작하세요", "Create an account")}
            </p>
          </div>

          <form onSubmit={handleAuth} className="flex flex-col gap-3">
            {mode === "register" && (
              <div className="space-y-1">
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("이름 (선택)", "Name (Optional)")}
                  className="h-11 rounded-xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:ring-white/20"
                />
              </div>
            )}
            <div className="space-y-1">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("이메일", "Email")}
                required
                className="h-11 rounded-xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:ring-white/20"
              />
            </div>
            <div className="space-y-1">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("비밀번호", "Password")}
                required
                minLength={6}
                className="h-11 rounded-xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:ring-white/20"
              />
            </div>

            {authError && (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {authError}
              </p>
            )}

            <Button
              type="submit"
              disabled={authLoading}
              className="mt-1 h-11 w-full rounded-xl bg-white font-medium text-black transition-colors hover:bg-zinc-200"
            >
              {authLoading ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : mode === "login" ? (
                t("로그인", "Login")
              ) : (
                t("회원가입", "Sign Up")
              )}
            </Button>
          </form>

          <div className="mt-5 text-center">
            {mode === "login" ? (
              <p className="text-xs text-zinc-500">
                {t("계정이 없으신가요?", "No account?")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setAuthError(null);
                  }}
                  className="text-zinc-300 underline hover:text-white"
                >
                  {t("회원가입", "Sign Up")}
                </button>
              </p>
            ) : (
              <p className="text-xs text-zinc-500">
                {t("이미 계정이 있으신가요?", "Already have an account?")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setAuthError(null);
                  }}
                  className="text-zinc-300 underline hover:text-white"
                >
                  {t("로그인", "Login")}
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── API Key Step ───
  if (step === "api-key") {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[#0a0a0a]">
        <div className="w-full max-w-md px-6">
          {/* Header */}
          <div className="mb-8 flex flex-col items-center gap-3">
            <div className="flex size-14 items-center justify-center rounded-[22px] border border-white/10 bg-gradient-to-br from-blue-500/20 to-purple-500/20 shadow-[0_12px_50px_rgba(100,100,255,0.08)]">
              <KeyIcon className="size-6 text-white" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {t("초고속 모드 설정", "High-Speed Mode")}
            </h1>
            <p className="max-w-xs text-center text-sm text-zinc-400">
              {t("Gemini API 키를 입력하면 응답 속도가 10배 이상 빨라집니다.", "Enter Gemini API key for 10x faster responses.")}
            </p>
          </div>

          {/* Key input */}
          <div className="flex flex-col gap-3">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t("Gemini API 키를 입력하세요", "Paste your Gemini API key")}
              className="h-11 w-full rounded-xl border-white/10 bg-white/5 text-sm text-white placeholder:text-zinc-500 focus-visible:ring-white/20"
            />

            <div className="mt-1 text-center">
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 underline hover:text-blue-300"
              >
                {t("→ Google AI Studio에서 무료 키 발급받기", "→ Get Free API Key from Google AI Studio")}
              </a>
            </div>

            {apiKeyError && (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {apiKeyError}
              </p>
            )}

            <Button
              onClick={handleSaveApiKey}
              disabled={apiKeyLoading || !apiKey.trim()}
              className="h-11 w-full rounded-xl bg-white font-medium text-black transition-colors hover:bg-zinc-200"
            >
              {apiKeyLoading ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle2Icon className="mr-2 size-4" />
                  {t("저장하고 시작하기", "Save & Start")}
                </>
              )}
            </Button>

            <button
              type="button"
              onClick={handleSkipApiKey}
              className="flex items-center justify-center gap-1.5 py-2 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
            >
              {t("나중에 설정하기 (느린 모드)", "Skip for now (Slow Mode)")}
              <ArrowRightIcon className="size-3.5" />
            </button>
          </div>

          <div className="mt-6 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center text-xs text-zinc-500">
            <p>{t("API 키는 서버에 암호화되어 안전하게 보관됩니다.", "API keys are encrypted and stored safely.")}</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
