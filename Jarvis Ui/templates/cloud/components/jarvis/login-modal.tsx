"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { XIcon, LoaderCircleIcon, SparklesIcon } from "lucide-react";
import {
  persistAuthSession,
  type AuthUser,
} from "@/components/jarvis/auth-session";

const API_BASE = "https://jarvis-auth-service.dexproject.workers.dev";
const DESKTOP_AUTH_CALLBACK_URL =
  process.env.NEXT_PUBLIC_JARVIS_AUTH_CALLBACK_URL || "";

function buildGoogleAuthUrl() {
  if (typeof window === "undefined") {
    return `${API_BASE}/api/auth/google`;
  }

  const authUrl = new URL(`${API_BASE}/api/auth/google`);
  const currentUrl = new URL(window.location.href);

  if ((window as any).assistantAPI) {
    authUrl.searchParams.set(
      "return_to",
      DESKTOP_AUTH_CALLBACK_URL || "jarvis-desktop://auth",
    );
  } else if (
    currentUrl.protocol === "http:" ||
    currentUrl.protocol === "https:"
  ) {
    authUrl.searchParams.set(
      "return_to",
      `${currentUrl.origin}${currentUrl.pathname}`,
    );
  }

  return authUrl.toString();
}

type LoginModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: (user: AuthUser, token: string) => void;
};

export function LoginModal({ open, onClose, onSuccess }: LoginModalProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleAuthCallback = async (data: any) => {
      if (!data?.token || !data?.user) return;

      const nextUser = {
        ...data.user,
        name: data.user?.name || data.user?.email?.split("@")[0],
        settings: {
          autoSync: true,
          preferWebAi: true,
          language: "auto",
          ...(data.user?.settings || {}),
        },
      } satisfies AuthUser;

      await persistAuthSession(data.token, nextUser);
      onSuccess(nextUser, data.token);
      setGoogleLoading(false);
      setError(null);
      onClose();
    };

    const removeListener = (window as any).assistantAPI?.onEvent?.(
      "auth:callback",
      handleAuthCallback,
    );

    return () => {
      removeListener?.();
    };
  }, [onClose, onSuccess]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

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
        setError(data.error || "Something went wrong");
        return;
      }

      if (mode === "register") {
        // Auto-login after register
        const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const loginData = (await loginRes.json()) as any;
        if (!loginRes.ok) {
          setError(loginData.error || "Auto-login failed");
          return;
        }
        const nextUser = {
          ...loginData.user,
          name: loginData.user?.name || name.trim() || email.split("@")[0],
          settings: {
            autoSync: true,
            preferWebAi: true,
            language: "auto",
          },
        } satisfies AuthUser;
        await persistAuthSession(loginData.token, nextUser);
        onSuccess(nextUser, loginData.token);
      } else {
        const nextUser = {
          ...data.user,
          name: data.user?.name || email.split("@")[0],
          settings: {
            autoSync: true,
            preferWebAi: true,
            language: "auto",
          },
        } satisfies AuthUser;
        await persistAuthSession(data.token, nextUser);
        onSuccess(nextUser, data.token);
      }

      setName("");
      setEmail("");
      setPassword("");
      onClose();
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  function handleGoogleLogin() {
    if (typeof window === "undefined") {
      setError("Google login is not available in this environment.");
      return;
    }

    setGoogleLoading(true);
    setError(null);
    window.location.href = buildGoogleAuthUrl();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#1a1a1a] p-7 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 transition-colors hover:text-white"
        >
          <XIcon className="size-4" />
        </button>

        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-full bg-white/10">
            <SparklesIcon className="size-5 text-white" />
          </div>
          <h2 className="font-semibold text-lg text-white">
            {mode === "login" ? "Jarvis에 로그인" : "새 계정 만들기"}
          </h2>
          <p className="text-center text-xs text-zinc-400">
            {mode === "login"
              ? "로그인하면 대화 기록이 모든 기기에 저장됩니다."
              : "계정을 만들면 클라우드에 대화가 영구 저장됩니다."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === "register" && (
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="표시 이름"
              className="h-11 rounded-xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:ring-white/20"
            />
          )}
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            required
            className="h-11 rounded-xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:ring-white/20"
          />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            required
            minLength={6}
            className="h-11 rounded-xl border-white/10 bg-white/5 text-white placeholder:text-zinc-500 focus-visible:ring-white/20"
          />

          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400 text-xs">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loading || googleLoading}
            className="mt-1 h-11 w-full rounded-xl bg-white font-medium text-black transition-colors hover:bg-zinc-200"
          >
            {loading ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : mode === "login" ? (
              "로그인"
            ) : (
              "회원가입"
            )}
          </Button>

          {mode === "login" && (
            <>
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase">
                  <span className="bg-[#1a1a1a] px-2 text-zinc-500">또는</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                disabled={loading || googleLoading}
                onClick={handleGoogleLogin}
                className="h-11 w-full rounded-xl border-white/10 bg-white/5 font-medium text-white transition-colors hover:bg-white/10"
              >
                {googleLoading ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : (
                  <>
                    <svg
                      aria-hidden="true"
                      className="mr-2 size-4"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1 .67-2.28 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.67-.35-1.39-.35-2.09s.13-1.42.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    Google로 로그인
                  </>
                )}
              </Button>
            </>
          )}
        </form>

        <p className="mt-4 text-center text-xs text-zinc-500">
          {mode === "login" ? (
            <>
              계정이 없으신가요?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("register");
                  setError(null);
                }}
                className="text-zinc-300 underline hover:text-white"
              >
                회원가입
              </button>
            </>
          ) : (
            <>
              이미 계정이 있으신가요?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
                className="text-zinc-300 underline hover:text-white"
              >
                로그인
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
