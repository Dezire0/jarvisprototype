"use client";

import { readStoredAuthSession } from "@/components/jarvis/auth-session";
import { normalizeMemorySources, type MemorySource } from "@/lib/chat-memory";
import { executionRecords } from "@/lib/execution-record";
import { isWorkspaceLanguage, type WorkspaceLanguage } from "@/lib/workspace-language";

export type TransportMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  status?: "running" | "complete";
  provider?: string;
  memorySources?: MemorySource[];
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
  savedMemory?: boolean;
  profile?: { name: string; language: WorkspaceLanguage };
};
type Profile = NonNullable<Snapshot["profile"]> & { cloudSync: boolean; savedMemory: boolean };
type SaveOutcome = "saved" | "changed" | "storage-changed";
type HistoryStorage = {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  lastSaved: string | null;
};

const EMPTY_SIDEBAR: SidebarHistory = { projects: [], threadMetaById: {}, selectedProjectId: null };
const API_BASE = "https://jarvis-auth-service.dexproject.workers.dev";
const STORAGE_KEY = "jarvis-chat-history:v1:";

function readSnapshot(raw: string | null): Snapshot {
  if (raw === null) return { version: 1, threads: [], sidebar: EMPTY_SIDEBAR };
  const data = JSON.parse(raw) as Snapshot;
  if (data?.version !== 1 || !Array.isArray(data.threads) || !Array.isArray(data.sidebar?.projects) ||
      !data.sidebar.threadMetaById || typeof data.sidebar.threadMetaById !== "object" ||
      data.threads.some((thread) => !thread?.remoteId || !Array.isArray(thread.messages)) ||
      (data.savedMemory !== undefined && typeof data.savedMemory !== "boolean") ||
      (data.profile !== undefined &&
        (typeof data.profile?.name !== "string" || data.profile.name.length > 80 ||
          !isWorkspaceLanguage(data.profile.language)))) {
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
    memorySources: message.role === "assistant" && !message.attachmentReview
      ? normalizeMemorySources(message.memorySources)
      : undefined,
    attachmentNames: message.attachmentNames,
    attachmentReview: message.attachmentReview,
    actions: message.role === "assistant" && Array.isArray(message.actions) ? executionRecords(message.actions) : undefined,
  }));
}

export class ChatHistory {
  private saved = new Map<string, ThreadHistory>();
  private temporary = new Set<string>();
  private temporaryDraft = false;
  private listeners = new Set<() => void>();
  private revision = 0;
  private pendingWrite: Promise<unknown> = Promise.resolve();
  private pendingCloud = Promise.resolve();
  private pendingSyncChanges = 0;
  private syncWriteFailed = false;
  private preferences: Profile;
  get profile(): Readonly<Profile> { return this.preferences; }
  get cloudSync() { return this.preferences.cloudSync; }
  sidebar: SidebarHistory;

  static async open(accountId: string, onError: (failed: boolean) => void) {
    const bridge = window.assistantAPI;
    const browserKey = STORAGE_KEY + encodeURIComponent(accountId);
    try {
      const native = bridge?.loadChatHistory && bridge?.saveChatHistory;
      const read = native
        ? () => bridge.loadChatHistory!(accountId)
        : async () => window.localStorage.getItem(browserKey);
      const raw = await read();
      const write = native
        ? (value: string) => bridge.saveChatHistory!(accountId, value)
        : async (value: string) => { window.localStorage.setItem(browserKey, value); };
      const history = new ChatHistory(accountId, readSnapshot(raw), { read, write, lastSaved: raw }, onError);
      onError(false);
      return history;
    } catch {
      onError(true);
      return new ChatHistory(accountId, { version: 1, threads: [], sidebar: EMPTY_SIDEBAR, savedMemory: false }, null, onError);
    }
  }

  private constructor(
    readonly accountId: string,
    snapshot: Snapshot,
    private storage: HistoryStorage | null,
    private onError: (failed: boolean) => void,
  ) {
    this.sidebar = snapshot.sidebar;
    const { user } = readStoredAuthSession();
    const previous = user?.id === accountId ? user : null;
    const previousName = typeof previous?.name === "string" ? previous.name.trim().slice(0, 80) : "";
    const previousLanguage = previous?.settings?.language;
    this.preferences = {
      name: snapshot.profile?.name ?? previousName,
      language: snapshot.profile?.language ?? (isWorkspaceLanguage(previousLanguage) ? previousLanguage : "auto"),
      cloudSync: snapshot.cloudSync === true,
      savedMemory: snapshot.savedMemory !== false,
    };
    this.saved = new Map(snapshot.threads.map((thread) => [thread.remoteId, thread]));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getRevision = () => this.revision;

  list() { return [...this.saved.values()].sort((a, b) => b.updatedAt - a.updatedAt); }
  localThreads() { return [...this.saved.values()].filter((thread) => thread.messages.length || thread.title); }
  get(id: string) { return this.saved.get(id); }

  isTemporary(id: string | null, isDraft = false) {
    return Boolean(id && this.temporary.has(id)) || (isDraft && this.temporaryDraft);
  }

  setTemporaryDraft(temporary: boolean) {
    if (temporary === this.temporaryDraft) return;
    this.temporaryDraft = temporary;
    this.update(false);
  }

  cloudToken() {
    if (!this.cloudSync || this.pendingSyncChanges || this.syncWriteFailed) return null;
    const session = readStoredAuthSession();
    return session.user?.id === this.accountId ? session.token : null;
  }

  async saveProfile(patch: Partial<Profile>) {
    if (!this.storage) return false;
    const changesSync = patch.cloudSync !== undefined;
    if (changesSync) this.pendingSyncChanges++;
    try {
      await this.persist(patch);
      if (changesSync) this.syncWriteFailed = false;
      return true;
    } catch {
      if (changesSync) this.syncWriteFailed = true;
      return false;
    } finally {
      if (changesSync) this.pendingSyncChanges--;
    }
  }

  private update(save: boolean) {
    this.revision++;
    this.listeners.forEach((listener) => listener());
    if (save && this.storage) void this.persist();
  }

  private persist(patch?: Partial<Profile>, deletion?: ReadonlyMap<string, ThreadHistory>) {
    const storage = this.storage;
    if (!storage) throw new Error("Conversation storage is unavailable.");
    const pending = this.pendingWrite.catch(() => {}).then(async (): Promise<SaveOutcome> => {
      if (deletion) {
        if (await storage.read() !== storage.lastSaved) return "storage-changed";
        if ([...deletion].some(([id, reviewed]) => this.saved.get(id) !== reviewed)) return "changed";
      }
      const threads = this.localThreads().filter((thread) => !deletion?.has(thread.remoteId));
      const ids = new Set(threads.map((thread) => thread.remoteId));
      const sidebar = {
        ...this.sidebar,
        threadMetaById: Object.fromEntries(Object.entries(this.sidebar.threadMetaById).filter(([id]) => ids.has(id))),
      };
      const next = { ...this.preferences, ...patch };
      const snapshot = {
        version: 1, threads, sidebar, cloudSync: next.cloudSync, savedMemory: next.savedMemory,
        profile: { name: next.name, language: next.language },
      } satisfies Snapshot;
      const serialized = JSON.stringify(snapshot);
      await storage.write(serialized);
      storage.lastSaved = serialized;
      if (deletion) {
        for (const id of deletion.keys()) this.saved.delete(id);
        this.sidebar = {
          ...this.sidebar,
          threadMetaById: Object.fromEntries(Object.entries(this.sidebar.threadMetaById).filter(([id]) => !deletion.has(id))),
        };
      }
      if (patch) {
        this.preferences = next;
      }
      if (patch || deletion) this.update(false);
      return "saved";
    });
    this.pendingWrite = pending;
    void pending.then((outcome) => { if (outcome === "saved") this.onError(false); }, () => this.onError(true));
    return pending;
  }

  setSidebar(sidebar: SidebarHistory) {
    if (sidebar.projects === this.sidebar.projects && sidebar.threadMetaById === this.sidebar.threadMetaById &&
        sidebar.selectedProjectId === this.sidebar.selectedProjectId) return;
    this.sidebar = sidebar;
    this.update(true);
  }

  initialize(id: string) {
    if (this.get(id) || this.temporary.has(id)) return;
    if (this.temporaryDraft) {
      this.temporary.add(id);
      this.temporaryDraft = false;
    } else {
      // Persist a new thread after it has a completed turn or an explicit title.
      this.saved.set(id, { remoteId: id, status: "regular", updatedAt: Date.now(), messages: [] });
    }
    this.update(false);
  }

  revise(id: string, change: Partial<Pick<ThreadHistory, "title" | "status">>) {
    const thread = this.saved.get(id);
    if (!thread) return;
    this.saved.set(id, { ...thread, ...change });
    this.update(true);
  }

  async remove(id: string) {
    if (this.temporary.delete(id)) this.update(false);
    const thread = this.saved.get(id);
    if (thread && await this.removeReviewed([thread]) !== "saved") throw new Error("The conversation changed.");
  }

  removeReviewed(threads: readonly ThreadHistory[]): Promise<SaveOutcome> {
    if (!threads.length) return Promise.resolve("changed");
    return this.persist(undefined, new Map(threads.map((thread) => [thread.remoteId, thread])));
  }

  checkpoint(id: string, messages: TransportMessage[]) {
    const thread = this.saved.get(id);
    if (!thread || messages.at(-1)?.role !== "assistant") return;
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
    if (!this.cloudToken() || !thread.messages.length ||
        thread.messages.some((message) => message.attachmentReview)) return;
    this.pendingCloud = this.pendingCloud.then(async () => {
      const token = this.cloudToken();
      if (!token) return;
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
    if (!token || this.isTemporary(id)) return false;
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
