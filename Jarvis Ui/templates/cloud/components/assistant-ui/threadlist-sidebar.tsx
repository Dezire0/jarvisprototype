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
      variant="floating"
      className="aui-sidebar border-r-0 bg-transparent [--sidebar-width:23rem]"
    >
      <SidebarHeader className="border-none px-3 pt-4">
        <div className="rounded-[28px] border border-border/80 bg-card/88 p-3 shadow-[0_18px_70px_rgba(0,0,0,0.16)] backdrop-blur">
          <div className="mb-3 flex items-center gap-2">
            <Button
              type="button"
              onClick={startNewChat}
              className="flex-1 justify-start rounded-2xl bg-foreground text-background hover:bg-foreground/90"
            >
              <PlusIcon className="size-4" />
              새 채팅
            </Button>
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="채팅 검색"
                className="h-10 rounded-2xl border-border/70 bg-background/70 pr-3 pl-9"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setShowConnections((current) => !current)}
              className="rounded-2xl border-border/70 bg-background/70"
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </div>

          {showConnections ? (
            <div className="grid gap-2 rounded-[22px] border border-border/70 bg-background/55 p-3">
              <div className="grid grid-cols-2 gap-2">
                <CompactStatus label="Voice" value={voiceStatusLabel} />
                <CompactStatus label="Connections" value={connectionStatusLabel} />
                <CompactStatus
                  label="Connectors"
                  value={String(extensionSummary.connectors)}
                />
                <CompactStatus
                  label="Webhooks"
                  value={String(extensionSummary.webhooks)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!extensionsAvailable || extensionsRefreshing}
                  onClick={() => void reloadExtensions()}
                  className="rounded-full"
                >
                  <RefreshCcwIcon
                    className={cn(
                      "size-3.5",
                      extensionsRefreshing && "animate-spin",
                    )}
                  />
                  연결 새로고침
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!selectedProjectId}
                  onClick={() => assignCurrentThreadToProject(selectedProjectId)}
                  className="rounded-full"
                >
                  현재 채팅을 프로젝트에 담기
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => assignCurrentThreadToProject(null)}
                  className="rounded-full"
                >
                  프로젝트에서 빼기
                </Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Connector는 앱 이름을 보정하고, Skill은 작업 힌트를 더하고,
                Webhook은 일반 라우팅 전에 먼저 실행됩니다.
              </p>
              {voiceError ? (
                <p className="text-xs leading-5 text-amber-600 dark:text-amber-400">
                  {voiceError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-3 px-3 pb-3">
        <section className="rounded-[28px] border border-border/70 bg-card/82 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                프로젝트
              </p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight">
                특정 주제별 채팅 모음
              </h3>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setIsAddingProject((current) => !current)}
              className="rounded-full"
            >
              <FolderPlusIcon className="size-4" />
            </Button>
          </div>

          {isAddingProject ? (
            <div className="mb-3 rounded-2xl border border-border/70 bg-background/65 p-3">
              <Input
                value={projectDraft}
                onChange={(event) => setProjectDraft(event.target.value)}
                placeholder="새 프로젝트 이름"
                className="h-10 rounded-xl border-border/70 bg-background/80"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    createProject();
                  }
                }}
              />
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={createProject}
                  className="rounded-full"
                >
                  프로젝트 추가
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setProjectDraft("");
                    setIsAddingProject(false);
                  }}
                  className="rounded-full"
                >
                  취소
                </Button>
              </div>
            </div>
          ) : null}

          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => setSelectedProjectId(null)}
              className={cn(
                "flex items-center justify-between rounded-2xl border px-3 py-3 text-left transition",
                selectedProjectId === null
                  ? "border-border bg-background text-foreground"
                  : "border-border/60 bg-background/55 text-foreground hover:bg-background/75",
              )}
            >
              <div className="min-w-0">
                <p className="font-medium">전체 채팅</p>
                <p className="text-xs text-muted-foreground">
                  프로젝트에 묶이지 않은 채팅까지 함께 봅니다.
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {allThreads.length}
              </span>
            </button>

            {visibleProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => setSelectedProjectId(project.id)}
                className={cn(
                  "flex items-center justify-between rounded-2xl border px-3 py-3 text-left transition",
                  selectedProjectId === project.id
                    ? "border-border bg-background text-foreground"
                    : "border-border/60 bg-background/55 text-foreground hover:bg-background/75",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{project.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {project.threadCount > 0
                      ? `${project.threadCount}개의 채팅`
                      : "아직 담긴 채팅 없음"}
                  </p>
                </div>
                <FolderRootIcon className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>

          {projectEntries.length > 5 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAllProjects((current) => !current)}
              className="mt-2 rounded-full text-muted-foreground"
            >
              {showAllProjects ? "프로젝트 접기" : "더 보기"}
            </Button>
          ) : null}
        </section>

        <section className="min-h-0 rounded-[28px] border border-border/70 bg-card/82 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                최근
              </p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight">
                {selectedProjectName}
              </h3>
            </div>
            <span className="text-xs text-muted-foreground">
              최신 업데이트 순
            </span>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            {filteredRecentThreads.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-background/45 px-4 py-5 text-sm leading-6 text-muted-foreground">
                검색 결과가 없거나, 아직 이 프로젝트에 담긴 채팅이 없어요.
              </div>
            ) : (
              filteredRecentThreads.map((thread) => {
                const metadata = threadMetaById[thread.id];
                const projectName = metadata?.projectId
                  ? projectNameMap[metadata.projectId]
                  : "";
                const isActive = threadsState.mainThreadId === thread.id;

                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => switchToThread(thread.id)}
                    className={cn(
                      "rounded-2xl border px-3 py-3 text-left transition",
                      isActive
                        ? "border-border bg-background text-foreground"
                        : "border-border/60 bg-background/55 text-foreground hover:bg-background/75",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                        <MessageSquareIcon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate font-medium">
                            {thread.title || "New Chat"}
                          </p>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatRelativeTime(metadata?.updatedAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {projectName
                            ? `${projectName} 프로젝트`
                            : "최근 업데이트된 일반 채팅"}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </SidebarContent>

      <SidebarFooter className="border-none px-3 pb-4">
        <div className="rounded-[24px] border border-border/70 bg-card/78 px-4 py-4">
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
            계정 정보
          </p>
          <div className="mt-3 grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">세션</span>
              <span className="font-medium text-foreground">
                {bootstrapPayload?.app?.packaged ? "Desktop build" : "Local preview"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">버전</span>
              <span className="font-medium text-foreground">
                {bootstrapPayload?.app?.version || "0.1.0"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">로그인 (Web AI)</span>
              <span className={cn("font-medium", webAiConnected ? "text-green-500" : "text-amber-500")}>
                {webAiConnected ? "연결됨" : "미연결"}
              </span>
            </div>
            {!webAiConnected && (
              <Button 
                size="sm" 
                variant="outline" 
                className="mt-1 w-full rounded-xl"
                onClick={() => window.assistantAPI?.invokeTool("ai:web-login", {})}
              >
                ChatGPT 로그인하기
              </Button>
            )}
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-muted-foreground">보안 정보 (PII)</span>
              <span className="text-xs text-muted-foreground">{piiKeys.length}개 저장됨</span>
            </div>
            <Button 
              size="sm" 
              variant="ghost" 
              className="mt-1 w-full rounded-xl border border-dashed border-border/50"
              onClick={() => {
                const key = window.prompt("저장할 정보의 이름을 입력하세요 (예: password, address)");
                if (key) {
                  const val = window.prompt(`${key}의 값을 입력하세요`);
                  if (val) window.assistantAPI?.invokeTool("pii:set", { key, value: val });
                }
              }}
            >
              개인정보 추가/관리
            </Button>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">음성 입력</span>
              <span className="font-medium text-foreground">
                {bootstrapPayload?.providers?.stt || "Web Speech"}
              </span>
            </div>
          </div>
          <div className="mt-3 rounded-2xl border border-border/70 bg-background/55 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {bootstrapPayload?.shortcut ||
              "Cmd/Ctrl + Shift + Space로 앱을 다시 열 수 있어요."}
          </div>

          {hasUpdateNotice ? (
            <div className="mt-3 rounded-[22px] border border-amber-500/30 bg-amber-500/10 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-amber-500">
                    {updateLabel}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-foreground">
                    {updateStatus?.state === "error"
                      ? (updateStatus.message || "업데이트 상태를 다시 확인해 보세요.")
                      : updateDetail}
                  </p>
                  {updateStatus?.version ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      현재 버전: {updateStatus.version}
                      {updateStatus.availableVersion
                        ? ` · 최신: ${updateStatus.availableVersion}`
                        : ""}
                    </p>
                  ) : null}
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 rounded-full border-amber-500/30 bg-background/80"
                  onClick={() => {
                    if (!window.assistantAPI?.checkForUpdates) {
                      return;
                    }

                    void window.assistantAPI
                      .checkForUpdates()
                      .then((payload) => {
                        const next = (payload || null) as AppStatePayload;
                        setUpdateStatus(next.updater || null);
                      })
                      .catch(() => {
                        setUpdateStatus((current) => current);
                      });
                  }}
                >
                  지금 확인
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
