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
import { LoginModal } from "@/components/jarvis/login-modal";
import {
  EditIcon,
  SearchIcon,
  BrainCircuitIcon,
  MoreHorizontalIcon,
  FolderPlusIcon,
  FileTextIcon,
  FolderIcon,
  LogOutIcon,
} from "lucide-react";

const API_BASE = "https://jarvis-backend.a01044622139.workers.dev";

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

type AuthUser = {
  id: string;
  email: string;
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
  const [loginOpen, setLoginOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [cloudThreads, setCloudThreads] = useState<any[]>([]);

  const allThreads = threadsState.threadItems.filter(
    (item) => item.status === "regular",
  );

  useEffect(() => {
    const stored = readSidebarState();
    setProjects(stored.projects);
    setThreadMetaById(stored.threadMetaById);

    // Restore session from localStorage
    const token = localStorage.getItem("jarvis_auth_token");
    const savedUser = localStorage.getItem("jarvis_auth_user");
    if (token && savedUser) {
      try {
        setAuthUser(JSON.parse(savedUser));
        fetchCloudThreads(token);
      } catch {
        // ignore parse error
      }
    }
  }, []);

  async function fetchCloudThreads(token: string) {
    try {
      const res = await fetch(`${API_BASE}/api/chat/threads`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as any;
      if (data.success) setCloudThreads(data.threads);
    } catch {
      // silently fail
    }
  }

  function handleLoginSuccess(user: AuthUser, token: string) {
    setAuthUser(user);
    localStorage.setItem("jarvis_auth_user", JSON.stringify(user));
    fetchCloudThreads(token);
  }

  function handleLogout() {
    setAuthUser(null);
    setCloudThreads([]);
    localStorage.removeItem("jarvis_auth_token");
    localStorage.removeItem("jarvis_auth_user");
  }

  function startNewChat() {
    void aui.threads().switchToNewThread();
  }

  function switchToThread(threadId: string) {
    void aui.threads().switchToThread(threadId);
  }

  const dummyProjects = [
    { name: "History", icon: <FileTextIcon className="size-4 text-muted-foreground" /> },
    { name: "Civics", icon: <FileTextIcon className="size-4 text-muted-foreground" /> },
    { name: "The Book Thief", icon: <FileTextIcon className="size-4 text-blue-500" /> },
    { name: "Spanish", icon: <FileTextIcon className="size-4 text-muted-foreground" /> },
    { name: "Jarvis", icon: <FolderIcon className="size-4 text-muted-foreground" /> },
  ];

  const displayChats = allThreads.length > 0
    ? allThreads.slice(0, 8).map(t => ({ title: t.title || "새 채팅", id: t.id, active: t.id === threadsState.mainThreadId }))
    : [];

  const userDisplayName = authUser
    ? authUser.email.split("@")[0]
    : "Dezire";

  const userSubLabel = authUser ? "로그인됨 ✓" : "Plus";

  return (
    <>
      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={handleLoginSuccess}
      />

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
              className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 hover:bg-[#212121] transition-colors"
            >
              <SearchIcon className="size-4.5" />
              <span className="text-[15px] font-medium">채팅 검색</span>
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
            {displayChats.length > 0 ? displayChats.map((chat) => (
              <Button
                key={chat.id}
                variant="ghost"
                onClick={() => switchToThread(chat.id)}
                className={cn(
                  "group relative flex items-center justify-start rounded-lg px-3 py-5 transition-colors overflow-hidden",
                  chat.active ? "bg-[#2f2f2f] text-white" : "hover:bg-[#212121]"
                )}
              >
                <span className="text-sm font-medium truncate flex-1 text-left">{chat.title}</span>
              </Button>
            )) : (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {authUser ? "클라우드에서 동기화됨" : "새 채팅을 시작하세요"}
              </p>
            )}
          </div>
        </SidebarContent>

        <SidebarFooter className="border-none px-3 pb-3 pt-2">
          <Button
            variant="ghost"
            onClick={() => authUser ? handleLogout() : setLoginOpen(true)}
            className="flex items-center justify-start gap-3 rounded-xl px-2 py-6 hover:bg-[#212121] transition-colors w-full group"
          >
            <div className="flex size-8 items-center justify-center rounded-full bg-zinc-700 overflow-hidden shrink-0 text-white text-sm font-bold">
              {userDisplayName.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col items-start overflow-hidden text-left flex-1">
              <span className="text-sm font-medium text-white truncate">{userDisplayName}</span>
              <span className={cn("text-xs truncate", authUser ? "text-emerald-400" : "text-muted-foreground")}>
                {userSubLabel}
              </span>
            </div>
            {authUser && (
              <LogOutIcon className="size-3.5 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            )}
          </Button>
        </SidebarFooter>
      </Sidebar>
    </>
  );
}
