const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  MemoryStore,
  createAccountMemoryResolver,
  createEmptyStoreState,
  formatMemoryForPrompt
} = require("../../src/main/memory-store.cjs");

async function createTempApp() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-memory-store-"));

  return {
    root,
    app: {
      getPath(name) {
        assert.equal(name, "userData");
        return root;
      }
    }
  };
}

async function cleanup(root) {
  await fs.rm(root, {
    recursive: true,
    force: true
  });
}

test("desktop account memory isolates each layer and leaves unscoped memory in the legacy store", async (t) => {
  const { app, root } = await createTempApp();
  t.after(() => cleanup(root));
  const legacy = new MemoryStore({ app });
  await legacy.merge({ notes: { sample: "legacy workspace memo" } });
  const resolve = createAccountMemoryResolver(root);
  const [account, other] = await Promise.all([resolve({ accountId: "account-a" }), resolve({ accountId: "account-b" })]);
  assert.equal(await resolve({ accountId: "account-a" }), account);
  assert.equal(await resolve({ accountId: "account-a", memoryMode: "temporary" }), null);
  assert.equal(await resolve({ accountId: "account-a", savedMemory: false }), null);
  assert.equal(await resolve({}), null);
  assert.equal(await resolve({ accountId: "" }), null);
  assert.equal(await resolve({ accountId: "x".repeat(257) }), null);

  const context = { threadId: "shared-id", projectId: "shared-project", projectName: "Launch" };
  const subject = "Cerulean Orchard";
  await Promise.all([
    account.merge({ notes: { sample: subject } }),
    account.appendThreadTurns({ ...context, turns: [{ role: "user", content: subject }] }),
    account.rememberDocument({ ...context, path: "/fixture/orchard.md", content: subject }),
  ]);

  const reopened = await createAccountMemoryResolver(root)({ accountId: "account-a" });
  assert.equal(reopened.getSnapshot().notes.sample.value, subject);
  assert.equal(reopened.getRecentThreadTurns(context.threadId, 4)[0].content, subject);
  assert.equal(reopened.getProjectContext(context.projectId).name, "Launch");
  assert.equal(reopened.searchDocuments({ ...context, query: subject })[0].excerpt, subject);
  assert.deepEqual(other.getStoreSnapshot(), createEmptyStoreState());
  assert.equal(legacy.getSnapshot().notes.sample.value, "legacy workspace memo");
});

test("MemoryStore loads an empty schema when nothing has been saved yet", async () => {
  const { app, root } = await createTempApp();
  const store = new MemoryStore({ app });

  const snapshot = await store.load();
  const state = store.getStoreSnapshot();

  assert.deepEqual(Object.keys(snapshot), [
    "identity",
    "preferences",
    "projects",
    "relationships",
    "wishes",
    "notes"
  ]);
  assert.deepEqual(snapshot.identity, {});
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(state.threads, {});
  assert.deepEqual(state.documents, {});

  await cleanup(root);
});

test("account memory review limits excerpts and clears a current revision without resurrecting old writes", async (t) => {
  const { root } = await createTempApp();
  t.after(() => cleanup(root));
  const resolve = createAccountMemoryResolver(root);
  const store = await resolve({ accountId: "review" });
  const other = await resolve({ accountId: "other" });
  await other.merge({ notes: { retained: "Other account" } });
  await store.merge({ preferences: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`pref-${i}`, "Saved"])) });
  await store.appendThreadTurns({ threadId: "thread", projectId: "plan", projectName: "Project name",
    turns: [{ role: "user", content: "A".repeat(300) }] });
  await store.rememberDocument({ path: "/private/marker/data.txt", title: "Saved notes", content: "A short excerpt" });
  const review = store.review();
  assert.equal(review.categories.personal.count, 16);
  assert.equal(review.categories.personal.entries.length, 12);
  assert.equal(review.categories.threads.entries[0].excerpt.length, 280);
  assert.equal(review.categories.projects.entries[0].title, "Project name");
  assert.deepEqual(review.categories.documents.entries[0], { title: "Saved notes", excerpt: "A short excerpt" });
  assert.doesNotMatch(JSON.stringify(review), /\/private\/marker/);
  await store.merge({ notes: { changed: "Another item" } });
  assert.equal(await resolve.clear({ accountId: "review", revision: review.revision }), null);

  const current = store.review();
  await assert.rejects(resolve.clear({ accountId: "review", revision: current.revision, beforeCommit() { throw new Error("Account changed"); } }),
    /Account changed/);
  assert.deepEqual(store.review(), current);
  assert.equal((await createAccountMemoryResolver(root)({ accountId: "review" })).review().categories.personal.count, 17);

  const { promise, resolve: release } = Promise.withResolvers();
  store.pendingWrite = promise;
  const clearing = resolve.clear({ accountId: "review", revision: current.revision });
  await new Promise(setImmediate);
  assert.ok(store.resetPending);
  const oldWrite = store.merge({ notes: { stale: "Retired write" } });
  release();
  const cleared = await clearing;
  await oldWrite;
  assert.ok(Object.values(cleared.categories).every(({ count }) => count === 0));
  const replacement = await resolve({ accountId: "review" });
  assert.notEqual(replacement, store);
  assert.deepEqual(replacement.review(), cleared);
  assert.deepEqual(await store.appendThreadTurns({ threadId: "old", turns: [{ role: "user", content: "Retired request" }] }), []);
  assert.equal(await store.rememberDocument({ path: "/tmp/stale", content: "Retired document" }), null);
  assert.equal(other.getSnapshot().notes.retained.value, "Other account");
  assert.deepEqual((await createAccountMemoryResolver(root)({ accountId: "review" })).getStoreSnapshot(), createEmptyStoreState());
});

test("MemoryStore migrates legacy personal memory files into the structured schema", async () => {
  const { app, root } = await createTempApp();
  const legacyPayload = {
    identity: {
      name: {
        value: "JYH"
      }
    },
    preferences: {
      language: {
        value: "ko"
      }
    }
  };

  await fs.writeFile(
    path.join(root, "jarvis-memory.json"),
    JSON.stringify(legacyPayload, null, 2),
    "utf8"
  );

  const store = new MemoryStore({ app });
  await store.load();
  const state = store.getStoreSnapshot();

  assert.equal(store.getSnapshot().identity.name.value, "JYH");
  assert.equal(state.personalMemory.preferences.language.value, "ko");
  assert.deepEqual(state.threads, {});
  assert.equal(state.schemaVersion, 2);

  await cleanup(root);
});

test("MemoryStore persists merged long-term memory entries", async () => {
  const { app, root } = await createTempApp();
  const first = new MemoryStore({ app });
  await first.load();

  await first.merge({
    identity: {
      name: {
        value: "JYH"
      }
    },
    preferences: {
      favorite_music: {
        value: "lofi hip hop"
      }
    },
    projects: {
      jarvis_desktop: {
        value: "Building a desktop Jarvis assistant"
      }
    }
  });

  const second = new MemoryStore({ app });
  const snapshot = await second.load();

  assert.equal(snapshot.identity.name.value, "JYH");
  assert.equal(snapshot.preferences.favorite_music.value, "lofi hip hop");
  assert.equal(snapshot.projects.jarvis_desktop.value, "Building a desktop Jarvis assistant");

  await cleanup(root);
});

test("MemoryStore persists thread history and project-scoped conversation retrieval", async () => {
  const { app, root } = await createTempApp();
  const store = new MemoryStore({ app });
  await store.load();

  await store.setThreadContext({
    threadId: "thread-mail",
    projectId: "project-jarvis",
    projectName: "Jarvis"
  });
  await store.appendThreadTurns({
    threadId: "thread-mail",
    projectId: "project-jarvis",
    projectName: "Jarvis",
    turns: [
      {
        role: "user",
        content: "Gmail 열고 가장 최신 Google Pay 메일 누가 보냈는지 확인해줘"
      },
      {
        role: "assistant",
        content: "Gmail을 열고 가장 최신 Google Pay 메일을 확인하고 있어요."
      }
    ]
  });

  const recentTurns = store.getRecentThreadTurns("thread-mail", 4);
  const matches = store.searchConversation({
    query: "google pay 최신 메일",
    threadId: "thread-mail",
    projectId: "project-jarvis",
    limit: 3
  });
  const project = store.getProjectContext("project-jarvis");

  assert.equal(recentTurns.length, 2);
  assert.match(recentTurns[0].content, /Google Pay/i);
  assert.equal(matches[0].scope, "thread");
  assert.match(matches[0].content, /Google Pay/i);
  assert.equal(project.name, "Jarvis");
  assert.equal(project.threadCount, 1);
  assert.match(project.recentTopics[0].text, /Google Pay/i);

  await cleanup(root);
});

test("MemoryStore indexes file content and retrieves the most relevant document chunks", async () => {
  const { app, root } = await createTempApp();
  const store = new MemoryStore({ app });
  await store.load();

  await store.rememberDocument({
    path: "/workspace/jarvis/specs/browser-memory.md",
    threadId: "thread-browser",
    projectId: "project-jarvis",
    projectName: "Jarvis",
    content:
      "OpenClaw browser sessions should keep the current tab context, show a live preview card, and preserve Gmail follow-up questions without resetting the conversation."
  });
  await store.rememberDocument({
    path: "/workspace/travel/notes.md",
    threadId: "thread-travel",
    projectId: "project-travel",
    projectName: "Travel",
    content:
      "Book the Toronto hotel, compare train schedules, and check the passport expiry date."
  });

  const matches = store.searchDocuments({
    query: "gmail follow-up current tab preview card",
    threadId: "thread-browser",
    projectId: "project-jarvis",
    limit: 2
  });
  const project = store.getProjectContext("project-jarvis");

  assert.equal(matches[0].scope, "thread");
  assert.equal(matches[0].path, "/workspace/jarvis/specs/browser-memory.md");
  assert.match(matches[0].excerpt, /preview card/i);
  assert(project.filePaths.includes("/workspace/jarvis/specs/browser-memory.md"));

  await cleanup(root);
});

test("MemoryStore skips persistence when the memory mode is temporary", async () => {
  const { app, root } = await createTempApp();
  const store = new MemoryStore({ app });
  await store.load();

  await store.appendThreadTurns({
    threadId: "thread-temp",
    memoryMode: "temporary",
    turns: [
      {
        role: "user",
        content: "이건 임시 대화라서 저장되면 안 돼"
      }
    ]
  });
  await store.rememberDocument({
    path: "/tmp/temporary.txt",
    content: "temporary content",
    threadId: "thread-temp",
    memoryMode: "temporary"
  });

  assert.deepEqual(store.getRecentThreadTurns("thread-temp", 4), []);
  assert.deepEqual(store.searchDocuments({
    query: "temporary content",
    threadId: "thread-temp",
    limit: 1
  }), []);

  await cleanup(root);
});

test("formatMemoryForPrompt creates a compact prompt-friendly summary", () => {
  const summary = formatMemoryForPrompt({
    identity: {
      name: {
        value: "JYH"
      }
    },
    preferences: {
      favorite_app: {
        value: "Spotify"
      }
    },
    projects: {
      jarvis: {
        value: "Shipping a Jarvis desktop app"
      }
    }
  });

  assert.match(summary, /Identity/);
  assert.match(summary, /Name: JYH/);
  assert.match(summary, /Preferences/);
  assert.match(summary, /Favorite App: Spotify/);
  assert.match(summary, /Projects/);
  assert.match(summary, /Jarvis: Shipping a Jarvis desktop app/);
});
