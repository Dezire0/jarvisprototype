"use client";

import { createContext, useContext, type ReactNode, useMemo, useState } from "react";

import { createAssistantStream } from "assistant-stream";
import { attachmentPrefix, createChatAttachmentAdapter, readAttachmentLabel, type AttachmentError } from "@/lib/chat-attachments";
import {
  AssistantRuntimeProvider,
  type AssistantTransportCommand,
  type AssistantTransportConnectionMetadata,
  type RemoteThreadListAdapter,
  useAssistantTransportRuntime,
  useRemoteThreadListRuntime,
  type ThreadMessage,
} from "@assistant-ui/react";

const TransportError = createContext<string | null>(null);
const FileError = createContext<{ error: AttachmentError | null; clear: () => void }>({
  error: null,
  clear: () => {},
});

export function useJarvisTransportError() {
  return useContext(TransportError);
}
export function useJarvisAttachmentError() {
  return useContext(FileError);
}

type TransportMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  status?: "running" | "complete";
  provider?: string;
  actions?: any[];
  details?: any;
  attachmentReview?: boolean;
  attachmentNames?: string[];
};

type TransportState = {
  messages: TransportMessage[];
};

const INITIAL_STATE: TransportState = {
  messages: [],
};

const TRANSPORT_HEADERS = {};
const PENDING_MESSAGE_CREATED_AT = new Date(0).toISOString();
const CHAT_API_PATH = "/api/chat";
const SIDEBAR_STORAGE_KEY = "jarvis-sidebar-layout-v3";
const MEMORY_MODE_STORAGE_KEY = "jarvis-memory-mode-v1";

const threadsStore = new Map<
  string,
  {
    remoteId: string;
    status: "regular" | "archived";
    title?: string;
  }
>();

const API_BASE = "https://jarvis-auth-service.dexproject.workers.dev";

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

function readSidebarState(): StoredSidebarState {
  if (typeof window === "undefined") {
    return { projects: [], threadMetaById: {}, selectedProjectId: null };
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);

    if (!raw) {
      return { projects: [], threadMetaById: {}, selectedProjectId: null };
    }

    const parsed = JSON.parse(raw) as Partial<StoredSidebarState>;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      threadMetaById:
        parsed.threadMetaById && typeof parsed.threadMetaById === "object"
          ? parsed.threadMetaById
          : {},
      selectedProjectId:
        typeof parsed.selectedProjectId === "string" ? parsed.selectedProjectId : null,
    };
  } catch (_error) {
    return { projects: [], threadMetaById: {}, selectedProjectId: null };
  }
}

function buildMemoryContext(threadId: string | null) {
  const sidebarState = readSidebarState();
  const threadMeta = threadId ? sidebarState.threadMetaById[threadId] : undefined;
  const projectId = threadMeta?.projectId ?? sidebarState.selectedProjectId ?? null;
  const projectName =
    projectId
      ? sidebarState.projects.find((project) => project.id === projectId)?.name || null
      : null;
  const memoryMode =
    typeof window !== "undefined" && window.localStorage.getItem(MEMORY_MODE_STORAGE_KEY) === "temporary"
      ? "temporary"
      : "persistent";
  const threadTitle = threadId ? threadsStore.get(threadId)?.title || "" : "";

  return {
    projectId,
    projectName,
    threadTitle,
    memoryMode,
  };
}

async function syncToCloud(threadId: string, title?: string, messages?: readonly any[]) {
  if (typeof window === "undefined") return;
  if (messages?.some((message) => message.metadata?.custom?.attachmentReview)) return;
  const token = window.localStorage.getItem("jarvis_auth_token");
  if (!token) return;

  try {
    await fetch(`${API_BASE}/api/chat/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        threadId,
        title,
        messages: messages?.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content?.[0]?.text || m.text || ""
        }))
      }),
    });
  } catch (err) {
    console.error("Failed to sync to cloud:", err);
  }
}

const threadListAdapter: RemoteThreadListAdapter = {
  async list() {
    return {
      threads: Array.from(threadsStore.values()).map((thread) => ({
        remoteId: thread.remoteId,
        status: thread.status,
        title: thread.title,
      })),
    };
  },

  async initialize(localId) {
    const remoteId = localId;

    threadsStore.set(remoteId, {
      remoteId,
      status: "regular",
    });

    void syncToCloud(remoteId, "New Chat");

    return { remoteId, externalId: undefined };
  },

  async rename(remoteId, title) {
    const thread = threadsStore.get(remoteId);

    if (thread) {
      thread.title = title;
      void syncToCloud(remoteId, title);
    }
  },

  async archive(remoteId) {
    const thread = threadsStore.get(remoteId);

    if (thread) {
      thread.status = "archived";
    }
  },

  async unarchive(remoteId) {
    const thread = threadsStore.get(remoteId);

    if (thread) {
      thread.status = "regular";
    }
  },

  async delete(remoteId) {
    threadsStore.delete(remoteId);
  },

  async fetch(remoteId) {
    const thread = threadsStore.get(remoteId);

    if (!thread) {
      throw new Error("Thread not found");
    }

    return {
      remoteId: thread.remoteId,
      status: thread.status,
      title: thread.title,
    };
  },

  async generateTitle(remoteId, messages) {
    return createAssistantStream((controller) => {
      const firstUserMessage = messages.find((message) => message.role === "user");
      const content = firstUserMessage?.content
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ")
        .trim();

      const title = content ? content.slice(0, 50) : firstUserMessage?.attachments.length ? "File review" : "New Chat";
      controller.appendText(title);
      
      // Sync title to cloud after generation
      void syncToCloud(remoteId, title, messages);
    });
  },
};

function toThreadMessages(state: TransportState): any[] {
  const messages = Array.isArray(state?.messages) ? state.messages : [];

  return messages.map((message) => {
    const createdAt = new Date(message.createdAt || Date.now());

    // Basic common content
    const content: any[] = [];
    if (message.text) {
      content.push({
        type: "text" as const,
        text: message.text,
      });
    }

    if (message.role === "assistant") {
      if (message.actions && Array.isArray(message.actions)) {
        message.actions.forEach((action, actionIndex) => {
          const toolName =
            typeof action?.tool === "string" && action.tool.trim().length > 0
              ? action.tool.trim()
              : action.type;
          const normalizedToolId = String(toolName || action.type || `tool-${actionIndex}`)
            .replace(/[^\w.-]+/g, "-")
            .replace(/^-+|-+$/g, "");
          content.push({
            type: "tool-call" as const,
            toolCallId: `call-${normalizedToolId}-${actionIndex}`,
            toolName,
            args: action,
            argsText: JSON.stringify(action),
          });
        });
      }

      return {
        id: message.id,
        role: "assistant" as const,
        createdAt,
        content,
        status:
          message.status === "running"
            ? { type: "running" as const }
            : { type: "complete" as const, reason: "stop" as const },
        metadata: {
          unstable_state: state,
          custom: {
            provider: message.provider || "local",
            details: message.details || null,
            attachmentReview: message.attachmentReview === true,
          },
        },
      };
    }

    return {
      id: message.id,
      role: "user" as const,
      createdAt,
      content,
      attachments: (message.attachmentNames ?? []).map((name, index) => ({
        id: message.id + "-file-" + index,
        name,
        type: "document",
        status: { type: "complete" },
        content: [],
      })),
      metadata: {
        custom: {
          details: message.details || null,
          attachmentReview: message.attachmentReview === true,
        },
      },
    };
  });
}

function extractCommandText(
  message: {
    text?: string;
    parts?: readonly { type?: string; text?: string }[];
    content?: unknown;
  },
) {
  if (typeof message.text === "string") {
    return message.text.trim();
  }

  if (Array.isArray(message.parts)) {
    return message.parts
      .map((part) =>
        part?.type === "text" && typeof part.text === "string" ? part.text : "",
      )
      .filter((part) => part.trim().length > 0 && !part.startsWith(attachmentPrefix))
      .join(" ")
      .trim();
  }

  if (typeof message.content === "string") {
    return message.content.trim();
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) =>
        part && typeof part === "object" && "text" in part && typeof (part as { text?: string }).text === "string"
          ? (part as { text?: string }).text ?? ""
          : "",
      )
      .filter((part) => part.trim().length > 0)
      .join(" ")
      .trim();
  }

  return "";
}

function createOptimisticMessage(
  command: AssistantTransportCommand,
  index: number,
): TransportMessage | null {
  if (command.type !== "add-message" || !command.message) {
    return null;
  }

  const text = extractCommandText(command.message);
  const attachmentNames = command.message.parts.flatMap((part) => {
    if (part.type === "image") return ["Clipboard image"];
    if (part.type !== "text") return [];
    const label = readAttachmentLabel(part.text);
    return label ? [label] : [];
  });
  if (!text && !attachmentNames.length) {
    return null;
  }

  const role = command.message.role === "assistant" ? "assistant" : "user";

  return {
    id: `pending-${index}-${command.sourceId ?? command.parentId ?? "root"}`,
    role,
    text,
    attachmentNames,
    attachmentReview: attachmentNames.length > 0,
    createdAt: PENDING_MESSAGE_CREATED_AT,
    ...(role === "assistant" ? { status: "complete" as const } : {}),
  };
}

function mergeMessagesWithOptimistic(
  messages: readonly TransportMessage[],
  optimisticMessages: readonly TransportMessage[],
) {
  const merged = [...messages];

  for (const optimisticMessage of optimisticMessages) {
    const lastMessage = merged[merged.length - 1];

    if (
      lastMessage &&
      lastMessage.role === optimisticMessage.role &&
      lastMessage.text === optimisticMessage.text
    ) {
      continue;
    }

    merged.push(optimisticMessage);
  }

  return merged;
}

function trimCancelledRunMessages(messages: readonly TransportMessage[]) {
  const next = [...messages];
  const last = next[next.length - 1];

  if (last?.role === "assistant" && last.status === "running") {
    next.pop();
  }

  const previous = next[next.length - 1];
  if (previous?.role === "user") {
    next.pop();
  }

  return next;
}

function transportConverter(
  state: TransportState,
  connectionMetadata: AssistantTransportConnectionMetadata,
) {
  const optimisticMessages = connectionMetadata.pendingCommands
    .map((command, index) => createOptimisticMessage(command, index))
    .filter((message): message is TransportMessage => message !== null);

  const mergedState =
    optimisticMessages.length > 0
      ? {
          ...state,
          messages: mergeMessagesWithOptimistic(
            state.messages,
            optimisticMessages,
          ),
        }
      : state;

  return {
    messages: toThreadMessages(mergedState),
    isRunning:
      connectionMetadata.isSending ||
      Boolean(optimisticMessages.length) ||
      Boolean(mergedState.messages?.some((message) => message.status === "running")),
    state: mergedState,
  } as any;
}

function useJarvisTransportRuntime(
  setError: (value: string | null) => void,
  setFileError: (value: AttachmentError | null) => void,
) {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("jarvis_auth_token") : null;
  const headers = useMemo(() => {
    return {
      ...TRANSPORT_HEADERS,
      Authorization: token ? `Bearer ${token}` : "",
    };
  }, [token]);
  const attachments = useMemo(() => createChatAttachmentAdapter(setFileError), [setFileError]);

  return useAssistantTransportRuntime<TransportState>({
    initialState: INITIAL_STATE,
    api: CHAT_API_PATH,
    headers,
    adapters: { attachments },
    prepareSendCommandsRequest: async (body) => {
      setError(null);
      setFileError(null);
      return {
        ...body,
        memoryContext: buildMemoryContext(typeof body.threadId === "string" ? body.threadId : null),
      };
    },
    converter: transportConverter,
    onCancel: ({ updateState }) => {
      updateState((state) => ({
        ...state,
        messages: trimCancelledRunMessages(state.messages),
      }));
    },
    onError: (error) => {
      console.error("Jarvis transport error:", error);
      if (error.message.startsWith("Status 422:")) setError("attachment-invalid");
      else if (error.message.startsWith("Status 413:")) setError("message-too-large");
      else setError("transport-unavailable");
    },
  });
}

export function JarvisRuntimeProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<AttachmentError | null>(null);
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () => useJarvisTransportRuntime(setError, setFileError),
    adapter: threadListAdapter,
  });

  return (
    <TransportError.Provider value={error}>
      <FileError.Provider value={{ error: fileError, clear: () => setFileError(null) }}>
        <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
      </FileError.Provider>
    </TransportError.Provider>
  );
}
