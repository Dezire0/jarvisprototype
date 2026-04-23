"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { XIcon, LoaderCircleIcon, SparklesIcon } from "lucide-react";
import {
  persistAuthSession,
  type AuthUser,
} from "@/components/jarvis/auth-session";

const API_BASE = "https://jarvis-auth-service.dexproject.workers.dev";

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
  const [error, setError] = useState<string | null>(null);

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
            disabled={loading}
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
