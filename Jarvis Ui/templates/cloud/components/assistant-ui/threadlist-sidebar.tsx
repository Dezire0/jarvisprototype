"use client";

import type * as React from "react";
import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LoginModal } from "@/components/jarvis/login-modal";
import { MacUpdateModal } from "@/components/jarvis/mac-update-modal";
import {
  clearAuthSession,
  persistAuthSession,
  restoreAuthSession,
  updateStoredAuthUser,
  type AuthUser,
} from "@/components/jarvis/auth-session";
import {
  EditIcon,
  SearchIcon,
  MoreHorizontalIcon,
  FolderPlusIcon,
  FolderIcon,
  LogOutIcon,
  Link2Icon,
  Link2OffIcon,
  SparklesIcon,
  ShieldAlertIcon,
  RocketIcon,
  MonitorIcon,
  BadgeCheckIcon,
  UserRoundIcon,
  RefreshCwIcon,
} from "lucide-react";

const API_BASE = "https://jarvis-backend.a01044622139.workers.dev";
const SIDEBAR_STORAGE_KEY = "jarvis-sidebar-layout-v3";
const LOCAL_INDEX_STORAGE_KEY = "jarvis-thread-search-index-v1";
const PINNED_APP_NAMES = [
  "Google Chrome",
  "Visual Studio Code",
  "Cursor",
  "iTerm2",
  "Terminal",
  "Slack",
  "Notion",
  "Finder",
];

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

type StoredSidebarState = {
  projects: SidebarProject[];
  threadMetaById: Record<string, StoredThreadMeta>;
  selectedProjectId: string | null;
};

type LocalThreadSnapshot = {
  threadId: string;
  title: string;
  text: string;
  snippet: string;
  updatedAt: number;
};

type CloudThread = {
  id: string;
  title?: string | null;
  createdAt?: string | number;
};

type CloudSearchEntry = {
  threadId: string;
  title: string;
  text: string;
  snippet: string;
  updatedAt: number;
};

type LauncherApp = {
  name: string;
  path: string;
};

function readSidebarState(): StoredSidebarState {
  if (typeof window === "undefined") {
    return { projects: [], threadMetaById: {}, selectedProjectId: null };
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) {
      return { projects: [], threadMetaById: {}, selectedProjectId: null };
    }

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

function readLocalThreadIndex(): Record<string, LocalThreadSnapshot> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_INDEX_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function extractMessageText(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value.map(extractMessageText).filter(Boolean).join(" ").trim();
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text.trim();
    }
    if ("content" in record) {
      return extractMessageText(record.content);
    }
    if ("parts" in record) {
      return extractMessageText(record.parts);
    }
  }

  return "";
}

function buildSnippet(text: string, maxLength = 120) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "아직 저장된 메시지가 없어요.";
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trim()}...`
    : normalized;
}

function scoreSearch(query: string, haystack: string, title: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  const full = `${title} ${haystack}`.toLowerCase();
  if (!full.includes(normalizedQuery)) return 0;

  let score = 10;
  if (title.toLowerCase().includes(normalizedQuery)) {
    score += 20;
  }
  if (full.startsWith(normalizedQuery)) {
    score += 8;
  }
  score += Math.max(0, 12 - full.indexOf(normalizedQuery));

  return score;
}

export function ThreadListSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const aui = useAui();
  const threadsState = useAuiState((state) => state.threads);
  const activeThreadMessages = useAuiState((state) => state.thread.messages);

  const [projects, setProjects] = useState<SidebarProject[]>([]);
  const [threadMetaById, setThreadMetaById] = useState<
    Record<string, StoredThreadMeta>
  >({});
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [localThreadIndex, setLocalThreadIndex] = useState<
    Record<string, LocalThreadSnapshot>
  >({});
  const [loginOpen, setLoginOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [cloudThreads, setCloudThreads] = useState<CloudThread[]>([]);
  const [cloudSearchIndex, setCloudSearchIndex] = useState<
    Record<string, CloudSearchEntry>
  >({});
  const [webAiStatus, setWebAiStatus] = useState<
    "connected" | "disconnected" | "checking" | "expired"
  >("checking");
  const [webAiProvider, setWebAiProvider] = useState<string | null>(null);
  const [webAiReason, setWebAiReason] = useState<string | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [webAiModalOpen, setWebAiModalOpen] = useState(false);
  const [newVersion, setNewVersion] = useState("");
  const [downloadUrl, setDownloadUrl] = useState(
    "https://dexproject.pages.dev/",
  );
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [launcherQuery, setLauncherQuery] = useState("");
  const [launcherApps, setLauncherApps] = useState<LauncherApp[]>([]);
  const [launcherLoading, setLauncherLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState("");
  const [profileAutoSync, setProfileAutoSync] = useState(true);
  const [profilePreferWebAi, setProfilePreferWebAi] = useState(true);
  const profileNameInputId = useId();

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const allThreads = threadsState.threadItems.filter(
    (item) => item.status === "regular",
  );
  const activeThread =
    allThreads.find((thread) => thread.id === threadsState.mainThreadId) ||
    null;
  const activeThreadId = activeThread?.id || null;
  const activeThreadTitle = activeThread?.title || "새 채팅";
  const activeThreadText = useMemo(
    () =>
      activeThreadMessages
        .map((message) => extractMessageText(message))
        .filter(Boolean)
        .join(" ")
        .trim(),
    [activeThreadMessages],
  );

  useEffect(() => {
    const stored = readSidebarState();
    setProjects(stored.projects);
    setThreadMetaById(stored.threadMetaById);
    setSelectedProjectId(stored.selectedProjectId);
    setLocalThreadIndex(readLocalThreadIndex());

    void (async () => {
      const session = await restoreAuthSession();
      if (session.user) {
        setAuthUser(session.user);
        setProfileDraftName(
          session.user.name || session.user.email.split("@")[0] || "",
        );
        setProfileAutoSync(session.user.settings?.autoSync ?? true);
        setProfilePreferWebAi(session.user.settings?.preferWebAi ?? true);
      }
      if (session.token) {
        void hydrateCloudIndex(session.token);
      }
    })();

    void checkWebAiStatus(true);
    const interval = window.setInterval(() => {
      void checkWebAiStatus(false);
    }, 15000);

    let unsubscribeUpdate: (() => void) | undefined;
    if (typeof window !== "undefined" && window.assistantAPI?.onUpdateStatus) {
      unsubscribeUpdate = window.assistantAPI.onUpdateStatus((status: any) => {
        if (
          status?.state === "available" &&
          (status.mode === "installer" || status.mode === "disabled")
        ) {
          setNewVersion(status.availableVersion || "");
          // 항상 공식 설치 페이지로 유도
          setDownloadUrl("https://dexproject.pages.dev/");
          setUpdateModalOpen(true);
        }
      }) as (() => void) | undefined;
    }

    return () => {
      window.clearInterval(interval);
      unsubscribeUpdate?.();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({
        projects,
        threadMetaById,
        selectedProjectId,
      } satisfies StoredSidebarState),
    );
  }, [projects, selectedProjectId, threadMetaById]);

  useEffect(() => {
    if (!activeThreadId || typeof window === "undefined") {
      return;
    }

    const now = Date.now();
    const nextSnapshot: LocalThreadSnapshot = {
      threadId: activeThreadId,
      title: activeThreadTitle,
      text: activeThreadText,
      snippet: buildSnippet(activeThreadText),
      updatedAt: now,
    };

    setLocalThreadIndex((prev) => {
      const current = prev[activeThreadId];
      if (
        current &&
        current.title === nextSnapshot.title &&
        current.text === nextSnapshot.text &&
        current.snippet === nextSnapshot.snippet
      ) {
        return prev;
      }

      const next = {
        ...prev,
        [activeThreadId]: nextSnapshot,
      };
      window.localStorage.setItem(
        LOCAL_INDEX_STORAGE_KEY,
        JSON.stringify(next),
      );
      return next;
    });

    setThreadMetaById((prev) => {
      const current = prev[activeThreadId];
      const nextMeta: StoredThreadMeta = {
        createdAt: current?.createdAt || now,
        updatedAt: now,
        projectId: current?.projectId ?? selectedProjectId ?? null,
      };

      if (
        current &&
        current.createdAt === nextMeta.createdAt &&
        current.updatedAt === nextMeta.updatedAt &&
        current.projectId === nextMeta.projectId
      ) {
        return prev;
      }

      return {
        ...prev,
        [activeThreadId]: nextMeta,
      };
    });
  }, [activeThreadId, activeThreadText, activeThreadTitle, selectedProjectId]);

  const displayThreads = useMemo(() => {
    const filtered = selectedProjectId
      ? allThreads.filter(
          (thread) =>
            threadMetaById[thread.id]?.projectId === selectedProjectId,
        )
      : allThreads;

    return filtered
      .slice()
      .sort((left, right) => {
        const leftUpdated = threadMetaById[left.id]?.updatedAt || 0;
        const rightUpdated = threadMetaById[right.id]?.updatedAt || 0;
        return rightUpdated - leftUpdated;
      })
      .slice(0, 12);
  }, [allThreads, selectedProjectId, threadMetaById]);

  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) || null;
  const launcherQuickApps = useMemo(() => {
    const query = launcherQuery.trim().toLowerCase();
    const filtered = launcherApps.filter((app) => {
      if (!query) return true;
      return `${app.name} ${app.path}`.toLowerCase().includes(query);
    });

    return filtered
      .slice()
      .sort((left, right) => {
        const leftPinned = PINNED_APP_NAMES.indexOf(left.name);
        const rightPinned = PINNED_APP_NAMES.indexOf(right.name);
        const leftScore = leftPinned === -1 ? 999 : leftPinned;
        const rightScore = rightPinned === -1 ? 999 : rightPinned;
        return leftScore - rightScore || left.name.localeCompare(right.name);
      })
      .slice(0, 18);
  }, [launcherApps, launcherQuery]);

  const searchResults = useMemo(() => {
    const query = deferredSearchQuery.trim();
    if (!query) {
      return [];
    }

    const localEntries = Object.values(localThreadIndex).map((entry) => ({
      id: `local-${entry.threadId}`,
      source: "local" as const,
      threadId: entry.threadId,
      title: entry.title || "새 채팅",
      snippet: entry.snippet,
      score: scoreSearch(query, entry.text, entry.title),
    }));

    const cloudEntries = Object.values(cloudSearchIndex).map((entry) => ({
      id: `cloud-${entry.threadId}`,
      source: "cloud" as const,
      threadId: entry.threadId,
      title: entry.title,
      snippet: entry.snippet,
      score: scoreSearch(query, entry.text, entry.title),
    }));

    return [...localEntries, ...cloudEntries]
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.snippet.length - left.snippet.length,
      )
      .slice(0, 16);
  }, [cloudSearchIndex, deferredSearchQuery, localThreadIndex]);

  async function fetchCloudThreads(token: string) {
    const response = await fetch(`${API_BASE}/api/chat/threads`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch cloud threads.");
    }

    const data = (await response.json()) as {
      success?: boolean;
      threads?: CloudThread[];
    };

    return Array.isArray(data.threads) ? data.threads : [];
  }

  async function fetchCloudThreadMessages(threadId: string, token: string) {
    const response = await fetch(
      `${API_BASE}/api/chat/threads/${threadId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      messages?: Array<{ content?: string }>;
    };

    return Array.isArray(data.messages) ? data.messages : [];
  }

  async function hydrateCloudIndex(token: string) {
    try {
      const threads = await fetchCloudThreads(token);
      setCloudThreads(threads);

      const entries = await Promise.all(
        threads.slice(0, 20).map(async (thread) => {
          const messages = await fetchCloudThreadMessages(thread.id, token);
          const text = messages
            .map((message) => message.content || "")
            .join(" ")
            .trim();
          const title = thread.title?.trim() || "Cloud Chat";

          return [
            thread.id,
            {
              threadId: thread.id,
              title,
              text,
              snippet: buildSnippet(text || title),
              updatedAt:
                typeof thread.createdAt === "number"
                  ? thread.createdAt
                  : Number(new Date(thread.createdAt || Date.now())),
            } satisfies CloudSearchEntry,
          ] as const;
        }),
      );

      setCloudSearchIndex(Object.fromEntries(entries));
    } catch {
      setCloudSearchIndex({});
    }
  }

  async function checkWebAiStatus(forceRefresh = false) {
    if (typeof window === "undefined" || !window.assistantAPI?.invokeTool) {
      setWebAiStatus("disconnected");
      return;
    }

    try {
      const result = (await window.assistantAPI.invokeTool("ai:web-status", {
        forceRefresh,
      })) as {
        connected?: boolean;
        provider?: string | null;
        reason?: string | null;
      };

      if (result.connected) {
        setWebAiStatus("connected");
      } else if (result.reason === "expired") {
        setWebAiStatus("expired");
      } else {
        setWebAiStatus("disconnected");
      }

      setWebAiProvider(result.provider || null);
      setWebAiReason(result.reason || null);
    } catch {
      setWebAiStatus("disconnected");
      setWebAiProvider(null);
      setWebAiReason("status_check_failed");
    }
  }

  async function connectWebAi(provider: string = "chatgpt") {
    if (typeof window === "undefined" || !window.assistantAPI?.invokeTool) {
      return;
    }

    setWebAiStatus("checking");
    try {
      await window.assistantAPI.invokeTool("ai:web-login", {
        provider: provider,
      });
      await checkWebAiStatus(true);
    } catch {
      setWebAiStatus("disconnected");
    }
  }

  function handleLoginSuccess(user: AuthUser, token: string) {
    setAuthUser(user);
    setProfileDraftName(user.name || user.email.split("@")[0] || "");
    setProfileAutoSync(user.settings?.autoSync ?? true);
    setProfilePreferWebAi(user.settings?.preferWebAi ?? true);
    void persistAuthSession(token, user); // 세션 영구 저장
    void hydrateCloudIndex(token);
  }

  async function handleLogout() {
    setAuthUser(null);
    setCloudThreads([]);
    setCloudSearchIndex({});
    setProfileOpen(false);
    await clearAuthSession();
  }

  async function handleSaveProfile() {
    if (!authUser) {
      return;
    }

    const nextUser: AuthUser = {
      ...authUser,
      name:
        profileDraftName.trim() ||
        authUser.email.split("@")[0] ||
        "Jarvis User",
      settings: {
        autoSync: profileAutoSync,
        preferWebAi: profilePreferWebAi,
      },
    };

    setAuthUser(nextUser);
    await updateStoredAuthUser(nextUser);
    setProfileOpen(false);
  }

  async function startNewChat() {
    await aui.threads().switchToNewThread();
  }

  async function switchToThread(threadId: string) {
    await aui.threads().switchToThread(threadId);
  }

  function handleCreateProject() {
    const trimmed = newProjectName.trim();
    if (!trimmed) {
      return;
    }

    const nextProject: SidebarProject = {
      id: crypto.randomUUID(),
      name: trimmed,
      createdAt: Date.now(),
    };

    setProjects((prev) => [nextProject, ...prev]);
    setSelectedProjectId(nextProject.id);
    setNewProjectName("");
    setProjectDialogOpen(false);
  }

  async function loadLauncherApps() {
    if (
      launcherApps.length > 0 ||
      typeof window === "undefined" ||
      !window.assistantAPI?.invokeTool
    ) {
      return;
    }

    setLauncherLoading(true);
    try {
      const result = (await window.assistantAPI.invokeTool("apps:list", {
        limit: 80,
      })) as {
        data?: { apps?: LauncherApp[] };
      };

      setLauncherApps(result.data?.apps || []);
    } catch {
      setLauncherApps([]);
    } finally {
      setLauncherLoading(false);
    }
  }

  async function openLauncher() {
    setLauncherOpen(true);
    await loadLauncherApps();
  }

  async function handleOpenApp(appName: string) {
    if (typeof window === "undefined" || !window.assistantAPI?.invokeTool) {
      return;
    }

    await window.assistantAPI.invokeTool("app:open", {
      appName,
    });
    setLauncherOpen(false);
  }

  const userDisplayName =
    authUser?.name?.trim() || authUser?.email?.split("@")[0] || "로그인이 필요합니다";
  const userSubLabel = authUser
    ? authUser.settings?.autoSync
      ? "동기화 활성화됨"
      : "로컬 프로필"
    : "Plus Membership";

  return (
    <>
      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={handleLoginSuccess}
      />

      <MacUpdateModal
        isOpen={updateModalOpen}
        onClose={() => setUpdateModalOpen(false)}
        version={newVersion}
        downloadUrl={downloadUrl}
      />

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="border-white/10 bg-[#171717] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>새 프로젝트 만들기</DialogTitle>
            <DialogDescription className="text-zinc-400">
              빈 프로젝트로 시작하고 이후 대화를 묶어 관리할 수 있어요.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleCreateProject();
              }
            }}
            placeholder="예: Jarvis Desktop v1.3.16"
            className="border-white/10 bg-white/5 text-white placeholder:text-zinc-500"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProjectDialogOpen(false)}
            >
              취소
            </Button>
            <Button
              className="bg-white text-black hover:bg-zinc-200"
              onClick={handleCreateProject}
            >
              만들기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="border-white/10 bg-[#171717] text-white sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>글로벌 채팅 검색</DialogTitle>
            <DialogDescription className="text-zinc-400">
              로컬 인덱스와 클라우드 기록에서 키워드를 바로 찾아줘요.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="예: 업데이트 배너, Web AI, 프로젝트"
            className="border-white/10 bg-white/5 text-white placeholder:text-zinc-500"
          />
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {searchResults.length > 0 ? (
              searchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => {
                    if (result.source === "local") {
                      void switchToThread(result.threadId);
                      setSearchOpen(false);
                    }
                  }}
                  className={cn(
                    "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                    result.source === "local"
                      ? "border-white/10 bg-white/5 hover:bg-white/10"
                      : "border-emerald-500/20 bg-emerald-500/10",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium text-sm">
                      {result.title}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                        result.source === "local"
                          ? "bg-zinc-800 text-zinc-300"
                          : "bg-emerald-950/70 text-emerald-300",
                      )}
                    >
                      {result.source === "local" ? "로컬" : "클라우드"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-400">{result.snippet}</p>
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-white/10 border-dashed bg-white/5 px-4 py-8 text-center text-sm text-zinc-400">
                {deferredSearchQuery
                  ? "일치하는 대화가 아직 없어요."
                  : "검색어를 입력하면 저장된 대화를 바로 찾아볼 수 있어요."}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={launcherOpen} onOpenChange={setLauncherOpen}>
        <DialogContent className="border-white/10 bg-[#171717] text-white sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>생산성 앱 런처</DialogTitle>
            <DialogDescription className="text-zinc-400">
              macOS에 설치된 주요 앱을 바로 열 수 있어요.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={launcherQuery}
            onChange={(event) => setLauncherQuery(event.target.value)}
            placeholder="Chrome, VS Code, iTerm2..."
            className="border-white/10 bg-white/5 text-white placeholder:text-zinc-500"
          />
          <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {launcherLoading ? (
              <div className="col-span-full rounded-xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-zinc-400">
                설치된 앱 목록을 불러오는 중...
              </div>
            ) : launcherQuickApps.length > 0 ? (
              launcherQuickApps.map((app) => (
                <button
                  key={app.path || app.name}
                  type="button"
                  onClick={() => void handleOpenApp(app.name)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left transition-colors hover:bg-white/10"
                >
                  <div className="flex items-center gap-3">
                    <MonitorIcon className="size-4 text-zinc-400" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">{app.name}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {app.path}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="col-span-full rounded-xl border border-white/10 border-dashed bg-white/5 px-4 py-8 text-center text-sm text-zinc-400">
                검색 결과가 없어요.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="border-white/10 bg-[#171717] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>프로필 편집</DialogTitle>
            <DialogDescription className="text-zinc-400">
              표시 이름과 기본 동작을 저장해 다음 실행에서도 그대로 유지해요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor={profileNameInputId}
                className="font-medium text-xs text-zinc-400"
              >
                표시 이름
              </label>
              <Input
                id={profileNameInputId}
                value={profileDraftName}
                onChange={(event) => setProfileDraftName(event.target.value)}
                placeholder="이름을 입력하세요"
                className="border-white/10 bg-white/5 text-white placeholder:text-zinc-500"
              />
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>클라우드 대화 동기화 유지</span>
                <input
                  type="checkbox"
                  checked={profileAutoSync}
                  onChange={(event) => setProfileAutoSync(event.target.checked)}
                  className="size-4 accent-white"
                />
              </label>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>가능하면 Web AI 우선 사용</span>
                <input
                  type="checkbox"
                  checked={profilePreferWebAi}
                  onChange={(event) =>
                    setProfilePreferWebAi(event.target.checked)
                  }
                  className="size-4 accent-white"
                />
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileOpen(false)}>
              닫기
            </Button>
            <Button
              className="bg-white text-black hover:bg-zinc-200"
              onClick={() => void handleSaveProfile()}
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sidebar
        {...props}
        className="border-r-0 bg-[#171717] text-[#ececec] [--sidebar-width:280px]"
      >
        <SidebarHeader className="border-none px-3 pt-3 pb-0">
          <button
            type="button"
            onClick={() => setWebAiModalOpen(true)}
            className={cn(
              "mb-2 flex w-full items-center gap-2 rounded-xl border border-white/5 px-3 py-2.5 text-left font-semibold text-xs transition-all",
              webAiStatus === "connected"
                ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20"
                : "bg-zinc-800/60 text-zinc-300 ring-1 ring-zinc-700/30 hover:bg-zinc-700/60 hover:text-white",
              webAiStatus === "expired" &&
                "bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/20 hover:bg-amber-900/40",
            )}
          >
            <SparklesIcon className="size-3.5 shrink-0" />
            <span className="flex-1 truncate">
              {webAiStatus === "connected"
                ? `${webAiProvider?.toUpperCase() || "Web AI"} 활성화됨`
                : webAiStatus === "checking"
                  ? "상태 확인 중..."
                  : "Web AI 연동 및 관리"}
            </span>
            <div className="flex items-center gap-1.5 rounded-full bg-black/20 px-1.5 py-0.5 font-bold text-[9px] uppercase tracking-wider">
              {webAiStatus === "connected" ? "Connected" : "Setup"}
            </div>
          </button>

          {/* Web AI Management Modal */}
          <Dialog open={webAiModalOpen} onOpenChange={setWebAiModalOpen}>
            <DialogContent className="max-w-[380px] border-none bg-[#171717] p-0 text-white shadow-2xl">
              <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-500" />
              <div className="p-6">
                <DialogHeader className="mb-4">
                  <DialogTitle className="flex items-center gap-2 text-xl">
                    <SparklesIcon className="size-5 text-emerald-400" />
                    Web AI 관리
                  </DialogTitle>
                  <DialogDescription className="text-zinc-400">
                    브라우저 계정의 무료 토큰을 사용하여 고성능 모델을 연결합니다.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  {/* ChatGPT Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setWebAiModalOpen(false);
                      void connectWebAi("chatgpt");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl border p-4 transition-all hover:scale-[1.02]",
                      webAiProvider === "chatgpt" && webAiStatus === "connected"
                        ? "border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/20"
                        : "border-white/5 bg-white/5 hover:bg-white/10",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 font-bold text-emerald-400">
                        C
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-sm">ChatGPT</p>
                        <p className="text-xs text-zinc-500">OpenAI Backend API</p>
                      </div>
                    </div>
                    {webAiProvider === "chatgpt" &&
                      webAiStatus === "connected" && (
                        <BadgeCheckIcon className="size-5 text-emerald-400" />
                      )}
                  </button>

                  {/* Gemini Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setWebAiModalOpen(false);
                      void connectWebAi("gemini");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl border p-4 transition-all hover:scale-[1.02]",
                      webAiProvider === "gemini" && webAiStatus === "connected"
                        ? "border-blue-500/50 bg-blue-500/10 ring-1 ring-blue-500/20"
                        : "border-white/5 bg-white/5 hover:bg-white/10",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 font-bold text-blue-400">
                        G
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-sm">Gemini</p>
                        <p className="text-xs text-zinc-500">Google Advanced Web</p>
                      </div>
                    </div>
                    {webAiProvider === "gemini" &&
                      webAiStatus === "connected" && (
                        <BadgeCheckIcon className="size-5 text-blue-400" />
                      )}
                  </button>
                </div>

                {webAiStatus === "connected" && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      // 로그아웃 로직 (메인 프로세스에서 세션 클리어 필요)
                      window.assistantAPI
                        ?.invokeTool?.("ai:web-logout", {})
                        .then(() => checkWebAiStatus(true));
                      setWebAiModalOpen(false);
                    }}
                    className="mt-6 w-full text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                  >
                    연결 해제하기
                  </Button>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {webAiReason && webAiStatus === "expired" && (
            <p className="mb-2 px-1 text-[11px] text-amber-300/80">
              세션 토큰이 만료된 상태라 백그라운드에서 다시 연결이 필요해.
            </p>
          )}

          <div className="flex flex-col gap-0.5">
            <Button
              variant="ghost"
              onClick={() => void startNewChat()}
              className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 hover:bg-[#212121]"
            >
              <EditIcon className="size-4.5" />
              <span className="font-medium text-[15px]">새 채팅</span>
            </Button>

            <Button
              variant="ghost"
              onClick={() => setSearchOpen(true)}
              className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 hover:bg-[#212121]"
            >
              <SearchIcon className="size-4.5" />
              <span className="font-medium text-[15px]">채팅 검색</span>
            </Button>

            <Button
              variant="ghost"
              onClick={() => void openLauncher()}
              className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 hover:bg-[#212121]"
            >
              <MoreHorizontalIcon className="size-4.5" />
              <span className="font-medium text-[15px]">더 보기</span>
            </Button>
          </div>
        </SidebarHeader>

        <SidebarContent className="scrollbar-none px-3 py-2">
          <div className="mt-4 mb-1 flex items-center justify-between px-3">
            <p className="font-semibold text-muted-foreground/80 text-xs">
              프로젝트
            </p>
            {selectedProject && (
              <button
                type="button"
                onClick={() => setSelectedProjectId(null)}
                className="text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                전체 보기
              </button>
            )}
          </div>

          <div className="flex flex-col gap-0.5">
            <Button
              variant="ghost"
              onClick={() => setProjectDialogOpen(true)}
              className="flex items-center justify-start gap-3 rounded-lg px-3 py-5 hover:bg-[#212121]"
            >
              <FolderPlusIcon className="size-4.5" />
              <span className="font-medium text-sm">새 프로젝트</span>
            </Button>

            {projects.length > 0 ? (
              projects.map((project) => {
                const chatCount = Object.values(threadMetaById).filter(
                  (meta) => meta.projectId === project.id,
                ).length;

                return (
                  <Button
                    key={project.id}
                    variant="ghost"
                    onClick={() =>
                      setSelectedProjectId((current) =>
                        current === project.id ? null : project.id,
                      )
                    }
                    className={cn(
                      "flex items-center justify-start gap-3 rounded-lg px-3 py-5 transition-colors hover:bg-[#212121]",
                      selectedProjectId === project.id && "bg-[#252525]",
                    )}
                  >
                    <FolderIcon className="size-4.5 text-zinc-400" />
                    <span className="flex-1 truncate text-left font-medium text-sm">
                      {project.name}
                    </span>
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                      {chatCount}
                    </span>
                  </Button>
                );
              })
            ) : (
              <div className="rounded-xl border border-white/10 border-dashed bg-white/5 px-4 py-5 text-sm text-zinc-400">
                아직 프로젝트가 없어요. 새 프로젝트를 만들어 흐름을 분리해두자.
              </div>
            )}
          </div>

          <div className="mt-6 mb-1 px-3">
            <p className="font-semibold text-muted-foreground/80 text-xs">
              최근 {selectedProject ? `· ${selectedProject.name}` : ""}
            </p>
          </div>

          <div className="flex flex-col gap-0.5">
            {displayThreads.length > 0 ? (
              displayThreads.map((thread) => (
                <Button
                  key={thread.id}
                  variant="ghost"
                  onClick={() => void switchToThread(thread.id)}
                  className={cn(
                    "group relative flex items-center justify-start overflow-hidden rounded-lg px-3 py-5 text-left transition-colors",
                    thread.id === threadsState.mainThreadId
                      ? "bg-[#2f2f2f] text-white"
                      : "hover:bg-[#212121]",
                  )}
                >
                  <span className="flex-1 truncate font-medium text-sm">
                    {thread.title || "새 채팅"}
                  </span>
                </Button>
              ))
            ) : (
              <div className="rounded-xl border border-white/10 border-dashed bg-white/5 px-4 py-5 text-sm text-zinc-400">
                {selectedProject
                  ? "선택한 프로젝트에 아직 연결된 대화가 없어요."
                  : authUser
                    ? `클라우드 스레드 ${cloudThreads.length}개를 확인했고, 로컬 대화는 새로 시작하면 자동으로 색인돼요.`
                    : "새 채팅을 시작하면 여기에서 바로 이어볼 수 있어요."}
              </div>
            )}
          </div>

          {authUser && (
            <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="flex items-center gap-2 font-medium text-emerald-300 text-sm">
                <BadgeCheckIcon className="size-4" />
                <span>동기화 상태</span>
              </div>
              <p className="mt-2 text-emerald-100/80 text-xs">
                클라우드 스레드 {cloudThreads.length}개와 로컬 인덱스{" "}
                {Object.keys(localThreadIndex).length}개를 검색 대상으로 유지
                중이야.
              </p>
            </div>
          )}
        </SidebarContent>

        <SidebarFooter className="border-none px-3 pt-2 pb-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                if (authUser) {
                  setProfileDraftName(
                    authUser.name || authUser.email.split("@")[0] || "",
                  );
                  setProfileAutoSync(authUser.settings?.autoSync ?? true);
                  setProfilePreferWebAi(authUser.settings?.preferWebAi ?? true);
                  setProfileOpen(true);
                } else {
                  setLoginOpen(true);
                }
              }}
              className="flex flex-1 items-center justify-start gap-3 rounded-xl px-2 py-6 hover:bg-[#212121]"
            >
              <div className="flex size-8 items-center justify-center rounded-full bg-zinc-700 font-bold text-sm text-white">
                {userDisplayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex min-w-0 flex-1 flex-col items-start text-left">
                <span className="truncate font-medium text-sm text-white">
                  {userDisplayName}
                </span>
                <span
                  className={cn(
                    "truncate text-xs",
                    authUser ? "text-emerald-400" : "text-muted-foreground",
                  )}
                >
                  {userSubLabel}
                </span>
              </div>
              <UserRoundIcon className="size-4 text-zinc-500" />
            </Button>

            {authUser && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void handleLogout()}
                className="shrink-0 rounded-xl text-zinc-500 hover:bg-[#212121] hover:text-white"
                title="로그아웃"
              >
                <LogOutIcon className="size-4" />
              </Button>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <RocketIcon className="size-3.5" />
              Web AI 직접 요청 + 로컬 검색 인덱스 적용됨
            </span>
            <button
              type="button"
              onClick={() => void checkWebAiStatus(true)}
              className="inline-flex items-center gap-1 text-zinc-500 hover:text-white"
            >
              <RefreshCwIcon className="size-3.5" />
              새로고침
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>
    </>
  );
}
