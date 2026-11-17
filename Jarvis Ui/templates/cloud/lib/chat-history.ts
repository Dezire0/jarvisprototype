"use client";

import { readStoredAuthSession } from "@/components/jarvis/auth-session";

export type TransportMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  status?: "running" | "complete";
  provider?: string;
  actions?: unknown[];
  details?: unknown;
  attachmentReview?: boolean;
  attachmentNames?: string[];
};
export type TransportState = { messages: TransportMessage[] };
export type ThreadHistory = {
  remoteId: string;
  status: "regular" | "archived";
  title?: string;
  updatedAt: number;
  messages: TransportMessage[];
};
export type SidebarHistory = {
  projects: { id: string; name: string; createdAt: number }[];
  threadMetaById: Record<string, { createdAt: number; updatedAt: number; projectId: string | null }>;
  selectedProjectId: string | null;
};
type Snapshot = {
  version: 1;
  threads: ThreadHistory[];
  sidebar: SidebarHistory;
  cloudSync?: boolean;
};

const EMPTY_SIDEBAR: SidebarHistory = { projects: [], threadMetaById: {}, selectedProjectId: null };
const API_BASE = "https://jarvis-auth-service.dexproject.workers.dev";
const MEMORY_MODE_KEY = "jarvis-memory-mode-v1";
const STORAGE_KEY = "jarvis-chat-history:v1:";

export function memoryMode() {
  return typeof window !== "undefined" && window.localStorage.getItem(MEMORY_MODE_KEY) === "temporary"
    ? "temporary"
    : "persistent";
}

function readSnapshot(raw: string | null): Snapshot {
  if (raw === null) return { version: 1, threads: [], sidebar: EMPTY_SIDEBAR };
  const data = JSON.parse(raw) as Snapshot;
  if (data?.version !== 1 || !Array.isArray(data.threads) || !Array.isArray(data.sidebar?.projects) ||
      !data.sidebar.threadMetaById || typeof data.sidebar.threadMetaById !== "object" ||
      data.threads.some((thread) => !thread?.remoteId || !Array.isArray(thread.messages))) {
    throw new Error("Invalid conversation history.");
  }
  return data;
}

function completedTranscript(messages: TransportMessage[]): TransportMessage[] {
  return messages.filter((message) => message.status !== "running" && !message.id.startsWith("pending-")).map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    status: "complete",
    provider: message.provider,
    attachmentNames: message.attachmentNames,
    attachmentReview: message.attachmentReview,
    actions: message.actions?.flatMap((value) => {
      const action = value as { type?: unknown; status?: unknown } | null;
      return typeof action?.type === "string" && typeof action.status === "string"
        ? [{ type: action.type, status: action.status }]
        : [];
    }),
  }));
}

export class ChatHistory {
  private saved = new Map<string, ThreadHistory>();
  private temporary = new Map<string, ThreadHistory>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private pendingWrite = Promise.resolve();
  private pendingCloud = Promise.resolve();
  private syncPreferenceSaved = true;
  cloudSync: boolean;
  sidebar: SidebarHistory;

  static async open(accountId: string, onError: (failed: boolean) => void) {
    const bridge = window.assistantAPI;
    const browserKey = STORAGE_KEY + encodeURIComponent(accountId);
    try {
      const native = bridge?.loadChatHistory && bridge?.saveChatHistory;
      const raw = native ? await bridge.loadChatHistory!(accountId) : window.localStorage.getItem(browserKey);
      const write = native
        ? (value: string) => bridge.saveChatHistory!(accountId, value)
        : async (value: string) => { window.localStorage.setItem(browserKey, value); };
      onError(false);
      return new ChatHistory(accountId, readSnapshot(raw), write, onError);
    } catch {
      onError(true);
      return new ChatHistory(accountId, { version: 1, threads: [], sidebar: EMPTY_SIDEBAR }, null, onError);
    }
  }

  private constructor(
    readonly accountId: string,
    snapshot: Snapshot,
    private write: ((value: string) => Promise<void>) | null,
    private onError: (failed: boolean) => void,
  ) {
    this.sidebar = snapshot.sidebar;
    this.cloudSync = snapshot.cloudSync === true;
    this.saved = new Map(snapshot.threads.map((thread) => [thread.remoteId, thread]));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getRevision = () => this.revision;

  list() { return [...this.saved.values(), ...this.temporary.values()].sort((a, b) => b.updatedAt - a.updatedAt); }
  localThreads() { return [...this.saved.values()].filter((thread) => thread.messages.length || thread.title); }
  get(id: string) { return this.temporary.get(id) ?? this.saved.get(id); }

  cloudToken() {
    if (!this.cloudSync || !this.syncPreferenceSaved) return null;
    const session = readStoredAuthSession();
    return session.user?.id === this.accountId ? session.token : null;
  }

  async setCloudSync(enabled: boolean) {
    if (enabled === this.cloudSync && this.syncPreferenceSaved) return true;
    if (!this.write) return false;
    this.syncPreferenceSaved = false;
    this.cloudSync = enabled;
    this.update(true);
    try {
      await this.pendingWrite;
      this.syncPreferenceSaved = true;
      return true;
    } catch {
      if (enabled) this.cloudSync = false;
      return false;
    }
  }

  private update(save: boolean) {
    this.revision++;
    this.listeners.forEach((listener) => listener());
    if (!save || !this.write) return;
    const threads = this.localThreads();
    const ids = new Set(threads.map((thread) => thread.remoteId));
    const sidebar = {
      ...this.sidebar,
      threadMetaById: Object.fromEntries(Object.entries(this.sidebar.threadMetaById).filter(([id]) => ids.has(id))),
    };
    const snapshot = { version: 1, threads, sidebar, cloudSync: this.cloudSync } satisfies Snapshot;
    const write = this.write;
    this.pendingWrite = this.pendingWrite.catch(() => {}).then(() => write(JSON.stringify(snapshot)));
    void this.pendingWrite.then(() => this.onError(false), () => this.onError(true));
  }

  setSidebar(sidebar: SidebarHistory) {
    if (sidebar.projects === this.sidebar.projects && sidebar.threadMetaById === this.sidebar.threadMetaById &&
        sidebar.selectedProjectId === this.sidebar.selectedProjectId) return;
    this.sidebar = sidebar;
    this.update(true);
  }

  initialize(id: string) {
    if (this.get(id)) return;
    const thread = { remoteId: id, status: "regular" as const, updatedAt: Date.now(), messages: [] };
    if (memoryMode() === "temporary") {
      this.temporary.set(id, thread);
      this.update(false);
    } else {
      // Persist a new thread after it has a completed turn or an explicit title.
      this.saved.set(id, thread);
      this.update(false);
    }
  }

  revise(id: string, change: Partial<Pick<ThreadHistory, "title" | "status">>) {
    const target = this.temporary.has(id) ? this.temporary : this.saved;
    const thread = target.get(id);
    if (!thread) return;
    target.set(id, { ...thread, ...change });
    this.update(target === this.saved);
  }

  remove(id: string) {
    const saved = this.saved.delete(id);
    this.temporary.delete(id);
    this.update(saved);
  }

  checkpoint(id: string, messages: TransportMessage[]) {
    const thread = this.saved.get(id);
    if (!thread || this.temporary.has(id) || messages.at(-1)?.role !== "assistant") return;
    const completed = completedTranscript(messages);
    if (JSON.stringify(thread.messages) === JSON.stringify(completed)) return;
    const next = {
      ...thread, updatedAt: Date.now(), messages: completed,
      title: thread.title || completed.find((message) => message.role === "user")?.text.trim().slice(0, 50) ||
        (completed.some((message) => message.attachmentReview) ? "File review" : "New Chat"),
    };
    this.saved.set(id, next);
    this.update(true);
    this.queueCloud(next, true);
  }

  syncTitle(id: string) {
    const thread = this.saved.get(id);
    if (thread) this.queueCloud(thread, false);
  }

  private queueCloud(thread: ThreadHistory, includeMessages: boolean) {
    if (memoryMode() === "temporary" || !this.cloudToken() || !thread.messages.length ||
        thread.messages.some((message) => message.attachmentReview)) return;
    this.pendingCloud = this.pendingCloud.then(async () => {
      const token = this.cloudToken();
      if (!token || memoryMode() === "temporary") return;
      await fetch(`${API_BASE}/api/chat/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          threadId: thread.remoteId,
          title: thread.title,
          messages: includeMessages ? thread.messages.map(({ id, role, text, createdAt }) => ({
            id, role, content: text, createdAt,
          })) : undefined,
        }),
      });
    }).catch(() => {});
  }

  async importCloud(id: string, title: string, updatedAt: number) {
    const token = this.cloudToken();
    if (!token || memoryMode() === "temporary") return false;
    if (this.get(id)) return true;
    const response = await fetch(`${API_BASE}/api/chat/threads/${encodeURIComponent(id)}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok || token !== this.cloudToken()) return false;
    const { messages } = await response.json() as {
      messages?: { id: string; role: "assistant" | "user"; content: string; createdAt: number }[];
    };
    if (!Array.isArray(messages) || token !== this.cloudToken()) return false;
    const transcript: TransportMessage[] = messages
      .filter((message) => typeof message.id === "string" && typeof message.content === "string" &&
          (message.role === "assistant" || message.role === "user"))
      .map(({ id, role, content, createdAt }) => ({
        id, role, text: content, createdAt: new Date(Number(createdAt) || Date.now()).toISOString(), status: "complete",
      }));
    if (!this.get(id)) {
      this.saved.set(id, { remoteId: id, status: "regular", title, updatedAt, messages: transcript });
      this.update(true);
    }
    return true;
  }
}
