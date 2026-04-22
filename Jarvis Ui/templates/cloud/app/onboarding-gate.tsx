"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SparklesIcon,
  LoaderCircleIcon,
} from "lucide-react";
import {
  restoreAuthSession,
  persistAuthSession,
  type AuthUser,
} from "@/components/jarvis/auth-session";
import { Assistant } from "./assistant";

const API_BASE = "https://jarvis-backend.a01044622139.workers.dev";

type OnboardingStep = "loading" | "auth" | "ready";

export function OnboardingGate() {
  const [step, setStep] = useState<OnboardingStep>("loading");

  // Auth form state
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const isKo =
    typeof navigator !== "undefined" && navigator.language.startsWith("ko");
  const t = (ko: string, en: string) => (isKo ? ko : en);

  // Check existing session on mount
  useEffect(() => {
    void (async () => {
      const session = await restoreAuthSession();
      if (session.token && session.user) {
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
        setAuthError(data.error || t("오류가 발생했습니다.", "Something went wrong."));
        return;
      }

      // Auto-login after register
      let token = data.token;
      let user = data.user;

      if (mode === "register") {
        const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const loginData = (await loginRes.json()) as any;
        if (!loginRes.ok) {
          setAuthError(loginData.error || t("자동 로그인에 실패했습니다.", "Auto-login failed."));
          return;
        }
        token = loginData.token;
        user = loginData.user;
      }

      const nextUser: AuthUser = {
        ...user,
        name: user?.name || name.trim() || email.split("@")[0],
        settings: { autoSync: true, preferWebAi: true, language: "auto" },
      };

      await persistAuthSession(token, nextUser);

      // Sync auth token to Electron main process if available
      if (typeof window !== "undefined" && (window as any).assistantAPI?.invokeTool) {
        try {
          await (window as any).assistantAPI.invokeTool("auth:session-save", { token, user: nextUser });
        } catch {
          // Non-critical
        }
      }

      setStep("ready");
    } catch {
      setAuthError(t("네트워크 오류입니다. 연결을 확인해 주세요.", "Network error. Please check your connection."));
    } finally {
      setAuthLoading(false);
    }
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

  // ─── Auth Step (full-screen, independent UI) ───
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
              ? t("로그인하여 시작하세요", "Sign in to continue")
              : t("계정을 만들어 시작하세요", "Create an account to get started")}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleAuth} className="flex flex-col gap-3">
          {mode === "register" && (
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("이름 (선택)", "Name (optional)")}
              className="h-11 rounded-xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:ring-white/20"
            />
          )}
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("이메일", "Email")}
            required
            className="h-11 rounded-xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:ring-white/20"
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("비밀번호", "Password")}
            required
            minLength={6}
            className="h-11 rounded-xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:ring-white/20"
          />

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
              t("로그인", "Sign In")
            ) : (
              t("회원가입", "Create Account")
            )}
          </Button>
        </form>

        {/* Free plan notice */}
        <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-center text-xs text-zinc-500">
          {t(
            "✨ 무료 플랜 — Gemini 1.5 Flash · 매일 15회 제공",
            "✨ Free plan — Gemini 1.5 Flash · 15 messages per day"
          )}
        </div>

        {/* Toggle login/register */}
        <div className="mt-5 text-center">
          {mode === "login" ? (
            <p className="text-xs text-zinc-500">
              {t("계정이 없으신가요?", "No account?")}{" "}
              <button
                type="button"
                onClick={() => { setMode("register"); setAuthError(null); }}
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
                onClick={() => { setMode("login"); setAuthError(null); }}
                className="text-zinc-300 underline hover:text-white"
              >
                {t("로그인", "Sign In")}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
