"use client";

import React, { useEffect, useState } from "react";
import { 
  ShieldAlertIcon, 
  DownloadIcon, 
  ExternalLinkIcon, 
  InfoIcon,
  XIcon,
  SparklesIcon,
  ZapIcon
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
  downloadUrl
}) => {
  if (!isOpen) return null;

  const handleDownload = () => {
    if (typeof window !== "undefined" && (window as any).assistantAPI?.invokeTool) {
      // openBrowserTool을 호출하거나 직접 브라우저를 엽니다.
      // 여기서는 단순히 downloadUrl을 엽니다.
      window.open(downloadUrl || "https://dexproject.pages.dev/", "_blank");
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div 
        className={cn(
          "relative w-full max-w-[440px] overflow-hidden rounded-2xl border border-white/10 bg-[#171717] p-0 shadow-2xl animate-in zoom-in-95 duration-300",
          "before:absolute before:inset-0 before:-z-10 before:bg-gradient-to-br before:from-emerald-500/10 before:via-transparent before:to-transparent"
        )}
      >
        {/* Header Decor */}
        <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-500" />
        
        <div className="flex flex-col p-6 pt-8">
          {/* Icon & Title */}
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
              <SparklesIcon className="size-8 animate-pulse" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Jarvis v{version} 준비 완료
            </h2>
            <p className="mt-2 text-zinc-400">새로운 기능과 성능 개선이 포함되었습니다.</p>
          </div>

          {/* Info Box */}
          <div className="mb-8 rounded-xl border border-white/5 bg-white/5 p-4">
            <div className="flex gap-3">
              <ShieldAlertIcon className="size-5 shrink-0 text-amber-400" />
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-zinc-200">macOS 보안 안내</span>
                <p className="text-xs leading-relaxed text-zinc-400">
                  현재 Apple 개발자 인증서 미등록 빌드를 사용 중입니다. 
                  자동 업데이트 시 앱이 손상될 수 있어, **안전한 수동 업데이트** 방식을 사용합니다.
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-3">
            <Button
              onClick={handleDownload}
              className="h-12 w-full bg-emerald-600 font-semibold text-white hover:bg-emerald-500 shadow-[0_0_15px_rgba(5,150,105,0.3)] transition-all active:scale-[0.98]"
            >
              <DownloadIcon className="mr-2 size-4" />
              v{version} 패키지 다운로드
            </Button>
            
            <button
              onClick={onClose}
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors py-2"
            >
              나중에 하기
            </button>
          </div>
        </div>

        {/* Footer Link */}
        <div className="border-t border-white/5 bg-white/[0.02] px-6 py-4">
          <button 
            onClick={handleDownload}
            className="flex w-full items-center justify-center gap-1.5 text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
          >
            <InfoIcon className="size-3" />
            다운로드 페이지로 이동하기
            <ExternalLinkIcon className="size-3" />
          </button>
        </div>

        {/* Close Button */}
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
