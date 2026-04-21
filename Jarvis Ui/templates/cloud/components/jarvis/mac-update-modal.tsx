"use client";

import type React from "react";
import {
  ShieldAlertIcon,
  DownloadIcon,
  ExternalLinkIcon,
  InfoIcon,
  XIcon,
  SparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MacUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  version: string;
  downloadUrl: string;
}

export const MacUpdateModal: React.FC<MacUpdateModalProps> = ({
  isOpen,
  onClose,
  version,
  downloadUrl,
}) => {
  if (!isOpen) return null;

  const handleDownload = () => {
    const target = downloadUrl || "https://dexproject.pages.dev/";
    if (
      typeof window !== "undefined" &&
      (window as any).assistantAPI?.invokeTool
    ) {
      (window as any).assistantAPI
        .invokeTool("system:open-external", { url: target })
        .catch(() => window.open(target, "_blank"));
      onClose();
      return;
    }

    window.open(target, "_blank");
    onClose();
  };

  return (
    <div className="fade-in fixed inset-0 z-[9999] flex animate-in items-center justify-center bg-black/60 backdrop-blur-sm duration-300">
      <div
        className={cn(
          "zoom-in-95 relative w-full max-w-[440px] animate-in overflow-hidden rounded-2xl border border-white/10 bg-[#171717] p-0 shadow-2xl duration-300",
          "before:absolute before:inset-0 before:-z-10 before:bg-gradient-to-br before:from-emerald-500/10 before:via-transparent before:to-transparent",
        )}
      >
        {/* Header Decor */}
        <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-500" />

        <div className="flex flex-col p-6 pt-8">
          {/* Icon & Title */}
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.1)] ring-1 ring-emerald-500/20">
              <SparklesIcon className="size-8 animate-pulse" />
            </div>
            <h2 className="font-bold text-2xl text-white tracking-tight">
              Jarvis v{version} 준비 완료
            </h2>
            <p className="mt-2 text-zinc-400">
              새로운 기능과 성능 개선이 포함되었습니다.
            </p>
          </div>

          {/* Info Box */}
          <div className="mb-6 rounded-xl border border-white/5 bg-white/5 p-4 text-left">
            <div className="flex gap-3">
              <ShieldAlertIcon className="size-5 shrink-0 text-amber-400" />
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-sm text-zinc-200">
                  macOS 보안 안내
                </span>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Apple 인증서 미등록 빌드이므로 설치 후 **"손상된 파일"**
                  오류가 뜰 수 있습니다. 그럴 땐 터미널에 아래 명령어를 입력해
                  주세요:
                </p>
                <div className="mt-2 break-all rounded border border-white/5 bg-black/40 p-2 font-mono text-[10px] text-emerald-400">
                  xattr -cr /Applications/Jarvis\ Desktop.app
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-3">
            <Button
              onClick={handleDownload}
              className="h-12 w-full bg-emerald-600 font-semibold text-white shadow-[0_0_15px_rgba(5,150,105,0.3)] transition-all hover:bg-emerald-500 active:scale-[0.98]"
            >
              <DownloadIcon className="mr-2 size-4" />v{version} 패키지 다운로드
            </Button>

            <button
              type="button"
              onClick={onClose}
              className="py-2 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
            >
              나중에 하기
            </button>
          </div>
        </div>

        {/* Footer Link */}
        <div className="border-white/5 border-t bg-white/[0.02] px-6 py-4">
          <button
            type="button"
            onClick={handleDownload}
            className="flex w-full items-center justify-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-emerald-400"
          >
            <InfoIcon className="size-3" />
            다운로드 페이지로 이동하기
            <ExternalLinkIcon className="size-3" />
          </button>
        </div>

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 transition-colors hover:text-white"
        >
          <XIcon className="size-5" />
        </button>
      </div>
    </div>
  );
};
