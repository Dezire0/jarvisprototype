"use client";

import React, { useEffect, useState } from "react";
import { 
  XIcon, 
  SearchIcon, 
  AppWindowIcon,
  ExternalLinkIcon
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AppsLauncherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AppsLauncherModal: React.FC<AppsLauncherModalProps> = ({
  isOpen,
  onClose
}) => {
  const [apps, setApps] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (isOpen) {
      if (typeof window !== "undefined" && (window as any).assistantAPI?.invokeTool) {
        (window as any).assistantAPI.invokeTool("os:apps", {}).then((res: any) => {
          if (res?.ok) setApps(res.apps || []);
        });
      }
    }
  }, [isOpen]);

  const filteredApps = apps.filter(app => 
    app.toLowerCase().includes(search.toLowerCase())
  );

  const handleOpenApp = (appName: string) => {
    if (typeof window !== "undefined" && (window as any).assistantAPI?.invokeTool) {
      (window as any).assistantAPI.invokeTool("os:apps", { action: "open", appName });
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300 px-4">
      <div className="relative w-full max-w-[500px] overflow-hidden rounded-2xl border border-white/10 bg-[#171717] shadow-2xl animate-in zoom-in-95 duration-300">
        <div className="flex items-center justify-between border-b border-white/5 p-4">
          <h2 className="text-lg font-semibold text-white">응용 프로그램 실행</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <XIcon className="size-5" />
          </button>
        </div>

        <div className="p-4">
          <div className="relative mb-4 flex items-center group">
            <SearchIcon className="absolute left-3 size-4 text-zinc-500 group-focus-within:text-emerald-400 transition-colors" />
            <input 
              type="text"
              placeholder="앱 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl h-11 pl-10 pr-4 text-sm text-white outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all"
            />
          </div>

          <div className="grid grid-cols-1 gap-1 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 pr-2">
            {filteredApps.length > 0 ? filteredApps.map((app) => (
              <button
                key={app}
                onClick={() => handleOpenApp(app)}
                className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-white/5 text-zinc-300 hover:text-white transition-all group"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 group-hover:bg-emerald-500/20 group-hover:text-emerald-400 transition-colors">
                  <AppWindowIcon className="size-5" />
                </div>
                <span className="flex-1 text-left font-medium text-sm">{app}</span>
                <ExternalLinkIcon className="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500" />
              </button>
            )) : (
              <div className="py-10 text-center text-zinc-500 text-sm italic">
                검색 결과가 없습니다.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
