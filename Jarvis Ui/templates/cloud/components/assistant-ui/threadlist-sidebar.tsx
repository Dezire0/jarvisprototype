"use client";

import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useJarvisExtensions } from "@/components/jarvis/extensions-provider";
import { useJarvisVoice } from "@/components/jarvis/voice-provider";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  EditIcon,
  SearchIcon,
  BrainCircuitIcon,
  MoreHorizontalIcon,
  FolderPlusIcon,
  FileTextIcon,
  FolderIcon,
} from "lucide-react";

type SidebarProject = {
  id: string;
  name: string;
  createdAt: number;
};

type StoredThreadMeta = {
  createdAt: number;
  updatedAt: number;
  projectId: string | null;
};

const SIDEBAR_STORAGE_KEY = "jarvis-sidebar-layout-v2";

function readSidebarState() {
  if (typeof window === "undefined") {
    return { projects: [], threadMetaById: {}, selectedProjectId: null };
  }
  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) return { projects: [], threadMetaById: {}, selectedProjectId: null };
    const parsed = JSON.parse(raw);
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      threadMetaById: parsed.threadMetaById || {},
      selectedProjectId: parsed.selectedProjectId || null,
    };
  } catch {
    return { projects: [], threadMetaById: {}, selectedProjectId: null };
  }
}

export function ThreadListSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const aui = useAui();
  const threadsState = useAuiState((state) => state.threads);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [projects, setProjects] = useState<SidebarProject[]>([]);
  const [threadMetaById, setThreadMetaById] = useState<Record<string, StoredThreadMeta>>({});
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const allThreads = threadsState.threadItems.filter(
    (item) => item.status === "regular",
  );

  useEffect(() => {
    const stored = readSidebarState();
    setProjects(stored.projects);
    setThreadMetaById(stored.threadMetaById);
  }, []);

  function startNewChat() {
    void aui.threads().switchToNewThread();
  }

  function switchToThread(threadId: string) {
    void aui.threads().switchToThread(threadId);
  }

  // Dummy projects to match the user's screenshot exactly
  const dummyProjects = [
    { name: "History", icon: <FileTextIcon className="size-4 text-muted-foreground" /> },
    { name: "Civics", icon: <FileTextIcon className="size-4 text-muted-foreground" /> },
    { name: "The Book Thief", icon: <FileTextIcon className="size-4 text-blue-500" /> },
    { name: "Spanish", icon: <FileTextIcon className="size-4 text-muted-foreground" /> },
    { name: "Jarvis", icon: <FolderIcon className="size-4 text-muted-foreground" /> },
  ];

  const recentChats = allThreads.slice(0, 6); // Just grab recent ones
  // Or match the screenshot text if they want exact visual clone
  const screenshotChats = [
    { title: "무슨 상황", id: "1" },
    { title: "CMD에서 iwr 실행 오류", id: "2", hasDot: true },
    { title: "무료 플러스 1개월 여부", id: "3" },
    { title: "서버 과부하 해결법", id: "4", active: true },
    { title: "사기 피싱 경고", id: "5" },
    { title: "비용 절감 전략", id: "6" },
  ];

  const displayChats = recentChats.length > 0 ? recentChats.map(t => ({ title: t.title || "새 채팅", id: t.id })) : screenshotChats;

  return (
    <Sidebar
      {...props}
      className="border-r-0 bg-[#171717] text-[#ececec] [--sidebar-width:260px]"
    >
      <SidebarHeader className="border-none px-3 pt-3 pb-0">
        <div className="flex flex-col gap-0.5">
          <Button
            variant="ghost"
            onClick={startNewChat}
            className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 hover:bg-[#212121] transition-colors"
          >
            <EditIcon className="size-4.5" />
            <span className="text-[15px] font-medium">새 채팅</span>
          </Button>

          <Button
            variant="ghost"
            className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 hover:bg-[#212121] transition-colors text-muted-foreground hover:text-[#ececec]"
          >
            <SearchIcon className="size-4.5" />
            <span className="text-[15px] font-medium text-[#ececec]">채팅 검색</span>
          </Button>

          <Button
            variant="ghost"
            className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 hover:bg-[#212121] transition-colors"
          >
            <BrainCircuitIcon className="size-4.5" />
            <span className="text-[15px] font-medium">Codex</span>
          </Button>

          <Button
            variant="ghost"
            className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 hover:bg-[#212121] transition-colors"
          >
            <MoreHorizontalIcon className="size-4.5" />
            <span className="text-[15px] font-medium">더 보기</span>
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3 py-2 scrollbar-none">
        <div className="mt-4 mb-1 px-3">
          <p className="text-xs font-semibold text-muted-foreground/80">프로젝트</p>
        </div>
        
        <div className="flex flex-col gap-0.5">
          <Button
            variant="ghost"
            className="flex items-center justify-start gap-3 rounded-lg px-3 py-5 hover:bg-[#212121] transition-colors"
          >
            <FolderPlusIcon className="size-4.5" />
            <span className="text-sm font-medium">새 프로젝트</span>
          </Button>

          {dummyProjects.map((p, idx) => (
            <Button
              key={idx}
              variant="ghost"
              className="flex items-center justify-start gap-3 rounded-lg px-3 py-5 hover:bg-[#212121] transition-colors"
            >
              {p.icon}
              <span className="text-sm font-medium">{p.name}</span>
            </Button>
          ))}

          <Button
            variant="ghost"
            className="flex items-center justify-start gap-3 rounded-lg px-3 py-5 hover:bg-[#212121] transition-colors"
          >
            <MoreHorizontalIcon className="size-4.5" />
            <span className="text-sm font-medium">더 보기</span>
          </Button>
        </div>

        <div className="mt-6 mb-1 px-3">
          <p className="text-xs font-semibold text-muted-foreground/80">최근</p>
        </div>

        <div className="flex flex-col gap-0.5">
          {displayChats.map((chat) => (
            <Button
              key={chat.id}
              variant="ghost"
              onClick={() => switchToThread(chat.id)}
              className={cn(
                "group relative flex items-center justify-start gap-3 rounded-lg px-3 py-5 transition-colors overflow-hidden",
                (chat as any).active ? "bg-[#2f2f2f] text-white" : "hover:bg-[#212121]"
              )}
            >
              <span className="text-sm font-medium truncate flex-1 text-left">{chat.title}</span>
              {(chat as any).hasDot && (
                <div className="size-1.5 rounded-full bg-blue-500 absolute right-3"></div>
              )}
            </Button>
          ))}
        </div>
      </SidebarContent>

      <SidebarFooter className="border-none px-3 pb-3 pt-2">
        <Button
          variant="ghost"
          className="flex items-center justify-start gap-3 rounded-xl px-2 py-6 hover:bg-[#212121] transition-colors w-full"
        >
          <div className="flex size-8 items-center justify-center rounded-full bg-zinc-800 overflow-hidden shrink-0">
             <img src="/logo.png" alt="Profile" width={32} height={32} className="object-cover" />
          </div>
          <div className="flex flex-col items-start overflow-hidden text-left">
            <span className="text-sm font-medium text-white truncate">Dezire</span>
            <span className="text-xs text-muted-foreground truncate">Plus</span>
          </div>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
