"use client";

import { type ReactNode, useMemo } from "react";
import { createAssistantStream } from "assistant-stream";
import {
  AssistantRuntimeProvider,
  type RemoteThreadListAdapter,
  useAssistantTransportRuntime,
  useRemoteThreadListRuntime,
  type ThreadMessage,
} from "@assistant-ui/react";

type TransportMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  status?: "running" | "complete";
  provider?: string;
  actions?: any[];
};

type TransportState = {
  messages: TransportMessage[];
};

const INITIAL_STATE: TransportState = {
  messages: [],
};

const TRANSPORT_HEADERS = {};

const threadsStore = new Map<
  string,
  {
    remoteId: string;
    status: "regular" | "archived";
    title?: string;
  }
>();

const API_BASE = "https://jarvis-auth-service.dexproject.workers.dev";

async function syncToCloud(threadId: string, title?: string, messages?: readonly any[]) {
  if (typeof window === "undefined") return;
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

      const title = content ? content.slice(0, 50) : "New Chat";
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
        message.actions.forEach((action) => {
          content.push({
            type: "tool-call" as const,
            toolCallId: `call-${action.type}-${Date.now()}`,
            toolName: action.type,
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
          },
        },
      };
    }

    return {
      id: message.id,
      role: "user" as const,
      createdAt,
      content,
      attachments: [],
      metadata: {
        custom: {},
      },
    };
  });
}

function transportConverter(state: TransportState, connectionMetadata: { isSending: boolean }) {
  return {
    messages: toThreadMessages(state),
    isRunning:
      connectionMetadata.isSending ||
      Boolean(state.messages?.some((message) => message.status === "running")),
    state,
  };
}

function useJarvisTransportRuntime() {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("jarvis_auth_token") : null;
  const headers = useMemo(() => {
    return {
      ...TRANSPORT_HEADERS,
      Authorization: token ? `Bearer ${token}` : "",
    };
  }, [token]);

  return useAssistantTransportRuntime<TransportState>({
    initialState: INITIAL_STATE,
    api: `${API_BASE}/api/chat`,
    headers,
    converter: transportConverter,
    onError: (error) => {
      console.error("Jarvis transport error:", error);
    },
  });
}

export function JarvisRuntimeProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useJarvisTransportRuntime,
    adapter: threadListAdapter,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
