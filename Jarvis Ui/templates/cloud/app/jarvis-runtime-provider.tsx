"use client";

import { createContext, useCallback, useContext, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { createAssistantStream } from "assistant-stream";
import type { ReadonlyJSONObject, ReadonlyJSONValue } from "assistant-stream/utils";
import { attachmentPrefix, createChatAttachmentAdapter, readAttachmentLabel, type AttachmentError } from "@/lib/chat-attachments";
import {
  AssistantRuntimeProvider,
  type AssistantTransportCommand,
  type AssistantTransportConnectionMetadata,
  type AssistantTransportState,
  type RemoteThreadListAdapter,
  useAssistantTransportRuntime,
  useAui,
  useAuiState,
  useRemoteThreadListRuntime,
  type ThreadMessage,
} from "@assistant-ui/react";

import { ChatHistory, type TransportMessage, type TransportState } from "@/lib/chat-history";
import { AUTH_SESSION_CHANGED, readStoredAuthSession } from "@/components/jarvis/auth-session";

import { WorkspaceLanguageContext } from "@/lib/workspace-language";

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

export function useTemporaryChat() {
  const history = useChatHistory();
  const id = useAuiState((state) => state.threadListItem.remoteId ?? state.threadListItem.id);
  const isDraft = useAuiState((state) => state.threadListItem.status === "new");
  useSyncExternalStore(history.subscribe, history.getRevision, history.getRevision);
  return history.isTemporary(id, isDraft);
}

type TransportNotice = {
  kind: "cancelled" | "attachment-invalid" | "message-too-large" | "transport-unavailable";
  text: string;
  hadAttachments: boolean;
};
type SetTransportNotice = (threadId: string, notice: TransportNotice | null) => void;
const TransportNotices = createContext<{
  notices: ReadonlyMap<string, TransportNotice>;
  setNotice: SetTransportNotice;
} | null>(null);
const FileError = createContext<{ error: AttachmentError | null; clear: () => void }>({
  error: null,
  clear: () => {},
});
type FinishedReply = { threadId: string; id: string; text: string };
type FinishedReplyListener = (reply: FinishedReply) => void;
const FinishedReplies = createContext<Set<FinishedReplyListener> | null>(null);
const silentReplyProviders = new Set(["local-error", "model-required", "model-error", "model-settings", "attachment-error"]);

export function useFinishedReplies() {
  return useContext(FinishedReplies);
}

export function useJarvisTransportNotice() {
  const id = useAuiState((state) => state.threadListItem.remoteId ?? state.threadListItem.id);
  const context = useContext(TransportNotices);
  return { notice: context?.notices.get(id), dismiss: () => context?.setNotice(id, null) };
}
export function useJarvisAttachmentError() {
  return useContext(FileError);
}

const INITIAL_STATE: TransportState = { messages: [] };
const PENDING_MESSAGE_CREATED_AT = new Date(0).toISOString();
const CHAT_API_PATH = "/api/chat";

function buildMemoryContext(history: ChatHistory, threadId: string, isDraft: boolean) {
  const accountId = history.accountId;
  if (history.isTemporary(threadId, isDraft)) {
    return { accountId, memoryMode: "temporary" };
  }
  const { projects, threadMetaById, selectedProjectId } = history.sidebar;
  const meta = threadMetaById[threadId];
  const projectId = meta ? meta.projectId : selectedProjectId;
  return {
    projectId,
    projectName: projects.find((project) => project.id === projectId)?.name || null,
    threadTitle: history.get(threadId)?.title || "",
    accountId,
    memoryMode: "persistent",
    savedMemory: history.profile.savedMemory,
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
      await history.remove(remoteId);
    },
    async fetch(remoteId) {
      const thread = history.get(remoteId);
      if (!thread) throw new Error("Thread not found");
      return summarize(thread);
    },
    async generateTitle(remoteId, messages) {
      return createAssistantStream((controller) => {
        if (history.isTemporary(remoteId)) return;
        const last = messages.at(-1);
        if (last?.role !== "assistant" || last.status.type !== "complete") return;
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

function toThreadMessages(state: TransportState): ThreadMessage[] {
  const messages = Array.isArray(state?.messages) ? state.messages : [];

  return messages.map((message) => {
    const createdAt = new Date(message.createdAt || Date.now());

    const textContent = message.text ? [{ type: "text" as const, text: message.text }] : [];

    if (message.role === "assistant") {
      const content: Extract<ThreadMessage, { role: "assistant" }>["content"][number][] = [...textContent];
      if (message.actions && Array.isArray(message.actions)) {
        message.actions.forEach((value, actionIndex) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return;
          const action = value as { tool?: unknown; type?: unknown };
          const toolName =
            typeof action?.tool === "string" && action.tool.trim().length > 0
              ? action.tool.trim()
              : String(action.type || `tool-${actionIndex}`);
          const normalizedToolId = toolName
            .replace(/[^\w.-]+/g, "-")
            .replace(/^-+|-+$/g, "");
          content.push({
            type: "tool-call" as const,
            toolCallId: `call-${normalizedToolId}-${actionIndex}`,
            toolName,
            args: value as ReadonlyJSONObject,
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
          unstable_state: state as unknown as ReadonlyJSONValue,
          unstable_annotations: [],
          unstable_data: [],
          steps: [],
          custom: {
            provider: message.provider || "local",
            details: message.details || null,
            attachmentReview: message.attachmentReview === true,
            memorySources: message.status === "complete" && !message.attachmentReview ? message.memorySources ?? [] : [],
          },
        },
      };
    }

    return {
      id: message.id,
      role: "user" as const,
      createdAt,
      content: textContent,
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

function createOptimisticMessage(
  command: AssistantTransportCommand,
  index: number,
): TransportMessage | null {
  if (command.type !== "add-message" || !command.message) {
    return null;
  }

  const text = command.message.parts
    .flatMap((part) => part.type === "text" && !part.text.startsWith(attachmentPrefix) ? [part.text] : [])
    .join("\n");
  const attachmentNames = command.message.parts.flatMap((part) => {
    if (part.type === "image") return ["Clipboard image"];
    if (part.type !== "text") return [];
    const label = readAttachmentLabel(part.text);
    return label ? [label] : [];
  });
  if (!text.trim() && !attachmentNames.length) {
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

function transportConverter(
  state: TransportState,
  connectionMetadata: AssistantTransportConnectionMetadata,
): AssistantTransportState {
  const optimisticMessages = connectionMetadata.pendingCommands
    .map((command, index) => createOptimisticMessage(command, index))
    .filter((message): message is TransportMessage => message !== null);

  const mergedState =
    optimisticMessages.length > 0
      ? { messages: [...state.messages, ...optimisticMessages] }
      : state;
  const messages = toThreadMessages(mergedState);

  return {
    messages,
    messageRepository: {
      messages: messages.map((message, index) => ({ message, parentId: messages[index - 1]?.id ?? null })),
    },
    isRunning:
      connectionMetadata.isSending ||
      Boolean(optimisticMessages.length) ||
      Boolean(mergedState.messages?.some((message) => message.status === "running")),
    state: mergedState as unknown as ReadonlyJSONValue,
  };
}

function draftFromCommands(commands: AssistantTransportCommand[]) {
  for (const [index, command] of commands.entries()) {
    if (command.type !== "add-message" || command.message.role !== "user") continue;
    const message = createOptimisticMessage(command, index);
    if (message) return { text: message.text, hadAttachments: Boolean(message.attachmentReview) };
  }
  return { text: "", hadAttachments: false };
}

function noticeKind(error?: Error): TransportNotice["kind"] {
  if (!error) return "cancelled";
  if (error.message.startsWith("Status 422:")) return "attachment-invalid";
  if (error.message.startsWith("Status 413:")) return "message-too-large";
  return "transport-unavailable";
}

function useJarvisTransportRuntime(
  history: ChatHistory,
  setNotice: SetTransportNotice,
  setFileError: (value: AttachmentError | null) => void,
  finishedReplies: Set<FinishedReplyListener>,
) {
  const aui = useAui();
  const id = useAuiState((state) => state.threadListItem.remoteId);
  type Attempt = { threadId: string; localId: string; before: TransportState; draft: ReturnType<typeof draftFromCommands>; temporary: boolean };
  const attempt = useRef<Attempt | null>(null);
  const finished = useRef<Attempt | null>(null);
  const attachments = useMemo(() => createChatAttachmentAdapter(setFileError), [setFileError]);
  const runtime = useAssistantTransportRuntime<TransportState>({
    initialState: id ? { messages: history.get(id)?.messages ?? [] } : INITIAL_STATE,
    api: CHAT_API_PATH,
    requireFinish: true,
    headers: {},
    adapters: { attachments },
    prepareSendCommandsRequest: async (body) => {
      setFileError(null);
      const thread = aui.threadListItem().getState();
      const threadId = thread.remoteId ?? thread.id;
      const memoryContext = buildMemoryContext(history, threadId, thread.status === "new");
      setNotice(threadId, null);
      attempt.current = {
        threadId, localId: thread.id, before: body.state as TransportState,
        draft: draftFromCommands(body.commands), temporary: memoryContext.memoryMode === "temporary",
      };
      return { ...body, threadId, memoryContext };
    },
    converter: transportConverter,
    onFinish: () => {
      finished.current = attempt.current;
      attempt.current = null;
    },
    onCancel: ({ commands, error, updateState }) => {
      const request = attempt.current;
      attempt.current = null;
      if (request) updateState(() => request.before);
      const thread = aui.threadListItem().getState();
      const threadId = request?.threadId ?? thread.remoteId ?? thread.id;
      const draft = request?.draft ?? draftFromCommands(commands);
      setNotice(threadId, { ...draft, kind: noticeKind(error) });
    },
  });

  useEffect(() => {
    const thread = runtime.thread;
    let seen: TransportMessage[] | undefined;
    function checkpoint() {
      const state = thread.getState();
      const messages = (state.state as TransportState | null)?.messages;
      if (state.isRunning || !Array.isArray(messages) || !messages.length) return;
      const reply = messages.at(-1);
      const completed = finished.current;
      finished.current = null;
      if (completed && !completed.temporary && !completed.draft.hadAttachments &&
          reply?.role === "assistant" && reply.status === "complete" && reply.text.trim() && !reply.attachmentReview &&
          !reply.details && !reply.actions?.length && !silentReplyProviders.has(reply.provider ?? "") &&
          !completed.before?.messages?.some((message) => message.id === reply.id)) {
        finishedReplies.forEach((listener) => listener({ threadId: completed.localId, id: reply.id, text: reply.text }));
      }
      if (id && messages !== seen && reply?.status !== "running") {
        seen = messages;
        history.checkpoint(id, messages);
      }
    }
    return thread.subscribe(checkpoint);
  }, [runtime, history, id, finishedReplies]);

  return runtime;
}

function ConversationRuntime({ history, failed, children }: {
  history: ChatHistory;
  failed: boolean;
  children: ReactNode;
}) {
  const language = useSyncExternalStore(history.subscribe, () => history.profile.language, () => "auto" as const);
  const [notices, setNotices] = useState<ReadonlyMap<string, TransportNotice>>(() => new Map());
  const setNotice = useCallback<SetTransportNotice>((id, notice) => {
    setNotices((current) => {
      if (!notice && !current.has(id)) return current;
      const next = new Map(current);
      if (notice) next.set(id, notice);
      else next.delete(id);
      return next;
    });
  }, []);
  const [fileError, setFileError] = useState<AttachmentError | null>(null);
  const [finishedReplies] = useState(() => new Set<FinishedReplyListener>());
  const adapter = useMemo(() => createThreadListAdapter(history), [history]);
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () => useJarvisTransportRuntime(history, setNotice, setFileError, finishedReplies),
    adapter,
  });

  return (
    <History.Provider value={history}>
      <HistoryError.Provider value={failed}>
        <TransportNotices.Provider value={{ notices, setNotice }}>
          <FileError.Provider value={{ error: fileError, clear: () => setFileError(null) }}>
            <WorkspaceLanguageContext.Provider value={language}>
              <FinishedReplies.Provider value={finishedReplies}>
                <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
              </FinishedReplies.Provider>
            </WorkspaceLanguageContext.Provider>
          </FileError.Provider>
        </TransportNotices.Provider>
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
