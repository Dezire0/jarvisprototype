"use client";

import { createContext, useContext, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { createAssistantStream } from "assistant-stream";
import { attachmentPrefix, createChatAttachmentAdapter, readAttachmentLabel, type AttachmentError } from "@/lib/chat-attachments";
import {
  AssistantRuntimeProvider,
  type AssistantTransportCommand,
  type AssistantTransportConnectionMetadata,
  type RemoteThreadListAdapter,
  useAssistantTransportRuntime,
  useAuiState,
  useRemoteThreadListRuntime,
  type ThreadMessage,
} from "@assistant-ui/react";

import { ChatHistory, memoryMode, type TransportMessage, type TransportState } from "@/lib/chat-history";
import { AUTH_SESSION_CHANGED, readStoredAuthSession } from "@/components/jarvis/auth-session";

const History = createContext<ChatHistory | null>(null);
const HistoryError = createContext(false);

export function useChatHistory() {
  const history = useContext(History);
  if (!history) throw new Error("Conversation history is not ready.");
  return history;
}

export function useChatHistoryError() {
  return useContext(HistoryError);
}

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

const INITIAL_STATE: TransportState = { messages: [] };
const PENDING_MESSAGE_CREATED_AT = new Date(0).toISOString();
const CHAT_API_PATH = "/api/chat";

function buildMemoryContext(history: ChatHistory, threadId: string | null) {
  const { projects, threadMetaById, selectedProjectId } = history.sidebar;
  const meta = threadId ? threadMetaById[threadId] : undefined;
  const projectId = meta ? meta.projectId : selectedProjectId;
  return {
    projectId,
    projectName: projects.find((project) => project.id === projectId)?.name || null,
    threadTitle: threadId ? history.get(threadId)?.title || "" : "",
    memoryMode: memoryMode(),
  };
}

function createThreadListAdapter(history: ChatHistory): RemoteThreadListAdapter {
  function summarize(thread: { remoteId: string; status: "regular" | "archived"; title?: string }) {
    return { remoteId: thread.remoteId, status: thread.status, title: thread.title };
  }

  return {
    async list() {
      return { threads: history.list().map(summarize) };
    },
    async initialize(localId) {
      history.initialize(localId);
      return { remoteId: localId, externalId: undefined };
    },
    async rename(remoteId, title) {
      history.revise(remoteId, { title });
      history.syncTitle(remoteId);
    },
    async archive(remoteId) {
      history.revise(remoteId, { status: "archived" });
    },
    async unarchive(remoteId) {
      history.revise(remoteId, { status: "regular" });
    },
    async delete(remoteId) {
      history.remove(remoteId);
    },
    async fetch(remoteId) {
      const thread = history.get(remoteId);
      if (!thread) throw new Error("Thread not found");
      return summarize(thread);
    },
    async generateTitle(remoteId, messages) {
      return createAssistantStream((controller) => {
        const first = messages.find((message) => message.role === "user");
        const name = first?.content
          .filter((part) => part.type === "text").map((part) => part.text).join(" ").trim();
        const title = history.get(remoteId)?.title || name?.slice(0, 50) ||
          (first?.attachments?.length ? "File review" : "New Chat");
        if (first) history.revise(remoteId, { title });
        controller.appendText(title);
      });
    },
  };
}

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
        message.actions.forEach((value, actionIndex) => {
          if (!value || typeof value !== "object") return;
          const action = value as { tool?: unknown; type?: unknown };
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
  history: ChatHistory,
  setError: (value: string | null) => void,
  setFileError: (value: AttachmentError | null) => void,
) {
  const id = useAuiState((state) => state.threadListItem.remoteId);
  const skipHistory = useRef(false);
  const attachments = useMemo(() => createChatAttachmentAdapter(setFileError), [setFileError]);
  const runtime = useAssistantTransportRuntime<TransportState>({
    initialState: id ? { messages: history.get(id)?.messages ?? [] } : INITIAL_STATE,
    api: CHAT_API_PATH,
    headers: {},
    adapters: { attachments },
    prepareSendCommandsRequest: async (body) => {
      setError(null);
      setFileError(null);
      const context = buildMemoryContext(history, typeof body.threadId === "string" ? body.threadId : null);
      if (context.memoryMode === "temporary") skipHistory.current = true;
      return { ...body, memoryContext: context };
    },
    converter: transportConverter,
    onCancel: ({ updateState }) => {
      updateState((state) => ({
        ...state,
        messages: trimCancelledRunMessages(state.messages),
      }));
    },
    onError: (error) => {
      if (error.message.startsWith("Status 422:")) setError("attachment-invalid");
      else if (error.message.startsWith("Status 413:")) setError("message-too-large");
      else {
        console.error("Jarvis transport error:", error);
        setError("transport-unavailable");
      }
    },
  });

  useEffect(() => {
    if (!id) return;
    const thread = runtime.thread;
    let seen: TransportMessage[] | undefined;
    function checkpoint() {
      const state = thread.getState();
      const messages = (state.state as TransportState | null)?.messages;
      if (!skipHistory.current && !state.isRunning && Array.isArray(messages) && messages.length &&
          messages !== seen && messages.at(-1)?.status !== "running") {
        seen = messages;
        history.checkpoint(id!, messages);
      }
    }
    return thread.subscribe(checkpoint);
  }, [runtime, history, id]);

  return runtime;
}

function ConversationRuntime({ history, failed, children }: {
  history: ChatHistory;
  failed: boolean;
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<AttachmentError | null>(null);
  const adapter = useMemo(() => createThreadListAdapter(history), [history]);
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () => useJarvisTransportRuntime(history, setError, setFileError),
    adapter,
  });

  return (
    <History.Provider value={history}>
      <HistoryError.Provider value={failed}>
        <TransportError.Provider value={error}>
          <FileError.Provider value={{ error: fileError, clear: () => setFileError(null) }}>
            <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
          </FileError.Provider>
        </TransportError.Provider>
      </HistoryError.Provider>
    </History.Provider>
  );
}

export function JarvisRuntimeProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<ChatHistory | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let currentId: string | null = null;
    let generation = 0;
    function open() {
      const session = readStoredAuthSession();
      const id = session.token && session.user?.id ? session.user.id : null;
      if (currentId === id) return;
      currentId = id;
      const request = ++generation;
      setHistory(null);
      if (!id) return;
      void ChatHistory.open(id, (error) => {
        if (request === generation) setFailed(error);
      }).then((opened) => {
        if (request === generation) setHistory(opened);
      });
    }
    open();
    window.addEventListener(AUTH_SESSION_CHANGED, open);
    return () => {
      generation++;
      window.removeEventListener(AUTH_SESSION_CHANGED, open);
    };
  }, []);

  if (!history) return <p role="status" className="mx-auto mt-12 text-sm text-muted-foreground">
    {typeof navigator !== "undefined" && navigator.language.startsWith("ko") ? "대화를 불러오는 중…" : "Loading conversations…"}
  </p>;

  return <ConversationRuntime key={history.accountId} history={history} failed={failed}>
    {children}
  </ConversationRuntime>;
}
