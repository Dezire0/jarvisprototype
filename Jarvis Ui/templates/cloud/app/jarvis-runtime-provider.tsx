"use client";

import type { ReactNode } from "react";
import { createAssistantStream } from "assistant-stream";
import {
  AssistantRuntimeProvider,
  type RemoteThreadListAdapter,
  useAssistantTransportRuntime,
  useRemoteThreadListRuntime,
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

const API_BASE = "https://jarvis-backend.a01044622139.workers.dev";

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

function toThreadMessages(state: TransportState) {
  return (Array.isArray(state?.messages) ? state.messages : []).map((message) => {
    const createdAt = new Date(message.createdAt || Date.now());

    if (message.role === "assistant") {
      return {
        id: message.id,
        role: "assistant" as const,
        createdAt,
        content: [
          {
            type: "text" as const,
            text: message.text || "",
          },
          ...(message.actions || []).map((action) => ({
            type: "tool-call" as const,
            toolCallId: `call-${action.type}-${Date.now()}`,
            toolName: action.type,
            args: action,
            argsText: JSON.stringify(action),
          })),
        ],
        status:
          message.status === "running"
            ? { type: "running" as const }
            : { type: "complete" as const, reason: "stop" as const },
        metadata: {
          unstable_state: state,
          unstable_annotations: [],
          unstable_data: [],
          steps: [],
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
      content: [
        {
          type: "text" as const,
          text: message.text || "",
        },
      ],
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
  return useAssistantTransportRuntime<TransportState>({
    initialState: INITIAL_STATE,
    api: "/api/chat",
    headers: TRANSPORT_HEADERS,
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
