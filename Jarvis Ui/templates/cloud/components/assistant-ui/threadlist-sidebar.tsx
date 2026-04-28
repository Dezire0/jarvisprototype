"use client";

import type * as React from "react";
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
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

const API_BASE = "https://jarvis-auth-service.dexproject.workers.dev";
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

type ConversationProvider =
  | "auto"
  | "openai"
  | "openai-cli"
  | "anthropic"
  | "claude-code"
  | "gemini"
  | "gemini-cli"
  | "ollama";
type StoredConversationProvider = ConversationProvider | "openai-compatible";

type ConversationModelSettingsView = {
  provider?: StoredConversationProvider;
  openai?: {
    configured?: boolean;
    model?: string;
    baseUrl?: string;
  };
  anthropic?: {
    configured?: boolean;
    model?: string;
    baseUrl?: string;
  };
  gemini?: {
    configured?: boolean;
    model?: string;
  };
  ollama?: {
    model?: string;
    url?: string;
  };
  web?: {
    provider?: string;
    model?: string;
  };
};

const OPENAI_MODEL_OPTIONS = [
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o-mini",
  "gpt-4o",
];

const ANTHROPIC_MODEL_OPTIONS = [
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
];

const GEMINI_MODEL_OPTIONS = [
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-1.5-flash-latest",
];

const WEB_MODEL_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  chatgpt: [
    { value: "chatgpt-auto", label: "ChatGPT 자동 선택" },
    { value: "chatgpt-instant", label: "ChatGPT Instant" },
    { value: "chatgpt-thinking", label: "ChatGPT Thinking" },
    { value: "chatgpt-pro", label: "ChatGPT Pro" },
  ],
  gemini: [
    { value: "gemini-3-pro-preview", label: "gemini-3-pro-preview" },
    { value: "gemini-3-flash-preview", label: "gemini-3-flash-preview" },
    { value: "gemini-2.5-flash", label: "gemini-2.5-flash" },
    { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
    { value: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite" },
    { value: "gemini-1.5-flash-latest", label: "gemini-1.5-flash-latest" },
  ],
  claude: [
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
  ],
};

function getWebModelOptions(provider?: string | null) {
  return WEB_MODEL_OPTIONS[provider || ""] || [{ value: "auto", label: "자동 선택" }];
}

function getWebProviderLabel(provider?: string | null) {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "gemini") return "Gemini";
  if (provider === "claude") return "Claude";
  return "사이트 로그인";
}

function getConversationProviderLabel(provider?: ConversationProvider | StoredConversationProvider | null) {
  if (provider === "openai" || provider === "openai-compatible") return "GPT";
  if (provider === "openai-cli") return "Codex CLI";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "claude-code") return "Claude Code";
  if (provider === "gemini") return "Gemini";
  if (provider === "gemini-cli") return "Gemini CLI";
  if (provider === "ollama") return "Ollama";
  return "WebUI";
}

function withSelectedModelOption(options: string[], selectedModel: string) {
  const selected = selectedModel.trim();
  return selected ? [...new Set([selected, ...options])] : options;
}

function normalizeConversationProviderForUi(provider?: string | null): ConversationProvider {
  if (provider === "openai-compatible") {
    return "openai";
  }

  if (
    provider === "auto" ||
    provider === "openai" ||
    provider === "openai-cli" ||
    provider === "anthropic" ||
    provider === "claude-code" ||
    provider === "gemini" ||
    provider === "gemini-cli" ||
    provider === "ollama"
  ) {
    return provider;
  }

  return "auto";
}

function getConversationModelSummary(settings?: ConversationModelSettingsView | null) {
  const provider = normalizeConversationProviderForUi(settings?.provider);

  if (provider === "openai") {
    return `GPT / ${settings?.openai?.model || "gpt-4o-mini"}`;
  }
  if (provider === "openai-cli") {
    return `Codex CLI / ${settings?.openai?.model || "gpt-4o-mini"}`;
  }
  if (provider === "anthropic") {
    return `Anthropic / ${settings?.anthropic?.model || "claude-haiku-4-5"}`;
  }
  if (provider === "claude-code") {
    return `Claude Code / ${settings?.anthropic?.model || "claude-haiku-4-5"}`;
  }
  if (provider === "gemini") {
    return `Gemini / ${settings?.gemini?.model || "gemini-2.5-flash"}`;
  }
  if (provider === "gemini-cli") {
    return `Gemini CLI / ${settings?.gemini?.model || "gemini-2.5-flash"}`;
  }
  if (provider === "ollama") {
    return `Ollama / ${settings?.ollama?.model || "qwen3:14b"}`;
  }
  if (provider === "auto" && settings?.web?.provider) {
    const option = getWebModelOptions(settings.web.provider).find(
      (item) => item.value === settings.web?.model,
    );
    return `사이트 로그인 / ${settings.web.provider} / ${option?.label || settings.web.model || "자동 선택"}`;
  }

  return "사이트 로그인 / WebUI 우선";
}

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
  const [selectedWebAiProvider, setSelectedWebAiProvider] = useState<string | null>(null);
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
  const [profileLanguage, setProfileLanguage] = useState<"auto" | "ko" | "en">("auto");
  const [conversationSettings, setConversationSettings] =
    useState<ConversationModelSettingsView | null>(null);
  const [conversationProvider, setConversationProvider] =
    useState<ConversationProvider>("auto");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("claude-haiku-4-5");
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash");
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [ollamaModel, setOllamaModel] = useState("qwen2.5:14b");
  const [webModel, setWebModel] = useState("auto");
  const webModelRef = useRef("auto");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [conversationSaving, setConversationSaving] = useState(false);
  const [conversationStatus, setConversationStatus] = useState("");
  const profileNameInputId = useId();

  const isKo = profileLanguage === "ko" || (profileLanguage === "auto" && typeof navigator !== "undefined" && navigator.language.startsWith("ko"));

  const t = (ko: string, en: string) => (isKo ? ko : en);

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
  const openaiModelOptions = useMemo(
    () => withSelectedModelOption(OPENAI_MODEL_OPTIONS, openaiModel),
    [openaiModel],
  );
  const anthropicModelOptions = useMemo(
    () => ANTHROPIC_MODEL_OPTIONS,
    [],
  );
  const geminiModelOptions = useMemo(
    () => withSelectedModelOption(GEMINI_MODEL_OPTIONS, geminiModel),
    [geminiModel],
  );
  const ollamaModelOptions = useMemo(
    () => withSelectedModelOption(ollamaModels, ollamaModel),
    [ollamaModel, ollamaModels],
  );
  const activeWebModelProvider = webAiProvider || selectedWebAiProvider || conversationSettings?.web?.provider || null;
  const connectedWebModelProvider =
    webAiStatus === "connected" ? activeWebModelProvider : null;
  const hasConnectedWebAi = Boolean(connectedWebModelProvider);
  const webModelOptions = useMemo(
    () => getWebModelOptions(connectedWebModelProvider),
    [connectedWebModelProvider],
  );
  const activeWebProviderLabel = getWebProviderLabel(connectedWebModelProvider);

  useEffect(() => {
    webModelRef.current = webModel;
  }, [webModel]);

  useEffect(() => {
    if (!connectedWebModelProvider) {
      return;
    }

    if (!webModelOptions.some((option) => option.value === webModel)) {
      const fallbackWebModel = webModelOptions[0]?.value || "auto";
      webModelRef.current = fallbackWebModel;
      setWebModel(fallbackWebModel);
    }
  }, [connectedWebModelProvider, webModel, webModelOptions]);

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
        setProfileLanguage(session.user.settings?.language || "auto");
      }
      if (session.token) {
        void hydrateCloudIndex(session.token);
      }
    })();

    void checkWebAiStatus(true);
    void loadConversationModelSettings();
    const interval = window.setInterval(() => {
      void checkWebAiStatus(false);
    }, 15000);

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
      window.clearInterval(interval);
      unsubscribeUpdate?.();
    };
  }, []);

  useEffect(() => {
    if (!webAiModalOpen) {
      return;
    }

    void loadConversationModelSettings();
  }, [webAiModalOpen]);

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

  async function checkWebAiStatus(forceRefresh = false, preferredProvider = selectedWebAiProvider) {
    if (typeof window === "undefined" || !(window as any).assistantAPI?.invokeTool) {
      setWebAiStatus("disconnected");
      return;
    }

    try {
      const result = (await (window as any).assistantAPI.invokeTool("ai:web-status", {
        forceRefresh,
        provider: preferredProvider || undefined,
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
    if (typeof window === "undefined" || !(window as any).assistantAPI?.invokeTool) {
      return;
    }

    setWebAiStatus("checking");
    setSelectedWebAiProvider(provider);
    try {
      const result = (await (window as any).assistantAPI.invokeTool("ai:web-login", {
        provider: provider,
      })) as {
        ok?: boolean;
        provider?: string | null;
      };
      if (result?.ok) {
        const connectedProvider = result.provider || provider;
        const nextWebModel = getWebModelOptions(connectedProvider)[0]?.value || "auto";
        setConversationProvider("auto");
        webModelRef.current = nextWebModel;
        setWebModel(nextWebModel);
        await saveConversationModelSettings("auto", {
          provider: connectedProvider,
          model: nextWebModel,
        });
      }
      await checkWebAiStatus(true, provider);
    } catch {
      setWebAiStatus("disconnected");
    }
  }

  function syncConversationModelSettings(settings?: ConversationModelSettingsView | null) {
    const next = settings || {};
    setConversationSettings(next);
    setConversationProvider(normalizeConversationProviderForUi(next.provider));
    setOpenaiModel(next.openai?.model || "gpt-4o-mini");
    setOpenaiBaseUrl(next.openai?.baseUrl || "");
    const nextAnthropicModel = next.anthropic?.model || "claude-haiku-4-5";
    setAnthropicModel(
      ANTHROPIC_MODEL_OPTIONS.includes(nextAnthropicModel)
        ? nextAnthropicModel
        : "claude-haiku-4-5",
    );
    setAnthropicBaseUrl(next.anthropic?.baseUrl || "");
    setGeminiModel(next.gemini?.model || "gemini-2.5-flash");
    setOllamaUrl(next.ollama?.url || "http://127.0.0.1:11434");
    setOllamaModel(next.ollama?.model || "qwen2.5:14b");
    const nextWebModel = next.web?.model || "auto";
    webModelRef.current = nextWebModel;
    setWebModel(nextWebModel);
    if (next.web?.provider) {
      setSelectedWebAiProvider(next.web.provider);
    }
    setOpenaiApiKey("");
    setAnthropicApiKey("");
    setGeminiApiKey("");
  }

  async function loadConversationModelSettings() {
    if (typeof window === "undefined" || !(window as any).assistantAPI) {
      return;
    }

    try {
      const result = (await (window as any).assistantAPI.getConversationModelSettings?.()) as {
        settings?: ConversationModelSettingsView;
      };
      syncConversationModelSettings(result?.settings);
    } catch {
      setConversationStatus(t("대화 모델 설정을 불러오지 못했어요.", "Could not load model settings."));
    }
  }

  async function refreshOllamaModels(forceRefresh = false) {
    if (typeof window === "undefined" || !(window as any).assistantAPI?.invokeTool) {
      return;
    }

    setOllamaLoading(true);
    try {
      const result = (await (window as any).assistantAPI.invokeTool("ai:ollama-models", {
        forceRefresh,
        url: ollamaUrl,
      })) as {
        models?: string[];
      };
      const models = Array.isArray(result?.models) ? result.models : [];
      setOllamaModels(models);
      if (models.length > 0 && !models.includes(ollamaModel)) {
        setOllamaModel(models[0]);
      }
      setConversationStatus(
        models.length > 0
          ? t("Ollama 모델 목록을 불러왔어요.", "Loaded Ollama models.")
          : t("Ollama에서 설치된 모델을 찾지 못했어요.", "No installed Ollama models were found."),
      );
    } catch {
      setOllamaModels([]);
      setConversationStatus(
        t(
          "Ollama에 연결하지 못했어요. Ollama 실행 상태와 주소를 확인해 주세요.",
          "Could not connect to Ollama. Check that Ollama is running and the URL is correct.",
        ),
      );
    } finally {
      setOllamaLoading(false);
    }
  }

  function handleConversationProviderChange(provider: ConversationProvider) {
    setConversationProvider(provider);

    if (provider === "ollama") {
      void refreshOllamaModels(false);
    }
  }

  function handleWebModelChange(model: string) {
    webModelRef.current = model;
    setConversationProvider("auto");
    setWebModel(model);
  }

  async function saveConversationModelSettings(
    provider = conversationProvider,
    webOverride?: { provider?: string | null; model?: string },
  ) {
    if (typeof window === "undefined" || !(window as any).assistantAPI?.saveConversationModelSettings) {
      return;
    }

    setConversationSaving(true);
    setConversationStatus("");
    const nextWebProvider = webOverride?.provider ?? connectedWebModelProvider ?? "";
    const nextWebModel = webOverride?.model ?? webModelRef.current;

    try {
      const result = (await (window as any).assistantAPI.saveConversationModelSettings({
        provider,
        openai: {
          apiKey: openaiApiKey,
          model: openaiModel,
          baseUrl: openaiBaseUrl,
        },
        anthropic: {
          apiKey: anthropicApiKey,
          model: anthropicModel,
          baseUrl: anthropicBaseUrl,
        },
        gemini: {
          apiKey: geminiApiKey,
          model: geminiModel,
        },
        ollama: {
          model: ollamaModel,
          url: ollamaUrl,
        },
        web: {
          provider: nextWebProvider,
          model: nextWebModel,
        },
      })) as {
        settings?: ConversationModelSettingsView;
      };

      try {
        syncConversationModelSettings(result?.settings);
        const summarySettings = {
          ...(result?.settings || {}),
          provider: result?.settings?.provider || provider,
          web: {
            provider: result?.settings?.web?.provider ?? nextWebProvider,
            model: result?.settings?.web?.model ?? nextWebModel,
          },
        };
        const summary = getConversationModelSummary(summarySettings);
        setConversationStatus(
          t(
            `대화 모델 연결 설정을 저장했어요: ${summary}`,
            `Saved conversation model settings: ${summary}`,
          ),
        );
      } catch (uiError) {
        console.warn("Conversation settings were saved, but UI refresh failed:", uiError);
        setConversationStatus(t("저장했어요. 창을 다시 열면 최신 설정이 보입니다.", "Saved. Reopen this window to see the latest settings."));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error || "");
      console.error("Failed to save conversation model settings:", error);
      setConversationStatus(
        detail
          ? t(`저장하지 못했어요: ${detail}`, `Could not save settings: ${detail}`)
          : t("저장하지 못했어요. 설정을 확인해 주세요.", "Could not save settings."),
      );
    } finally {
      setConversationSaving(false);
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
        language: profileLanguage,
      },
    };

    setAuthUser(nextUser);
    await updateStoredAuthUser(nextUser);

    // Sync to Electron Settings
    if (typeof window !== "undefined" && (window as any).assistantAPI?.invokeTool) {
      await (window as any).assistantAPI.invokeTool("settings:update", {
        preferredLanguage: profileLanguage,
      });
    }

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
    authUser?.name?.trim() || authUser?.email?.split("@")[0] || t("로그인이 필요합니다", "Login Required");
  const userSubLabel = authUser
    ? authUser.settings?.autoSync
      ? t("동기화 활성화됨", "Sync Enabled")
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
        <DialogContent className="border-white/10 bg-[#171717] text-white sm:max-w-md">
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
        <DialogContent className="border-white/10 bg-[#171717] text-white sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("글로벌 채팅 검색", "Global Chat Search")}</DialogTitle>
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
                      {result.source === "local" ? t("로컬", "Local") : t("클라우드", "Cloud")}
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
        className="border-r-0 bg-sidebar text-sidebar-foreground [--sidebar-width:280px]"
      >
        <SidebarHeader className="border-none px-3 pt-3 pb-0">
          <button
            type="button"
            onClick={() => setWebAiModalOpen(true)}
            className={cn(
              "mb-2 flex w-full items-center gap-2 rounded-xl border border-white/5 px-3 py-2.5 text-left font-semibold text-xs transition-all",
              webAiStatus === "connected"
                ? "bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/25 hover:bg-emerald-500/18 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20 dark:hover:bg-emerald-500/20"
                : "bg-card/80 text-foreground/78 ring-1 ring-border hover:bg-accent hover:text-foreground dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700/30 dark:hover:bg-zinc-700/60 dark:hover:text-white",
              webAiStatus === "expired" &&
                "bg-amber-500/12 text-amber-700 ring-1 ring-amber-500/25 hover:bg-amber-500/18 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20 dark:hover:bg-amber-900/40",
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
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-1.5 py-0.5 font-bold text-[9px] uppercase tracking-wider",
                webAiStatus === "connected"
                  ? "bg-emerald-900/12 text-emerald-800 dark:bg-black/20 dark:text-emerald-300"
                  : "bg-foreground/8 text-foreground/75 dark:bg-black/20 dark:text-zinc-300"
              )}
            >
              {webAiStatus === "connected" ? "Connected" : "Setup"}
            </div>
          </button>

          {/* Web AI Management Modal */}
          <Dialog open={webAiModalOpen} onOpenChange={setWebAiModalOpen}>
            <DialogContent className="max-h-[86dvh] max-w-[560px] overflow-y-auto border-none bg-[#171717] p-0 text-white shadow-2xl">
              <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-500" />
              <div className="p-6">
                <DialogHeader className="mb-4">
                  <DialogTitle className="flex items-center gap-2 text-xl">
                    <SparklesIcon className="size-5 text-emerald-400" />
                    Web AI 관리
                  </DialogTitle>
                  <DialogDescription className="text-zinc-400">
                    사이트 계정 로그인, API 키, Ollama 로컬 모델을 여기서 연결합니다.
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
                        <p className="text-xs text-zinc-500">OpenAI 계정으로 Jarvis 연결</p>
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
                        <p className="text-xs text-zinc-500">Google 계정으로 Jarvis 연결</p>
                      </div>
                    </div>
                    {webAiProvider === "gemini" &&
                      webAiStatus === "connected" && (
                        <BadgeCheckIcon className="size-5 text-blue-400" />
                      )}
                  </button>

                  {/* Claude Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setWebAiModalOpen(false);
                      void connectWebAi("claude");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl border p-4 transition-all hover:scale-[1.02]",
                      webAiProvider === "claude" && webAiStatus === "connected"
                        ? "border-orange-500/50 bg-orange-500/10 ring-1 ring-orange-500/20"
                        : "border-white/5 bg-white/5 hover:bg-white/10",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 font-bold text-orange-300">
                        A
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-sm">Claude</p>
                        <p className="text-xs text-zinc-500">Anthropic 계정으로 Jarvis 연결</p>
                      </div>
                    </div>
                    {webAiProvider === "claude" &&
                      webAiStatus === "connected" && (
                        <BadgeCheckIcon className="size-5 text-orange-300" />
                      )}
                  </button>
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">대화 모델 연결</p>
                      <p className="text-xs text-zinc-500">
                        {hasConnectedWebAi
                          ? `${activeWebProviderLabel} 계정으로 사용할 모델을 선택합니다.`
                          : ["openai-cli", "gemini-cli", "claude-code"].includes(conversationProvider)
                            ? "로컬 CLI의 OAuth 로그인 상태를 사용합니다."
                            : "API 키는 기기 안에 암호화해서 저장됩니다."}
                      </p>
                    </div>
                    <span className="rounded-full bg-white/8 px-2 py-1 text-[10px] font-bold uppercase text-zinc-400">
                      {hasConnectedWebAi
                        ? activeWebProviderLabel
                        : getConversationProviderLabel(conversationProvider)}
                    </span>
                  </div>

                  {hasConnectedWebAi ? (
                    <div className="space-y-2">
                      <label className="block text-[11px] font-semibold text-zinc-500">
                        {activeWebProviderLabel} 모델 선택
                      </label>
                      <select
                        value={webModel}
                        onChange={(event) => handleWebModelChange(event.target.value)}
                        className="h-10 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
                      >
                        {webModelOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] leading-relaxed text-zinc-500">
                        위에서 로그인한 {activeWebProviderLabel} 계정으로 사용할 모델입니다.
                        API 키 설정은 숨기고 사이트 로그인 모델 설정만 저장합니다.
                      </p>
                      <div className="pt-2 text-[10px] text-zinc-500">
                        Web {activeWebProviderLabel}
                      </div>
                    </div>
                  ) : (
                    <>
                      <label className="mb-3 block text-[11px] font-semibold text-zinc-500">
                        모델 선택
                      </label>
                      <select
                        value={conversationProvider}
                        onChange={(event) =>
                          handleConversationProviderChange(event.target.value as ConversationProvider)
                        }
                        className="mb-4 h-10 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
                      >
                        <option value="auto">사이트 로그인 / WebUI 우선</option>
                        <option value="openai">GPT / OpenAI API</option>
                        <option value="openai-cli">GPT / Codex CLI OAuth</option>
                        <option value="anthropic">Anthropic API</option>
                        <option value="claude-code">Claude Code CLI OAuth</option>
                        <option value="gemini">Gemini API</option>
                        <option value="gemini-cli">Gemini CLI OAuth</option>
                        <option value="ollama">로컬 모델 / Ollama</option>
                      </select>

                  {conversationProvider === "openai" && (
                    <div className="space-y-2">
                      <Input
                        type="password"
                        value={openaiApiKey}
                        onChange={(event) => setOpenaiApiKey(event.target.value)}
                        placeholder={
                          conversationSettings?.openai?.configured
                            ? "OpenAI API Key 저장됨 - 변경할 때만 입력"
                            : "OpenAI API Key"
                        }
                        className="h-10 rounded-xl border-white/10 bg-zinc-950 text-white"
                      />
                      <select
                        value={openaiModel}
                        onChange={(event) => setOpenaiModel(event.target.value)}
                        className="h-10 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
                      >
                        {openaiModelOptions.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={openaiBaseUrl}
                        onChange={(event) => setOpenaiBaseUrl(event.target.value)}
                        placeholder="Base URL 선택 사항"
                        className="h-10 rounded-xl border-white/10 bg-zinc-950 text-white"
                      />
                    </div>
                  )}

                  {conversationProvider === "openai-cli" && (
                    <div className="space-y-2">
                      <select
                        value={openaiModel}
                        onChange={(event) => setOpenaiModel(event.target.value)}
                        className="h-10 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
                      >
                        {openaiModelOptions.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                      <p className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-xs leading-relaxed text-zinc-500">
                        로컬 Codex CLI를 `codex exec` 모드로 호출합니다.
                        OpenAI API 키는 저장하지 않고, Codex CLI의 로그인 상태를 그대로 사용합니다.
                        먼저 Codex CLI에서 `codex login`을 완료해 주세요.
                      </p>
                    </div>
                  )}

                  {conversationProvider === "anthropic" && (
                    <div className="space-y-2">
                      <Input
                        type="password"
                        value={anthropicApiKey}
                        onChange={(event) => setAnthropicApiKey(event.target.value)}
                        placeholder={
                          conversationSettings?.anthropic?.configured
                            ? "Anthropic API Key 저장됨 - 변경할 때만 입력"
                            : "Anthropic API Key"
                        }
                        className="h-10 rounded-xl border-white/10 bg-zinc-950 text-white"
                      />
                      <select
                        value={anthropicModel}
                        onChange={(event) => setAnthropicModel(event.target.value)}
                        className="h-10 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
                      >
                        {anthropicModelOptions.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                      <Input
                        value={anthropicBaseUrl}
                        onChange={(event) => setAnthropicBaseUrl(event.target.value)}
                        placeholder="Base URL 선택 사항"
                        className="h-10 rounded-xl border-white/10 bg-zinc-950 text-white"
                      />
                    </div>
                  )}

                  {conversationProvider === "claude-code" && (
                    <div className="space-y-2">
                      <select
                        value={anthropicModel}
                        onChange={(event) => setAnthropicModel(event.target.value)}
                        className="h-10 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
                      >
                        {anthropicModelOptions.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                      <p className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-xs leading-relaxed text-zinc-500">
                        로컬에 설치된 Claude Code CLI를 `claude -p` 모드로 호출합니다.
                        Anthropic API 키는 저장하지 않고, Claude Code의 OAuth 로그인 상태를 그대로 사용합니다.
                        먼저 Claude Code를 설치하고 `claude auth login` 또는 `claude`로 로그인해 주세요.
                      </p>
                    </div>
                  )}

                  {conversationProvider === "auto" && (
                    <div className="space-y-2">
                      {connectedWebModelProvider ? (
                        <>
                          <p className="text-[11px] font-semibold text-zinc-500">
                            {activeWebProviderLabel} 사이트 모델
                          </p>
                          <select
                            value={webModel}
                            onChange={(event) => handleWebModelChange(event.target.value)}
                            className="h-10 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
                          >
                            {webModelOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <p className="text-[11px] leading-relaxed text-zinc-500">
                            사이트 로그인 모델은 연결된 계정의 웹 모델 선택 UI를 자동으로 맞춥니다.
                            실제 사용 가능 모델은 계정 요금제와 사이트 상태에 따라 달라질 수 있어요.
                          </p>
                        </>
                      ) : (
                        <p className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-xs leading-relaxed text-zinc-500">
                          위에서 ChatGPT, Gemini, Claude 계정을 연결하면 해당 회사의 모델 선택지가 여기에 표시됩니다.
                        </p>
                      )}
                    </div>
                  )}

                  {conversationProvider === "gemini" && (
                    <div className="space-y-2">
                      <Input
                        type="password"
                        value={geminiApiKey}
                        onChange={(event) => setGeminiApiKey(event.target.value)}
                        placeholder={
                          conversationSettings?.gemini?.configured
                            ? "Gemini API Key 저장됨 - 변경할 때만 입력"
                            : "Gemini API Key"
                        }
                        className="h-10 rounded-xl border-white/10 bg-zinc-950 text-white"
                      />
                      <select
                        value={geminiModel}
                        onChange={(event) => setGeminiModel(event.target.value)}
                        className="h-10 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
                      >
                        {geminiModelOptions.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {conversationProvider === "gemini-cli" && (
                    <div className="space-y-2">
                      <select
                        value={geminiModel}
                        onChange={(event) => setGeminiModel(event.target.value)}
                        className="h-10 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
                      >
                        {geminiModelOptions.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                      <p className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-xs leading-relaxed text-zinc-500">
                        로컬 Gemini CLI를 `gemini -p` 모드로 호출합니다.
                        Gemini API 키는 저장하지 않고, Gemini CLI의 Google 로그인 상태를 그대로 사용합니다.
                        먼저 Gemini CLI를 설치하고 `gemini`로 로그인해 주세요.
                      </p>
                    </div>
                  )}

                  {conversationProvider === "ollama" && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input
                          value={ollamaUrl}
                          onChange={(event) => setOllamaUrl(event.target.value)}
                          placeholder="http://127.0.0.1:11434"
                          className="h-10 rounded-xl border-white/10 bg-zinc-950 text-white"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={ollamaLoading}
                          onClick={() => void refreshOllamaModels(true)}
                          className="h-10 shrink-0 rounded-xl border-white/10 bg-white/5 text-white hover:bg-white/10"
                        >
                          <RefreshCwIcon
                            className={cn("size-4", ollamaLoading && "animate-spin")}
                          />
                        </Button>
                      </div>
                      <select
                        value={ollamaModel}
                        onChange={(event) => setOllamaModel(event.target.value)}
                        className="h-10 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
                      >
                        {ollamaModelOptions.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] text-zinc-500 sm:grid-cols-4">
                    <span>
                      Web {connectedWebModelProvider ? activeWebProviderLabel : "미연결"}
                    </span>
                    <span>
                      GPT {conversationSettings?.openai?.configured ? "저장됨" : "미설정"}
                    </span>
                    <span>
                      Anthropic {conversationSettings?.anthropic?.configured ? "저장됨" : "미설정"}
                    </span>
                    <span>
                      Gemini {conversationSettings?.gemini?.configured ? "저장됨" : "미설정"}
                    </span>
                  </div>
                    </>
                  )}

                  {conversationStatus && (
                    <p className="mt-3 text-xs text-emerald-300">{conversationStatus}</p>
                  )}

                  <Button
                    type="button"
                    disabled={conversationSaving}
                    onClick={() =>
                      void saveConversationModelSettings(
                        hasConnectedWebAi ? "auto" : conversationProvider,
                        hasConnectedWebAi
                          ? { provider: connectedWebModelProvider, model: webModelRef.current }
                          : undefined,
                      )
                    }
                    className="mt-4 h-10 w-full rounded-xl bg-white font-semibold text-black hover:bg-zinc-200"
                  >
                    {conversationSaving
                      ? t("저장 중...", "Saving...")
                      : t("모델 연결 저장", "Save Model Connection")}
                  </Button>
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
                    {t("연결 해제하기", "Disconnect")}
                  </Button>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {webAiReason && webAiStatus === "expired" && (
            <p className="mb-2 px-1 text-[11px] text-amber-700/90 dark:text-amber-300/80">
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
              <span className="font-medium text-[15px]">{t("새 채팅", "New Chat")}</span>
            </Button>
 
             <Button
               variant="ghost"
               onClick={() => setSearchOpen(true)}
               className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 hover:bg-[#212121]"
             >
               <SearchIcon className="size-4.5" />
               <span className="font-medium text-[15px]">{t("채팅 검색", "Search")}</span>
             </Button>
 
             <Button
               variant="ghost"
               onClick={() => void openLauncher()}
               className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 hover:bg-[#212121]"
             >
               <MoreHorizontalIcon className="size-4.5" />
               <span className="font-medium text-[15px]">{t("더 보기", "More")}</span>
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
              className="flex items-center justify-start gap-3 rounded-lg px-3 py-5 hover:bg-[#212121]"
            >
              <FolderPlusIcon className="size-4.5" />
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
                      "flex items-center justify-start gap-3 rounded-lg px-3 py-5 transition-colors hover:bg-[#212121]",
                      selectedProjectId === project.id && "bg-[#252525]",
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
              <div className="mx-3 rounded-xl border border-border bg-card/70 px-4 py-5 text-center text-sm font-medium text-foreground/68 dark:border-white/5 dark:bg-white/[0.02] dark:text-zinc-500">
                {t("프로젝트가 없습니다.", "No projects yet.")}
              </div>
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
                    "group relative flex items-center justify-start overflow-hidden rounded-lg px-3 py-5 text-left transition-colors",
                    thread.id === threadsState.mainThreadId
                      ? "bg-[#2f2f2f] text-white"
                      : "hover:bg-[#212121]",
                  )}
                >
                  <span className="flex-1 truncate font-medium text-sm">
                    {thread.title || t("새 채팅", "New Chat")}
                  </span>
                </Button>
              ))
            ) : (
              <div className="mx-3 rounded-xl border border-border bg-card/70 px-4 py-5 text-center text-sm font-medium text-foreground/68 dark:border-white/5 dark:bg-white/[0.02] dark:text-zinc-500">
                {t("대화 기록이 없습니다.", "No recent threads.")}
              </div>
            )}
          </div>

          {authUser && (
            <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-4 dark:border-emerald-500/10 dark:bg-emerald-500/[0.03]">
              <div className="flex items-center gap-2 font-semibold text-emerald-700 text-[11px] uppercase tracking-tight dark:text-emerald-500/80">
                <BadgeCheckIcon className="size-3.5" />
                <span>{t("동기화 활성화됨", "Cloud Sync Active")}</span>
              </div>
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
              <UserRoundIcon className="size-4 text-foreground/55 dark:text-zinc-500" />
            </Button>

            {authUser && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void handleLogout()}
                className="shrink-0 rounded-xl text-foreground/55 hover:bg-accent hover:text-foreground dark:text-zinc-500 dark:hover:bg-[#212121] dark:hover:text-white"
                title={t("로그아웃", "Logout")}
              >
                <LogOutIcon className="size-4" />
              </Button>
            )}
          </div>

          <div className="mt-2 flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-1">
                <MonitorIcon className="size-3.5" />
                {t("언어 모드", "Language")}
              </span>
              <div className="flex gap-1">
                {(["auto", "ko", "en"] as const).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => {
                      setProfileLanguage(lang);
                      void (async () => {
                        if (typeof window !== "undefined" && (window as any).assistantAPI?.invokeTool) {
                          await (window as any).assistantAPI.invokeTool("settings:update", {
                            preferredLanguage: lang,
                          });
                        }
                      })();
                    }}
                    className={cn(
                      "rounded px-1.5 py-0.5 uppercase transition-colors",
                      profileLanguage === lang 
                        ? "bg-white text-black font-bold" 
                        : "hover:bg-white/10"
                    )}
                  >
                    {lang === "auto" ? t("자동", "Auto") : lang}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-1">
                <RocketIcon className="size-3.5" />
                {t("새로고침", "Refresh Status")}
              </span>
              <button
                type="button"
                onClick={() => void checkWebAiStatus(true)}
                className="inline-flex items-center gap-1 text-zinc-500 hover:text-white"
              >
                <RefreshCwIcon className="size-3.5" />
              </button>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
    </>
  );
}
