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
  SidebarRail,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  FolderPlusIcon,
  FolderRootIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCcwIcon,
  SearchIcon,
  SparklesIcon,
  LockIcon,
  SettingsIcon,
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

type BootstrapPayload = {
  shortcut?: string;
  app?: {
    version?: string;
    packaged?: boolean;
    desktopUi?: string;
  };
  providers?: {
    stt?: string;
    tts?: string;
  };
  mute?: {
    muted?: boolean;
  };
};

type UpdateStatus = {
  state?: string;
  message?: string;
  mode?: string;
  version?: string;
  availableVersion?: string;
  downloadedVersion?: string;
  progressPercent?: number;
};

type AppStatePayload = {
  updater?: UpdateStatus | null;
};

const SIDEBAR_STORAGE_KEY = "jarvis-sidebar-layout-v2";

function slugifyProjectName(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `project-${Date.now()}`;
}

function formatRelativeTime(timestamp?: number) {
  if (!timestamp) {
    return "방금";
  }

  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);

  if (minutes < 1) {
    return "방금";
  }

  if (minutes < 60) {
    return `${minutes}분 전`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}시간 전`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}일 전`;
  }

  return new Date(timestamp).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
}

function readSidebarState() {
  if (typeof window === "undefined") {
    return {
      projects: [] as SidebarProject[],
      threadMetaById: {} as Record<string, StoredThreadMeta>,
      selectedProjectId: null as string | null,
    };
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (!raw) {
      return {
        projects: [],
        threadMetaById: {},
        selectedProjectId: null,
      };
    }

    const parsed = JSON.parse(raw) as {
      projects?: SidebarProject[];
      threadMetaById?: Record<string, StoredThreadMeta>;
      selectedProjectId?: string | null;
    };

    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      threadMetaById:
        parsed.threadMetaById && typeof parsed.threadMetaById === "object"
          ? parsed.threadMetaById
          : {},
      selectedProjectId:
        typeof parsed.selectedProjectId === "string"
          ? parsed.selectedProjectId
          : null,
    };
  } catch {
    return {
      projects: [],
      threadMetaById: {},
      selectedProjectId: null,
    };
  }
}

function writeSidebarState(payload: {
  projects: SidebarProject[];
  threadMetaById: Record<string, StoredThreadMeta>;
  selectedProjectId: string | null;
}) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(payload));
}

function CompactStatus({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

export function ThreadListSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const aui = useAui();
  const threadsState = useAuiState((state) => state.threads);
  const messageCount = useAuiState((state) => state.thread.messages.length);
  const {
    supported,
    status: voiceStatus,
    error: voiceError,
  } = useJarvisVoice();
  const {
    available: extensionsAvailable,
    status: extensionsStatus,
    refreshing: extensionsRefreshing,
    summary: extensionSummary,
    reload: reloadExtensions,
  } = useJarvisExtensions();

  const [searchQuery, setSearchQuery] = useState("");
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showConnections, setShowConnections] = useState(false);
  const [projects, setProjects] = useState<SidebarProject[]>([]);
  const [threadMetaById, setThreadMetaById] = useState<
    Record<string, StoredThreadMeta>
  >({});
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [bootstrapPayload, setBootstrapPayload] = useState<BootstrapPayload | null>(
    null,
  );
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [webAiConnected, setWebAiConnected] = useState(false);
  const [piiKeys, setPiiKeys] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const previousThreadIdsRef = useRef<string[]>([]);
  const previousMessageCountRef = useRef(0);
  const pendingNewThreadProjectIdRef = useRef<string | null>(null);

  const allThreads = threadsState.threadItems.filter(
    (item) => item.status === "regular",
  );
  const projectNameMap = useMemo(
    () =>
      Object.fromEntries(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  useEffect(() => {
    const stored = readSidebarState();
    setProjects(stored.projects);
    setThreadMetaById(stored.threadMetaById);
    setSelectedProjectId(stored.selectedProjectId);
    setHydrated(true);

    if (typeof window !== "undefined" && window.assistantAPI?.getBootstrap) {
      void window.assistantAPI
        .getBootstrap()
        .then((payload) => {
          setBootstrapPayload((payload || null) as BootstrapPayload | null);
        })
        .catch(() => {
          setBootstrapPayload(null);
        });
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.assistantAPI?.getAppState) {
      return;
    }

    let cancelled = false;

    void window.assistantAPI
      .getAppState()
      .then((payload) => {
        if (cancelled) {
          return;
        }

        const appState = (payload || {}) as AppStatePayload;
        setUpdateStatus(appState.updater || null);
      })
      .catch(() => {
        if (!cancelled) {
          setUpdateStatus(null);
        }
      });

    const unsubscribe = window.assistantAPI?.onUpdateStatus?.((payload) => {
      setUpdateStatus((payload || null) as UpdateStatus | null);
    });

    return () => {
      cancelled = true;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    // Periodically check Web AI connection status
    const checkStatus = async () => {
      if (window.assistantAPI?.invokeTool) {
        const res = (await window.assistantAPI.invokeTool("ai:web-status", {})) as any;
        if (res?.ok) setWebAiConnected(Boolean(res.connected));
        
        const piiRes = (await window.assistantAPI.invokeTool("pii:list", {})) as any;
        if (piiRes?.ok && Array.isArray(piiRes.keys)) setPiiKeys(piiRes.keys);
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    writeSidebarState({
      projects,
      threadMetaById,
      selectedProjectId,
    });
  }, [hydrated, projects, threadMetaById, selectedProjectId]);

  useEffect(() => {
    const currentIds = allThreads.map((thread) => thread.id);
    const previousIds = new Set(previousThreadIdsRef.current);

    setThreadMetaById((previous) => {
      const next: Record<string, StoredThreadMeta> = {};
      let changed = false;

      for (const thread of allThreads) {
        const existing = previous[thread.id];

        if (existing) {
          next[thread.id] = existing;
          continue;
        }

        changed = true;
        next[thread.id] = {
          createdAt: Date.now(),
          updatedAt: Date.now(),
          projectId: previousIds.has(thread.id)
            ? null
            : pendingNewThreadProjectIdRef.current,
        };
      }

      for (const threadId of Object.keys(previous)) {
        if (currentIds.includes(threadId)) {
          continue;
        }

        changed = true;
      }

      return changed ? next : previous;
    });

    if (
      currentIds.some((threadId) => !previousIds.has(threadId)) &&
      pendingNewThreadProjectIdRef.current
    ) {
      pendingNewThreadProjectIdRef.current = null;
    }

    previousThreadIdsRef.current = currentIds;
  }, [allThreads]);

  useEffect(() => {
    const activeThreadId = threadsState.mainThreadId;
    if (!activeThreadId) {
      return;
    }

    setThreadMetaById((previous) => {
      const current = previous[activeThreadId];
      if (!current) {
        return {
          ...previous,
          [activeThreadId]: {
            createdAt: Date.now(),
            updatedAt: Date.now(),
            projectId: null,
          },
        };
      }

      return {
        ...previous,
        [activeThreadId]: {
          ...current,
          updatedAt: Date.now(),
        },
      };
    });
  }, [threadsState.mainThreadId]);

  useEffect(() => {
    if (messageCount === previousMessageCountRef.current) {
      return;
    }

    previousMessageCountRef.current = messageCount;

    const activeThreadId = threadsState.mainThreadId;
    if (!activeThreadId) {
      return;
    }

    setThreadMetaById((previous) => {
      const current = previous[activeThreadId];
      if (!current) {
        return previous;
      }

      return {
        ...previous,
        [activeThreadId]: {
          ...current,
          updatedAt: Date.now(),
        },
      };
    });
  }, [messageCount, threadsState.mainThreadId]);

  useEffect(() => {
    if (selectedProjectId && !projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(null);
    }
  }, [projects, selectedProjectId]);

  const projectEntries = useMemo(() => {
    return [...projects]
      .map((project) => {
        const assignedThreads = allThreads.filter(
          (thread) => threadMetaById[thread.id]?.projectId === project.id,
        );
        const updatedAt = Math.max(
          project.createdAt,
          ...assignedThreads.map((thread) => threadMetaById[thread.id]?.updatedAt || 0),
        );

        return {
          ...project,
          threadCount: assignedThreads.length,
          updatedAt,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [allThreads, projects, threadMetaById]);

  const visibleProjects = showAllProjects
    ? projectEntries
    : projectEntries.slice(0, 5);

  const filteredRecentThreads = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return [...allThreads]
      .filter((thread) => {
        const projectId = threadMetaById[thread.id]?.projectId || null;
        const projectName = projectId ? projectNameMap[projectId] || "" : "";

        if (selectedProjectId && projectId !== selectedProjectId) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        return [thread.title || "", projectName]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((left, right) => {
        const rightUpdatedAt = threadMetaById[right.id]?.updatedAt || 0;
        const leftUpdatedAt = threadMetaById[left.id]?.updatedAt || 0;
        return rightUpdatedAt - leftUpdatedAt;
      });
  }, [allThreads, projectNameMap, searchQuery, selectedProjectId, threadMetaById]);

  const selectedProjectName = selectedProjectId
    ? projectNameMap[selectedProjectId] || "선택한 프로젝트"
    : "전체 채팅";

  const updateLabel =
    updateStatus?.state === "downloaded"
      ? "업데이트 준비 완료"
      : updateStatus?.state === "available"
        ? "업데이트 사용 가능"
        : updateStatus?.state === "checking"
          ? "업데이트 확인 중"
          : updateStatus?.state === "downloading"
            ? "업데이트 다운로드 중"
            : updateStatus?.state === "error"
              ? "업데이트 확인 실패"
              : "업데이트 안내";

  const updateDetail =
    updateStatus?.message ||
    (updateStatus?.mode === "installer"
      ? "새 버전이 있으면 설치 페이지를 열어 확인할 수 있어요."
      : "최신 버전 여부를 확인하려면 아래 버튼을 눌러 보세요.");
  const hasUpdateNotice = Boolean(updateStatus && updateStatus.state !== "disabled");

  const voiceStatusLabel =
    voiceStatus === "listening"
      ? "듣는 중"
      : voiceStatus === "processing"
        ? "처리 중"
        : voiceStatus === "error"
          ? "오류"
          : supported
            ? "준비됨"
            : "지원 안 됨";

  const connectionStatusLabel =
    extensionsStatus === "ready"
      ? "연결됨"
      : extensionsStatus === "loading"
        ? "불러오는 중"
        : extensionsStatus === "error"
          ? "확인 필요"
          : "데스크톱 전용";

  function createProject() {
    const name = projectDraft.trim();

    if (!name) {
      return;
    }

    const projectId = `${slugifyProjectName(name)}-${Date.now().toString(36)}`;

    setProjects((previous) => [
      {
        id: projectId,
        name,
        createdAt: Date.now(),
      },
      ...previous,
    ]);
    setSelectedProjectId(projectId);
    setProjectDraft("");
    setIsAddingProject(false);
  }

  function startNewChat() {
    pendingNewThreadProjectIdRef.current = selectedProjectId;
    void aui.threads().switchToNewThread();
  }

  function switchToThread(threadId: string) {
    void aui.threads().switchToThread(threadId);
  }

  function assignCurrentThreadToProject(projectId: string | null) {
    const activeThreadId = threadsState.mainThreadId;

    if (!activeThreadId) {
      return;
    }

    setThreadMetaById((previous) => {
      const current = previous[activeThreadId];
      return {
        ...previous,
        [activeThreadId]: {
          createdAt: current?.createdAt || Date.now(),
          updatedAt: Date.now(),
          projectId,
        },
      };
    });
  }

  return (
    <Sidebar
      {...props}
      className="border-r-0 bg-[#f9f9f9] dark:bg-[#171717] [--sidebar-width:260px]"
    >
      <SidebarHeader className="border-none px-3 pt-3">
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={startNewChat}
            className="flex-1 justify-start rounded-lg hover:bg-black/5 dark:hover:bg-white/5 h-10 px-2"
          >
            <div className="flex items-center gap-2 text-foreground/80">
              <div className="flex size-6 items-center justify-center rounded-full border border-border/50 shadow-sm bg-background">
                <SparklesIcon className="size-3.5" />
              </div>
              <span className="font-medium text-sm">새로운 채팅</span>
            </div>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowConnections((current) => !current)}
            className="rounded-lg hover:bg-black/5 dark:hover:bg-white/5 size-10 shrink-0 ml-1"
          >
            <MoreHorizontalIcon className="size-4 text-muted-foreground" />
          </Button>
        </div>
        
        {showConnections ? (
          <div className="mt-2 grid gap-1 rounded-xl border border-border/50 bg-background/50 p-2 text-xs">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-muted-foreground">음성 연결</span>
              <span>{voiceStatusLabel}</span>
            </div>
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-muted-foreground">확장 프로그램</span>
              <span>{connectionStatusLabel}</span>
            </div>
          </div>
        ) : null}
      </SidebarHeader>

      <SidebarContent className="px-3 pb-3 pt-2">
        <div className="flex flex-col gap-1">
          <p className="px-2 py-2 text-xs font-semibold text-muted-foreground">
            최근 채팅
          </p>
          {filteredRecentThreads.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              이전 대화가 없습니다.
            </div>
          ) : (
            filteredRecentThreads.map((thread) => {
              const isActive = threadsState.mainThreadId === thread.id;
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => switchToThread(thread.id)}
                  className={cn(
                    "group relative flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                    isActive
                      ? "bg-black/5 dark:bg-white/10 font-medium text-foreground"
                      : "text-foreground/80 hover:bg-black/5 dark:hover:bg-white/5",
                  )}
                >
                  <MessageSquareIcon className={cn("size-4 shrink-0", isActive ? "text-foreground" : "opacity-50")} />
                  <div className="relative flex-1 truncate">
                    {thread.title || "새로운 채팅"}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </SidebarContent>

      <SidebarFooter className="border-none px-3 pb-3">
        <div className="flex flex-col gap-1">
          {!webAiConnected ? (
            <Button 
              size="sm" 
              variant="default" 
              className="mb-2 w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
              onClick={() => window.assistantAPI?.invokeTool("ai:web-login", {})}
            >
              ChatGPT 연동 로그인
            </Button>
          ) : null}

          <div className="mt-1 flex items-center justify-between rounded-lg px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 text-white shadow-sm">
                <span className="text-xs font-bold">J</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium">Jarvis Desktop</span>
                <span className="text-[10px] text-muted-foreground">버전 {bootstrapPayload?.app?.version || "1.3.4"}</span>
              </div>
            </div>
            <div className="flex gap-1">
              <Button 
                size="icon" 
                variant="ghost" 
                className="size-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                title="개인정보(PII) 관리"
                onClick={() => {
                  const key = window.prompt("저장할 정보의 이름을 입력하세요 (예: password, address)");
                  if (key) {
                    const val = window.prompt(`${key}의 값을 입력하세요`);
                    if (val) window.assistantAPI?.invokeTool("pii:set", { key, value: val });
                  }
                }}
              >
                <LockIcon className="size-3.5" />
              </Button>
              <Button 
                size="icon" 
                variant="ghost" 
                className="size-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
                title="업데이트 확인"
                onClick={() => {
                  if (!window.assistantAPI?.checkForUpdates) return;
                  void window.assistantAPI.checkForUpdates().then((payload) => {
                    const next = (payload || null) as AppStatePayload;
                    setUpdateStatus(next.updater || null);
                    if (next.updater?.state === "error") {
                      window.alert("업데이트 확인 실패: " + next.updater.message);
                    } else if (next.updater?.availableVersion) {
                      window.alert("새로운 버전을 발견했습니다: " + next.updater.availableVersion);
                    } else {
                      window.alert("현재 최신 버전입니다.");
                    }
                  });
                }}
              >
                <SettingsIcon className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
