"use client";

import React, { useState } from "react";
import { 
  XIcon, 
  FolderPlusIcon, 
  SparklesIcon,
  PlusIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProjectCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProjectCreateModal: React.FC<ProjectCreateModalProps> = ({
  isOpen,
  onClose
}) => {
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleCreate = async () => {
    if (!prompt.trim()) return;
    setIsLoading(true);
    if (typeof window !== "undefined" && (window as any).assistantAPI?.invokeTool) {
      try {
        await (window as any).assistantAPI.invokeTool("project:create", { prompt });
        onClose();
        setPrompt("");
      } catch (err) {
        console.error("Failed to create project:", err);
      } finally {
        setIsLoading(false);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300 px-4">
      <div className="relative w-full max-w-[460px] overflow-hidden rounded-2xl border border-white/10 bg-[#171717] shadow-2xl animate-in zoom-in-95 duration-300">
        <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-500" />
        
        <div className="flex flex-col p-6 pt-8">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.1)]">
              <FolderPlusIcon className="size-7" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white">새 프로젝트 생성</h2>
            <p className="mt-1.5 text-sm text-zinc-400">Jarvis가 프로젝트 환경과 기초 코드를 구성합니다.</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider ml-1">프로젝트 아이디어</label>
              <textarea
                placeholder="예: 'Python으로 구현하는 개인 가계부 앱', 'React와 Tailwind를 사용한 포트폴리오 사이트'"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full min-h-[120px] bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500/50 transition-all resize-none placeholder:text-zinc-600"
              />
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Button
                onClick={handleCreate}
                disabled={!prompt.trim() || isLoading}
                className="h-12 w-full bg-blue-600 font-semibold text-white hover:bg-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.2)] transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2 italic">
                    <SparklesIcon className="size-4 animate-spin" />
                    생성 중...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <PlusIcon className="size-4" />
                    프로젝트 시작하기
                  </span>
                )}
              </Button>
              
              <button
                onClick={onClose}
                className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors py-2"
              >
                취소
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors"
        >
          <XIcon className="size-5" />
        </button>
      </div>
    </div>
  );
};
