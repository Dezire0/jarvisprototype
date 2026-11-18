"use client";

import type * as React from "react";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
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
import { useChatHistory } from "@/app/jarvis-runtime-provider";
import { VoiceOutputSettingsButton } from "@/components/jarvis/voice-output-settings";
import type { SidebarHistory } from "@/lib/chat-history";
import { isWorkspaceLanguage, useWorkspaceLocale, WORKSPACE_LANGUAGES, type WorkspaceLanguage } from "@/lib/workspace-language";
import { LoginModal } from "@/components/jarvis/login-modal";
import { MacUpdateModal } from "@/components/jarvis/mac-update-modal";
import {
  clearAuthSession,
  restoreAuthSession,
  type AuthUser,
} from "@/components/jarvis/auth-session";
import {
  EditIcon,
  HistoryIcon,
  SearchIcon,
  Settings2Icon,
  MoreHorizontalIcon,
  FolderPlusIcon,
  FolderIcon,
  LogOutIcon,
  ShieldAlertIcon,
  MonitorIcon,
  UserRoundIcon,
} from "lucide-react";

const API_BASE = "https://jarvis-auth-service.dexproject.workers.dev";
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

type SidebarProject = SidebarHistory["projects"][number];
type StoredThreadMeta = SidebarHistory["threadMetaById"][string];

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
  computerControlEnabled,
  onOpenModelSettings,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  computerControlEnabled: boolean;
  onOpenModelSettings?: (trigger: HTMLButtonElement) => void;
}) {
  const aui = useAui();
  const { isMobile, setOpenMobile } = useSidebar();
  const threadsState = useAuiState((state) => state.threads);
  const history = useChatHistory();
  const revision = useSyncExternalStore(history.subscribe, history.getRevision, history.getRevision);

  const [projects, setProjects] = useState<SidebarProject[]>(() => history.sidebar.projects);
  const [threadMetaById, setThreadMetaById] = useState<Record<string, StoredThreadMeta>>(() => history.sidebar.threadMetaById);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => history.sidebar.selectedProjectId);
  const [loginOpen, setLoginOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [logoutError, setLogoutError] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [cloudSearchIndex, setCloudSearchIndex] = useState<
    Record<string, CloudSearchEntry>
  >({});
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
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
  const [profileAutoSync, setProfileAutoSync] = useState(history.cloudSync);
  const [profileSavedMemory, setProfileSavedMemory] = useState(history.profile.savedMemory);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState(false);
  const [profileDraftLanguage, setProfileDraftLanguage] = useState<WorkspaceLanguage>("auto");
  const [languageSaving, setLanguageSaving] = useState(false);
  const [languageSaveError, setLanguageSaveError] = useState(false);
  const profileNameInputId = useId();
  const profileMemoryHintId = useId();
  const profileTrigger = useRef<HTMLButtonElement>(null);

  const isKo = useWorkspaceLocale().startsWith("ko");

  const t = (ko: string, en: string) => (isKo ? ko : en);
  const languageLabels = { auto: t("시스템", "System"), ko: "한국어", en: "English" };
  const saveError = t("설정을 저장하지 못했습니다. 다시 시도하세요.", "Preferences couldn’t be saved. Try again.");

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const allThreads = threadsState.threadItems.filter(
    (item) => item.status === "regular" && !history.isTemporary(item.remoteId ?? item.id),
  );
  const activeThread =
    allThreads.find((thread) => thread.id === threadsState.mainThreadId) ||
    null;
  const activeThreadId = activeThread?.remoteId ?? activeThread?.id ?? null;
  useEffect(() => {
    void (async () => {
      const session = await restoreAuthSession();
      if (session.user?.id === history.accountId) {
        setAuthUser(session.user);
      }
      const cloudToken = history.cloudToken();
      if (cloudToken) void hydrateCloudIndex(cloudToken);
    })();

    let unsubscribeUpdate: (() => void) | undefined;
    if (typeof window !== "undefined" && (window as any).assistantAPI?.onUpdateStatus) {
      unsubscribeUpdate = (window as any).assistantAPI.onUpdateStatus((status: any) => {
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
      unsubscribeUpdate?.();
    };
  }, []);

  useEffect(() => {
    history.setSidebar({ projects, selectedProjectId, threadMetaById });
  }, [history, projects, selectedProjectId, threadMetaById]);

  useEffect(() => {
    if (!activeThreadId) return;
    setThreadMetaById((previous) => {
      if (Object.hasOwn(previous, activeThreadId)) return previous;
      const now = Date.now();
      return { ...previous, [activeThreadId]: { createdAt: now, updatedAt: now, projectId: selectedProjectId } };
    });
  }, [activeThreadId, selectedProjectId]);

  const displayThreads = useMemo(() => {
    const filtered = selectedProjectId
      ? allThreads.filter(
          (thread) =>
            threadMetaById[thread.remoteId ?? thread.id]?.projectId === selectedProjectId,
        )
      : allThreads;

    return filtered
      .slice()
      .sort((left, right) => {
        const leftUpdated = history.get(left.remoteId ?? left.id)?.updatedAt || threadMetaById[left.remoteId ?? left.id]?.updatedAt || 0;
        const rightUpdated = history.get(right.remoteId ?? right.id)?.updatedAt || threadMetaById[right.remoteId ?? right.id]?.updatedAt || 0;
        return rightUpdated - leftUpdated;
      })
      .slice(0, 12);
  }, [allThreads, history, revision, selectedProjectId, threadMetaById]);

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

    const localEntries = history.localThreads().map((entry) => {
      const title = entry.title || "New Chat";
      const text = entry.messages.map((message) => message.text).join(" ");
      return {
        id: `local-${entry.remoteId}`, source: "local" as const, threadId: entry.remoteId,
        title, snippet: buildSnippet(text), score: scoreSearch(query, text, title),
      };
    });
    const cloudEntries = Object.values(cloudSearchIndex)
      .filter((entry) => !history.get(entry.threadId))
      .map((entry) => ({
        id: `cloud-${entry.threadId}`, source: "cloud" as const, threadId: entry.threadId,
        title: entry.title, snippet: entry.snippet, score: scoreSearch(query, entry.text, entry.title),
      }));

    return [...localEntries, ...cloudEntries]
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.snippet.length - left.snippet.length,
      )
      .slice(0, 16);
  }, [cloudSearchIndex, deferredSearchQuery, history, revision]);

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
    if (token !== history.cloudToken()) return [];
    const response = await fetch(
      `${API_BASE}/api/chat/threads/${encodeURIComponent(threadId)}/messages`,
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
    if (token !== history.cloudToken()) return;
    try {
      const threads = await fetchCloudThreads(token);
      if (token !== history.cloudToken()) return;

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

      if (token === history.cloudToken()) setCloudSearchIndex(Object.fromEntries(entries));
    } catch {
      setCloudSearchIndex({});
    }
  }

  function handleLoginSuccess(user: AuthUser, token: string) {
    setAuthUser(user);
    void hydrateCloudIndex(token);
  }

  async function handleLogout() {
    setLogoutPending(true);
    setLogoutError(false);
    try {
      await clearAuthSession();
      setAuthUser(null);
      setCloudSearchIndex({});
      setProfileOpen(false);
    } catch {
      setLogoutError(true);
    } finally {
      setLogoutPending(false);
    }
  }

  async function handleSaveProfile() {
    if (!authUser || profileSaving) return;
    setProfileSaving(true);
    setProfileSaveError(false);
    const saved = await history.saveProfile({
      name: profileDraftName.trim(),
      language: profileDraftLanguage,
      cloudSync: profileAutoSync,
      savedMemory: profileSavedMemory,
    });
    setProfileSaving(false);
    if (!saved) {
      setProfileSaveError(true);
      setCloudSearchIndex({});
      return;
    }
    const cloudToken = history.cloudToken();
    if (cloudToken) void hydrateCloudIndex(cloudToken);
    else setCloudSearchIndex({});
    setLanguageSaveError(false);
    setProfileOpen(false);
  }

  async function handleSaveLanguage(language: WorkspaceLanguage) {
    if (languageSaving) return;
    setLanguageSaving(true);
    setLanguageSaveError(false);
    const saved = await history.saveProfile({ language });
    setLanguageSaving(false);
    setLanguageSaveError(!saved);
  }

  async function startNewChat(temporary = false) {
    history.setTemporaryDraft(temporary);
    await aui.threads().switchToNewThread();
    if (isMobile) setOpenMobile(false);
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
      !(window as any).assistantAPI?.invokeTool
    ) {
      return;
    }

    setLauncherLoading(true);
    try {
      const result = (await (window as any).assistantAPI.invokeTool("apps:list", {
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
    if (typeof window === "undefined" || !(window as any).assistantAPI?.invokeTool) {
      return;
    }

    await (window as any).assistantAPI.invokeTool("app:open", {
      appName,
    });
    setLauncherOpen(false);
  }

  const userDisplayName =
    history.profile.name || authUser?.email?.split("@")[0] || t("로그인이 필요합니다", "Login Required");
  const userSubLabel = authUser
    ? history.cloudSync
      ? t("동기화 설정 켜짐", "Sync enabled in settings")
      : t("로컬 프로필", "Local Profile")
    : t("플러스 멤버십", "Plus Membership");

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
        <DialogContent className="border-border bg-background text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("새 프로젝트 만들기", "Create New Project")}</DialogTitle>
          </DialogHeader>
          <Input
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleCreateProject();
              }
            }}
            placeholder={t("프로젝트 이름", "Project Name")}
            className="border-white/10 bg-white/5 text-white placeholder:text-zinc-500"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setProjectDialogOpen(false)}
            >
              {t("취소", "Cancel")}
            </Button>
            <Button
              className="bg-white text-black hover:bg-zinc-200"
              onClick={handleCreateProject}
            >
              {t("만들기", "Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="border-border bg-background text-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("글로벌 채팅 검색", "Global Chat Search")}</DialogTitle>
          </DialogHeader>
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label={t("대화 검색어", "Search conversations")}
            placeholder={t("대화 제목이나 내용", "Conversation title or text")}
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
                    } else {
                      const entry = cloudSearchIndex[result.threadId];
                      if (entry) void history.importCloud(entry.threadId, entry.title, entry.updatedAt)
                        .then(async (imported) => {
                          if (imported) {
                            await switchToThread(entry.threadId);
                            setSearchOpen(false);
                          }
                        }).catch(() => {});
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
                      {result.source === "local" ? t("로컬", "Local") : t("클라우드", "Cloud")}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-400">{result.snippet}</p>
                </button>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {deferredSearchQuery
                  ? t("일치하는 대화가 없습니다.", "No matching conversations.")
                  : t("검색어를 입력해 저장된 대화를 찾으세요.", "Enter a search term to find saved conversations.")}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={launcherOpen} onOpenChange={setLauncherOpen}>
        <DialogContent className="border-border bg-background text-foreground sm:max-w-2xl">
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

      <Dialog open={profileOpen} onOpenChange={(open) => { if (!profileSaving) setProfileOpen(open); }}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-border bg-background text-foreground sm:max-w-md"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            profileTrigger.current?.focus();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle>{t("프로필 편집", "Edit profile")}</DialogTitle>
            <DialogDescription>
              {t("다음 실행에도 이 계정의 설정을 사용합니다.", "These preferences are saved for this account on this device.")}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={(event) => {
            event.preventDefault();
            void handleSaveProfile();
          }}>
            <fieldset disabled={profileSaving} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor={profileNameInputId} className="block text-sm font-medium">
                  {t("표시 이름", "Display name")}
                </label>
                <Input
                  id={profileNameInputId}
                  value={profileDraftName}
                  onChange={(event) => setProfileDraftName(event.target.value)}
                  placeholder={t("이름을 입력하세요", "Enter a name")}
                  maxLength={80}
                  className="border-input bg-background text-foreground dark:bg-background"
                />
              </div>
              <label className="block space-y-2 text-sm font-medium">
                <span>{t("언어", "Language")}</span>
                <select
                  value={profileDraftLanguage}
                  onChange={(event) => {
                    if (isWorkspaceLanguage(event.target.value)) setProfileDraftLanguage(event.target.value);
                  }}
                  className="block h-9 w-full rounded-md border border-input bg-background px-2 text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {WORKSPACE_LANGUAGES.map((language) => <option key={language} value={language}>
                    {languageLabels[language]}
                  </option>)}
                </select>
              </label>
              <label className="flex items-center justify-between gap-4 border-t border-border pt-4 text-sm">
                <span>{t("클라우드 대화 동기화", "Cloud conversation sync")}</span>
                <input
                  type="checkbox"
                  checked={profileAutoSync}
                  onChange={(event) => setProfileAutoSync(event.target.checked)}
                  className="size-4 shrink-0 accent-foreground"
                />
              </label>
              <div className="space-y-1 border-t border-border pt-4">
                <label className="flex min-h-7 items-center justify-between gap-4 text-sm">
                  <span>{t("저장된 기억 사용", "Use saved memory")}</span>
                  <input
                    type="checkbox"
                    aria-describedby={profileMemoryHintId}
                    checked={profileSavedMemory}
                    onChange={(event) => setProfileSavedMemory(event.target.checked)}
                    className="size-4 shrink-0 accent-foreground"
                  />
                </label>
                <p id={profileMemoryHintId} className="text-xs leading-relaxed text-muted-foreground">
                  {t("끄면 새 요청에서 저장된 기억의 읽기와 쓰기를 멈춥니다. 대화 기록과 기존 기억은 기기에 남습니다.", "Turn off to stop reading and updating saved memory for new requests. Your chat history and existing memory stay on this device.")}
                </p>
              </div>
            </fieldset>
            {profileSaveError && <p className="jarvis-auth-error" role="alert">{saveError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProfileOpen(false)} disabled={profileSaving}>
                {t("취소", "Cancel")}
              </Button>
              <Button type="submit" disabled={profileSaving}>
                {profileSaving ? t("저장 중…", "Saving…") : t("저장", "Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Sidebar
        {...props}
        mobileTitle={t("대화", "Conversations")}
        closeLabel={t("사이드바 닫기", "Close sidebar")}
        className="jarvis-sidebar bg-sidebar text-sidebar-foreground [--sidebar-width:16rem]"
      >
        <SidebarHeader className="border-none px-3 pt-3 pb-0">
          {onOpenModelSettings && (
            <button type="button" className="jarvis-sidebar-control" aria-haspopup="dialog"
              onClick={(event) => onOpenModelSettings(event.currentTarget)}>
              <Settings2Icon className="size-4 shrink-0" aria-hidden="true" />
              <span>{t("모델 설정", "Model settings")}</span>
            </button>
          )}
          <VoiceOutputSettingsButton />

          <div className="flex flex-col gap-0.5">
            <Button
              variant="ghost"
              onClick={() => void startNewChat()}
              className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 text-foreground hover:bg-zinc-100 dark:hover:bg-[#212121]"
            >
              <EditIcon className="size-4.5 text-foreground/85" />
              <span className="font-medium text-[15px]">{t("새 채팅", "New Chat")}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void startNewChat(true)}
              className="jarvis-sidebar-control"
            >
              <HistoryIcon className="size-4.5" aria-hidden="true" />
              {t("임시 채팅", "Temporary Chat")}
            </Button>
 
             <Button
               variant="ghost"
               onClick={() => setSearchOpen(true)}
               className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 text-foreground hover:bg-zinc-100 dark:hover:bg-[#212121]"
             >
               <SearchIcon className="size-4.5 text-foreground/85" />
               <span className="font-medium text-[15px]">{t("채팅 검색", "Search")}</span>
             </Button>
 
             <Button
               variant="ghost"
               disabled={!computerControlEnabled}
               onClick={() => void openLauncher()}
               className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 text-foreground hover:bg-zinc-100 dark:hover:bg-[#212121]"
             >
               <MoreHorizontalIcon className="size-4.5 text-foreground/85" />
               <span className="font-medium text-[15px]">{t("앱 열기", "Open apps")}</span>
             </Button>
          </div>
        </SidebarHeader>

        <SidebarContent className="scrollbar-none px-3 py-2">
          <div className="mt-4 mb-1 flex items-center justify-between px-3">
            <p className="font-semibold text-foreground/72 text-xs uppercase tracking-wider dark:text-muted-foreground/80">
              {t("프로젝트", "Projects")}
            </p>
            {selectedProject && (
              <button
                type="button"
                onClick={() => setSelectedProjectId(null)}
                className="text-[11px] text-foreground/62 hover:text-foreground dark:text-zinc-500 dark:hover:text-zinc-300"
              >
                {t("전체 보기", "View All")}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-0.5">
            <Button
              variant="ghost"
              onClick={() => setProjectDialogOpen(true)}
              className="flex items-center justify-start gap-3 rounded-lg px-3 py-5 text-foreground hover:bg-zinc-100 dark:hover:bg-[#212121]"
            >
              <FolderPlusIcon className="size-4.5 text-foreground/85" />
              <span className="font-medium text-sm">{t("새 프로젝트", "New Project")}</span>
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
                      "flex items-center justify-start gap-3 rounded-lg px-3 py-5 text-foreground transition-colors hover:bg-zinc-100 dark:hover:bg-[#212121]",
                      selectedProjectId === project.id &&
                        "bg-zinc-900 text-white dark:bg-[#252525]",
                    )}
                  >
                      <FolderIcon className="size-4.5 text-foreground/55 dark:text-zinc-400" />
                    <span className="flex-1 truncate text-left font-medium text-sm">
                      {project.name}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/72 dark:bg-zinc-800 dark:text-zinc-400">
                      {chatCount}
                    </span>
                  </Button>
                );
              })
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {t("프로젝트가 없습니다.", "No projects yet.")}
              </p>
            )}
          </div>

          <div className="mt-6 mb-1 px-3">
            <p className="font-semibold text-foreground/72 text-xs uppercase tracking-wider dark:text-muted-foreground/80">
              {t("최근 대화", "Recent")} {selectedProject ? `· ${selectedProject.name}` : ""}
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
                    "group relative flex items-center justify-start overflow-hidden rounded-lg px-3 py-5 text-left text-foreground transition-colors",
                    thread.id === threadsState.mainThreadId
                      ? "bg-zinc-900 text-white dark:bg-[#2f2f2f]"
                      : "hover:bg-zinc-100 dark:hover:bg-[#212121]",
                  )}
                >
                  <span className="flex-1 truncate font-medium text-sm">
                    {history.get(thread.remoteId ?? thread.id)?.title || thread.title || t("새 채팅", "New Chat")}
                  </span>
                </Button>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {t("대화 기록이 없습니다.", "No recent threads.")}
              </p>
            )}
          </div>

        </SidebarContent>

        <SidebarFooter className="border-none px-3 pt-2 pb-3">
          <div className="flex items-center gap-2">
            <Button
              ref={profileTrigger}
              aria-haspopup="dialog"
              variant="ghost"
              onClick={() => {
                if (authUser) {
                  setProfileDraftName(history.profile.name);
                  setProfileAutoSync(history.cloudSync);
                  setProfileSavedMemory(history.profile.savedMemory);
                  setProfileDraftLanguage(history.profile.language);
                  setProfileSaveError(false);
                  setProfileOpen(true);
                } else {
                  setLoginOpen(true);
                }
              }}
              className="flex min-w-0 flex-1 items-center justify-start gap-3 rounded-xl px-2 py-6 text-foreground hover:bg-zinc-100 dark:hover:bg-[#212121]"
              disabled={languageSaving}
            >
              <div className="flex size-8 items-center justify-center rounded-full bg-zinc-700 font-bold text-sm text-white dark:bg-zinc-700">
                {userDisplayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex min-w-0 flex-1 flex-col items-start text-left">
                <span className="truncate font-semibold text-sm text-foreground dark:text-white">
                  {userDisplayName}
                </span>
                <span
                  className={cn(
                    "truncate text-xs font-medium",
                    authUser
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-foreground/62 dark:text-muted-foreground",
                  )}
                >
                  {userSubLabel}
                </span>
              </div>
              <UserRoundIcon className="size-4 text-foreground/75 dark:text-zinc-500" />
            </Button>

            {authUser && (
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={logoutPending}
                onClick={() => void handleLogout()}
                className="shrink-0 rounded-xl text-foreground/75 hover:bg-zinc-100 hover:text-foreground dark:text-zinc-500 dark:hover:bg-[#212121] dark:hover:text-white"
                title={t("로그아웃", "Logout")}
              >
                <LogOutIcon className="size-4" />
              </Button>
            )}
          </div>

          {logoutError && (
            <p role="alert" className="mt-1 px-2 text-xs text-destructive">
              {t("저장된 로그인 정보를 지우지 못했습니다. 로그아웃을 다시 시도하세요.", "Couldn’t clear the saved session. Try signing out again.")}
            </p>
          )}
          <div className="mt-2 flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <MonitorIcon className="size-3.5" />
                {t("언어 모드", "Language")}
              </span>
              <div className="flex gap-1">
                {WORKSPACE_LANGUAGES.map((lang) => (
                  <button
                    type="button"
                    key={lang}
                    aria-pressed={history.profile.language === lang}
                    disabled={languageSaving}
                    onClick={() => void handleSaveLanguage(lang)}
                    className={cn(
                      "min-h-7 rounded px-1.5 text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                      history.profile.language === lang
                        ? "bg-sidebar-accent font-semibold"
                        : "hover:bg-sidebar-accent"
                    )}
                  >
                    {languageLabels[lang]}
                  </button>
                ))}
              </div>
            </div>
            {languageSaveError && <p className="jarvis-auth-error" role="alert">{saveError}</p>}

          </div>
        </SidebarFooter>
      </Sidebar>
    </>
  );
}
