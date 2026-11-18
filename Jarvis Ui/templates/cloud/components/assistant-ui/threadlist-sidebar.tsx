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
import type { SidebarHistory } from "@/lib/chat-history";
import { isWorkspaceLanguage, useWorkspaceLocale, WORKSPACE_LANGUAGES, type WorkspaceLanguage } from "@/lib/workspace-language";
import { LoginModal } from "@/components/jarvis/login-modal";
import { MacUpdateModal } from "@/components/jarvis/mac-update-modal";
import {
  clearAuthSession,
  persistAuthSession,
  restoreAuthSession,
  type AuthUser,
} from "@/components/jarvis/auth-session";
import {
  EditIcon,
  HistoryIcon,
  SearchIcon,
  MoreHorizontalIcon,
  FolderPlusIcon,
  FolderIcon,
  LogOutIcon,
  Link2Icon,
  Link2OffIcon,
  Settings2Icon,
  SparklesIcon,
  ShieldAlertIcon,
  RocketIcon,
  MonitorIcon,
  UserRoundIcon,
  RefreshCwIcon,
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

type ConversationProvider =
  | "auto"
  | "openai"
  | "groq"
  | "gemini"
  | "ollama";
type StoredConversationProvider = ConversationProvider | "openai-compatible";

type ConversationModelSettingsView = {
  provider?: StoredConversationProvider;
  groq?: {
    configured?: boolean;
    chatModel?: string;
    sttModel?: string;
  };
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
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o-mini",
  "gpt-4o",
];

const GEMINI_MODEL_OPTIONS = [
  "gemini-3-flash-preview",
  "gemini-3-pro-preview",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-1.5-flash-latest",
];

const GROQ_STT_MODEL_OPTIONS = [
  "whisper-large-v3-turbo",
  "whisper-large-v3",
  "distil-whisper-large-v3-en",
];

const GROQ_CHAT_MODEL_OPTIONS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3-32b",
  "groq/compound-mini",
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
};

function getWebModelOptions(provider?: string | null) {
  return WEB_MODEL_OPTIONS[provider || ""] || [{ value: "auto", label: "자동 선택" }];
}

function getWebProviderLabel(provider?: string | null) {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "gemini") return "Gemini";
  return "웹 로그인";
}

function getConversationProviderLabel(provider?: ConversationProvider | StoredConversationProvider | null) {
  if (provider === "openai" || provider === "openai-compatible") return "GPT";
  if (provider === "groq") return "Groq";
  if (provider === "gemini") return "Gemini";
  if (provider === "ollama") return "Ollama";
  return "자동 선택";
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
    provider === "groq" ||
    provider === "gemini" ||
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
  if (provider === "groq") {
    return `Groq / ${settings?.groq?.chatModel || "llama-3.3-70b-versatile"}`;
  }
  if (provider === "gemini") {
    return `Gemini / ${settings?.gemini?.model || "gemini-2.5-flash"}`;
  }
  if (provider === "ollama") {
    return `Ollama / ${settings?.ollama?.model || "qwen3:14b"}`;
  }
  return "자동 선택 / API 또는 Ollama";
}

function getConversationConnectionState(settings?: ConversationModelSettingsView | null) {
  const provider = normalizeConversationProviderForUi(settings?.provider);

  if (provider === "openai" && settings?.openai?.configured) {
    return { connected: true, label: "GPT", model: settings.openai?.model || "gpt-4o-mini" };
  }

  if (provider === "groq" && settings?.groq?.configured) {
    return { connected: true, label: "Groq", model: settings.groq?.chatModel || "llama-3.3-70b-versatile" };
  }

  if (provider === "gemini" && settings?.gemini?.configured) {
    return { connected: true, label: "Gemini", model: settings.gemini?.model || "gemini-2.5-flash" };
  }

  if (provider === "ollama") {
    return { connected: true, label: "Ollama", model: settings?.ollama?.model || "qwen3:14b" };
  }

  if (provider === "auto") {
    if (settings?.groq?.configured) {
      return { connected: true, label: "Groq", model: settings.groq?.chatModel || "llama-3.3-70b-versatile" };
    }

    if (settings?.gemini?.configured) {
      return { connected: true, label: "Gemini", model: settings.gemini?.model || "gemini-2.5-flash" };
    }

    if (settings?.openai?.configured) {
      return { connected: true, label: "GPT", model: settings.openai?.model || "gpt-4o-mini" };
    }
  }

  return { connected: false, label: "API", model: "" };
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
  const { isMobile, setOpenMobile } = useSidebar();
  const threadsState = useAuiState((state) => state.threads);
  const history = useChatHistory();
  const revision = useSyncExternalStore(history.subscribe, history.getRevision, history.getRevision);

  const [projects, setProjects] = useState<SidebarProject[]>(() => history.sidebar.projects);
  const [threadMetaById, setThreadMetaById] = useState<Record<string, StoredThreadMeta>>(() => history.sidebar.threadMetaById);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => history.sidebar.selectedProjectId);
  const [loginOpen, setLoginOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
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
  const [profileAutoSync, setProfileAutoSync] = useState(history.cloudSync);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState(false);
  const [profileDraftLanguage, setProfileDraftLanguage] = useState<WorkspaceLanguage>("auto");
  const [languageSaving, setLanguageSaving] = useState(false);
  const [languageSaveError, setLanguageSaveError] = useState(false);
  const [conversationSettings, setConversationSettings] =
    useState<ConversationModelSettingsView | null>(null);
  const [conversationProvider, setConversationProvider] =
    useState<ConversationProvider>("auto");
  const [groqApiKey, setGroqApiKey] = useState("");
  const [groqChatModel, setGroqChatModel] = useState("llama-3.3-70b-versatile");
  const [groqSttModel, setGroqSttModel] = useState("whisper-large-v3-turbo");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("");
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
  const openaiModelOptions = useMemo(
    () => withSelectedModelOption(OPENAI_MODEL_OPTIONS, openaiModel),
    [openaiModel],
  );
  const geminiModelOptions = useMemo(
    () => withSelectedModelOption(GEMINI_MODEL_OPTIONS, geminiModel),
    [geminiModel],
  );
  const groqSttModelOptions = useMemo(
    () => withSelectedModelOption(GROQ_STT_MODEL_OPTIONS, groqSttModel),
    [groqSttModel],
  );
  const groqChatModelOptions = useMemo(
    () => withSelectedModelOption(GROQ_CHAT_MODEL_OPTIONS, groqChatModel),
    [groqChatModel],
  );
  const ollamaModelOptions = useMemo(
    () => withSelectedModelOption(ollamaModels, ollamaModel),
    [ollamaModel, ollamaModels],
  );
  const activeWebModelProvider = webAiProvider || selectedWebAiProvider || conversationSettings?.web?.provider || null;
  const connectedWebModelProvider =
    webAiStatus === "connected" ? activeWebModelProvider : null;
  const hasConnectedWebAi = Boolean(connectedWebModelProvider);
  const conversationConnection = useMemo(
    () => getConversationConnectionState(conversationSettings),
    [conversationSettings],
  );
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
    void (async () => {
      const session = await restoreAuthSession();
      if (session.user?.id === history.accountId) {
        setAuthUser(session.user);
      }
      const cloudToken = history.cloudToken();
      if (cloudToken) void hydrateCloudIndex(cloudToken);
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

  async function checkWebAiStatus(forceRefresh = false, preferredProvider = selectedWebAiProvider) {
    void forceRefresh;
    void preferredProvider;
    setWebAiStatus("disconnected");
    setWebAiProvider(null);
    setWebAiReason("web_login_removed");
  }

  async function connectWebAi(provider: string = "chatgpt") {
    setWebAiStatus("disconnected");
    setSelectedWebAiProvider(provider);
    setWebAiProvider(null);
    setWebAiReason("web_login_removed");
  }

  function syncConversationModelSettings(settings?: ConversationModelSettingsView | null) {
    const next = settings || {};
    setConversationSettings(next);
    setConversationProvider(normalizeConversationProviderForUi(next.provider));
    setGroqChatModel(next.groq?.chatModel || "llama-3.3-70b-versatile");
    setGroqSttModel(next.groq?.sttModel || "whisper-large-v3-turbo");
    setOpenaiModel(next.openai?.model || "gpt-4o-mini");
    setOpenaiBaseUrl(next.openai?.baseUrl || "");
    setGeminiModel(next.gemini?.model || "gemini-2.5-flash");
    setOllamaUrl(next.ollama?.url || "http://127.0.0.1:11434");
    setOllamaModel(next.ollama?.model || "qwen2.5:14b");
    const nextWebModel = next.web?.model || "auto";
    webModelRef.current = nextWebModel;
    setWebModel(nextWebModel);
    if (next.web?.provider) {
      setSelectedWebAiProvider(next.web.provider);
    }
    setGroqApiKey("");
    setOpenaiApiKey("");
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
    void webOverride;

    try {
	      const result = (await (window as any).assistantAPI.saveConversationModelSettings({
	        provider,
        groq: {
          apiKey: groqApiKey,
          chatModel: groqChatModel,
          sttModel: groqSttModel,
        },
        openai: {
          apiKey: openaiApiKey,
          model: openaiModel,
          baseUrl: openaiBaseUrl,
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
          provider: "",
          model: "auto",
        },
      })) as {
        settings?: ConversationModelSettingsView;
	      };
	
	      try {
	        syncConversationModelSettings(result?.settings);
	        window.dispatchEvent(
	          new CustomEvent("jarvis:conversation-model-settings-saved", {
	            detail: result?.settings || null,
	          }),
	        );
	        const summarySettings = {
	          ...(result?.settings || {}),
          provider: result?.settings?.provider || provider,
          web: {
            provider: "",
            model: "auto",
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
    void persistAuthSession(token, user).then(() => hydrateCloudIndex(token));
  }

  async function handleLogout() {
    setAuthUser(null);
    setCloudSearchIndex({});
    setProfileOpen(false);
    await clearAuthSession();
  }

  async function handleSaveProfile() {
    if (!authUser || profileSaving) return;
    setProfileSaving(true);
    setProfileSaveError(false);
    const saved = await history.saveProfile({
      name: profileDraftName.trim(),
      language: profileDraftLanguage,
      cloudSync: profileAutoSync,
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
        className="jarvis-sidebar bg-sidebar text-sidebar-foreground [--sidebar-width:16rem]"
      >
        <SidebarHeader className="border-none px-3 pt-3 pb-0">
          <button
            type="button"
            onClick={() => setWebAiModalOpen(true)}
            className="jarvis-sidebar-control"
          >
            <Settings2Icon className="size-4 shrink-0" />
            <span className="flex-1 truncate">{t("모델 설정", "Model settings")}</span>
            {conversationConnection.connected && (
              <span className="truncate text-xs text-muted-foreground">
                {conversationConnection.label}
              </span>
            )}
          </button>

          {/* AI Model Management Modal */}
          <Dialog open={webAiModalOpen} onOpenChange={setWebAiModalOpen}>
            <DialogContent className="max-h-[86dvh] max-w-[560px] overflow-y-auto border-border bg-background p-0 text-foreground shadow-xl">
              <div className="p-6">
                <DialogHeader className="mb-4">
                  <DialogTitle className="flex items-center gap-2 text-xl">
                    <SparklesIcon className="size-5 text-muted-foreground" />
                    AI 모델 관리
                  </DialogTitle>
                  <DialogDescription className="text-zinc-400">
                    OpenAI API, Gemini API, Ollama를 연결하여 Jarvis를 사용할 수 있습니다.
                  </DialogDescription>
                </DialogHeader>

                <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">대화 모델 연결</p>
                      <p className="text-xs text-zinc-500">
                        {hasConnectedWebAi
                          ? `${activeWebProviderLabel} 계정으로 사용할 모델을 선택합니다.`
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
	                        <option value="auto">자동 선택 / API 우선</option>
	                        <option value="openai">GPT / OpenAI API</option>
	                        <option value="groq">Groq API</option>
	                        <option value="gemini">Gemini API</option>
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

	                  {conversationProvider === "auto" && (
	                    <div className="space-y-2">
	                      <p className="rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-xs leading-relaxed text-zinc-500">
	                        자동 선택은 Groq, Gemini, GPT 순서로 저장된 API 설정을 우선 사용하고, 원격 API가 연결되지 않은 경우 Ollama로 내려갑니다.
	                        웹 로그인 세션이나 사이트 토큰은 더 이상 사용하지 않아요.
	                      </p>
	                    </div>
	                  )}

	                  {conversationProvider === "groq" && (
	                    <div className="space-y-2">
	                      <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-xs leading-relaxed text-emerald-100">
	                        아래 Groq API 박스의 키와 채팅 모델을 사용합니다.
	                      </p>
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

                  <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] text-zinc-500 sm:grid-cols-3">
	                    <span>
	                      API-only 모드
	                    </span>
	                    <span>
	                      Groq {conversationSettings?.groq?.configured ? "저장됨" : "미설정"}
	                    </span>
                    <span>
                      GPT {conversationSettings?.openai?.configured ? "저장됨" : "미설정"}
                    </span>
                    <span>
                      Gemini {conversationSettings?.gemini?.configured ? "저장됨" : "미설정"}
                    </span>
                  </div>
	                    </>
	                  )}
	                </div>

		                <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
		                  <div className="mb-3 flex items-center justify-between gap-3">
		                    <div>
		                      <p className="text-sm font-bold">Groq API</p>
		                      <p className="text-xs text-zinc-400">
		                        대화 모델과 Electron 음성 입력에 사용할 Groq API 키를 저장합니다.
		                      </p>
		                    </div>
	                    <span className="rounded-full bg-emerald-950/70 px-2 py-1 text-[10px] font-bold uppercase text-emerald-300">
	                      {conversationSettings?.groq?.configured ? "Configured" : "Optional"}
	                    </span>
	                  </div>
	                  <div className="space-y-2">
	                    <Input
	                      type="password"
	                      value={groqApiKey}
	                      onChange={(event) => setGroqApiKey(event.target.value)}
	                      placeholder={
	                        conversationSettings?.groq?.configured
	                          ? "Groq API Key 저장됨 - 변경할 때만 입력"
	                          : "Groq API Key"
	                      }
	                      className="h-10 rounded-xl border-white/10 bg-zinc-950 text-white"
		                    />
		                    <label className="block text-[11px] font-semibold text-zinc-500">
		                      채팅 모델
		                    </label>
		                    <select
		                      value={groqChatModel}
		                      onChange={(event) => setGroqChatModel(event.target.value)}
		                      className="h-10 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
		                    >
		                      {groqChatModelOptions.map((model) => (
		                        <option key={model} value={model}>
		                          {model}
		                        </option>
		                      ))}
		                    </select>
		                    <label className="block text-[11px] font-semibold text-zinc-500">
		                      음성 인식 모델
		                    </label>
		                    <select
		                      value={groqSttModel}
		                      onChange={(event) => setGroqSttModel(event.target.value)}
	                      className="h-10 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-emerald-400"
	                    >
	                      {groqSttModelOptions.map((model) => (
	                        <option key={model} value={model}>
	                          {model}
	                        </option>
	                      ))}
		                    </select>
		                    <p className="text-[11px] leading-relaxed text-zinc-500">
		                      대화 모델에서 Groq API를 선택하면 위 채팅 모델로 응답하고, 음성 입력은 Groq Whisper를 우선 사용합니다.
		                    </p>
	                  </div>
	                </div>

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
               onClick={() => void openLauncher()}
               className="flex items-center justify-start gap-3 rounded-lg px-3 py-6 text-foreground hover:bg-zinc-100 dark:hover:bg-[#212121]"
             >
               <MoreHorizontalIcon className="size-4.5 text-foreground/85" />
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
                onClick={() => void handleLogout()}
                className="shrink-0 rounded-xl text-foreground/75 hover:bg-zinc-100 hover:text-foreground dark:text-zinc-500 dark:hover:bg-[#212121] dark:hover:text-white"
                title={t("로그아웃", "Logout")}
              >
                <LogOutIcon className="size-4" />
              </Button>
            )}
          </div>

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
