const fs = require("node:fs/promises");
const path = require("node:path");

const MEMORY_SECTIONS = [
  "identity",
  "preferences",
  "projects",
  "relationships",
  "wishes",
  "notes"
];
const CURRENT_SCHEMA_VERSION = 2;
const MAX_VALUE_LENGTH = 280;
const MAX_THREAD_TURNS = 240;
const MAX_TURN_CONTENT_LENGTH = 3200;
const MAX_PROJECT_TOPICS = 18;
const MAX_PROJECT_FILES = 36;
const MAX_DOCUMENT_CHUNKS = 48;
const DOCUMENT_CHUNK_SIZE = 900;
const DOCUMENT_CHUNK_OVERLAP = 120;
const SEARCH_TOKEN_PATTERN = /[a-z0-9가-힣]+/gi;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createEmptyMemory() {
  return Object.fromEntries(MEMORY_SECTIONS.map((section) => [section, {}]));
}

function createEmptyStoreState() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    personalMemory: createEmptyMemory(),
    threads: {},
    projects: {},
    documents: {}
  };
}

function cloneMemory(memory = createEmptyMemory()) {
  return JSON.parse(JSON.stringify(memory));
}

function cloneStoreState(state = createEmptyStoreState()) {
  return JSON.parse(JSON.stringify(state));
}

function trimMemoryValue(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= MAX_VALUE_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_VALUE_LENGTH - 1).trim()}…`;
}

function trimStoredText(value, limit = MAX_TURN_CONTENT_LENGTH) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 1).trim()}…`;
}

function normalizeSection(input = {}) {
  if (!isPlainObject(input)) {
    return {};
  }

  const next = {};

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = String(rawKey || "").trim();

    if (!key) {
      continue;
    }

    if (isPlainObject(rawValue) && !Object.prototype.hasOwnProperty.call(rawValue, "value")) {
      const nested = normalizeSection(rawValue);

      if (Object.keys(nested).length) {
        next[key] = nested;
      }

      continue;
    }

    const cleanValue = trimMemoryValue(
      isPlainObject(rawValue) && Object.prototype.hasOwnProperty.call(rawValue, "value")
        ? rawValue.value
        : rawValue
    );

    if (!cleanValue) {
      continue;
    }

    next[key] = {
      value: cleanValue,
      updatedAt:
        isPlainObject(rawValue) && String(rawValue.updatedAt || "").trim()
          ? String(rawValue.updatedAt).trim()
          : new Date().toISOString()
    };
  }

  return next;
}

function normalizeMemory(input = {}) {
  const base = createEmptyMemory();

  if (!isPlainObject(input)) {
    return base;
  }

  for (const section of MEMORY_SECTIONS) {
    base[section] = normalizeSection(input[section] || {});
  }

  return base;
}

function mergeSection(target, patch) {
  let changed = false;

  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && !Object.prototype.hasOwnProperty.call(value, "value")) {
      if (!isPlainObject(target[key])) {
        target[key] = {};
        changed = true;
      }

      if (mergeSection(target[key], value)) {
        changed = true;
      }

      continue;
    }

    const cleanValue = trimMemoryValue(
      isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, "value")
        ? value.value
        : value
    );

    if (!cleanValue) {
      continue;
    }

    const existing = isPlainObject(target[key]) ? target[key] : null;

    if (!existing || existing.value !== cleanValue) {
      target[key] = {
        value: cleanValue,
        updatedAt: new Date().toISOString()
      };
      changed = true;
    }
  }

  return changed;
}

function formatLabel(value = "") {
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function appendFormattedEntries(lines, title, entries, limit) {
  const keys = Object.keys(entries || {});

  if (!keys.length) {
    return;
  }

  lines.push(title);
  let count = 0;

  for (const key of keys) {
    if (count >= limit) {
      break;
    }

    const entry = entries[key];

    if (!entry) {
      continue;
    }

    if (isPlainObject(entry) && Object.prototype.hasOwnProperty.call(entry, "value")) {
      lines.push(`- ${formatLabel(key)}: ${entry.value}`);
      count += 1;
      continue;
    }

    if (isPlainObject(entry)) {
      for (const [nestedKey, nestedEntry] of Object.entries(entry)) {
        if (count >= limit) {
          break;
        }

        if (isPlainObject(nestedEntry) && Object.prototype.hasOwnProperty.call(nestedEntry, "value")) {
          lines.push(`- ${formatLabel(key)} / ${formatLabel(nestedKey)}: ${nestedEntry.value}`);
          count += 1;
        }
      }
    }
  }
}

function formatMemoryForPrompt(memory = createEmptyMemory()) {
  const normalized = normalizeMemory(memory);
  const lines = [];

  appendFormattedEntries(lines, "Identity", normalized.identity, 8);
  appendFormattedEntries(lines, "Preferences", normalized.preferences, 10);
  appendFormattedEntries(lines, "Projects", normalized.projects, 8);
  appendFormattedEntries(lines, "Relationships", normalized.relationships, 8);
  appendFormattedEntries(lines, "Wishes", normalized.wishes, 8);
  appendFormattedEntries(lines, "Notes", normalized.notes, 8);

  return lines.join("\n").trim();
}

function normalizeIsoDate(value, fallback = new Date().toISOString()) {
  const clean = String(value || "").trim();

  if (!clean) {
    return fallback;
  }

  const timestamp = Date.parse(clean);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function normalizeId(value = "") {
  return String(value || "").trim();
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const next = [];

  for (const value of values || []) {
    const clean = normalizeId(value);

    if (!clean || seen.has(clean)) {
      continue;
    }

    seen.add(clean);
    next.push(clean);
  }

  return next;
}

function tokenizeSearchText(text = "") {
  const matches = String(text || "").toLowerCase().match(SEARCH_TOKEN_PATTERN) || [];
  const unique = [];
  const seen = new Set();

  for (const token of matches) {
    const clean = token.trim();

    if (!clean) {
      continue;
    }

    if (clean.length < 2 && !/[가-힣]/.test(clean)) {
      continue;
    }

    if (seen.has(clean)) {
      continue;
    }

    seen.add(clean);
    unique.push(clean);
  }

  return unique;
}

function scoreTextMatch(text = "", query = "", queryTokens = []) {
  const haystack = String(text || "").toLowerCase();
  const normalizedQuery = String(query || "").toLowerCase().trim();
  let score = 0;

  if (!haystack) {
    return 0;
  }

  if (normalizedQuery && haystack.includes(normalizedQuery)) {
    score += 12;
  }

  let tokenMatches = 0;

  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      tokenMatches += 1;
      score += 3;
    }
  }

  if (!normalizedQuery && !tokenMatches) {
    return 0;
  }

  if (tokenMatches && tokenMatches === queryTokens.length) {
    score += 4;
  }

  if (tokenMatches) {
    score += tokenMatches / Math.max(queryTokens.length, 1);
  }

  return score;
}

function scoreRecency(updatedAt = "") {
  const timestamp = Date.parse(String(updatedAt || "").trim());

  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  const age = Date.now() - timestamp;
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  if (age <= hour) {
    return 2;
  }

  if (age <= day) {
    return 1.4;
  }

  if (age <= 7 * day) {
    return 0.8;
  }

  return 0.25;
}

function createThreadRecord(threadId, now = new Date().toISOString()) {
  return {
    id: threadId,
    title: "",
    projectId: "",
    projectName: "",
    createdAt: now,
    updatedAt: now,
    turns: []
  };
}

function normalizeTurn(rawTurn, index = 0) {
  if (!isPlainObject(rawTurn)) {
    return null;
  }

  const role = rawTurn.role === "assistant" ? "assistant" : "user";
  const content = trimStoredText(rawTurn.content, MAX_TURN_CONTENT_LENGTH);

  if (!content) {
    return null;
  }

  const createdAt = normalizeIsoDate(rawTurn.createdAt);
  const route = normalizeId(rawTurn.route);

  return {
    id: normalizeId(rawTurn.id) || `turn-${createdAt}-${index}`,
    role,
    content,
    createdAt,
    ...(route ? { route } : {})
  };
}

function normalizeThreadRecord(rawThread, threadId) {
  const base = createThreadRecord(threadId);

  if (!isPlainObject(rawThread)) {
    return base;
  }

  const turns = Array.isArray(rawThread.turns)
    ? rawThread.turns
        .map((turn, index) => normalizeTurn(turn, index))
        .filter(Boolean)
        .slice(-MAX_THREAD_TURNS)
    : [];
  const createdAt = normalizeIsoDate(rawThread.createdAt, turns[0]?.createdAt || base.createdAt);
  const updatedAt = normalizeIsoDate(rawThread.updatedAt, turns[turns.length - 1]?.createdAt || createdAt);

  return {
    id: threadId,
    title: trimStoredText(rawThread.title, 160),
    projectId: normalizeId(rawThread.projectId),
    projectName: trimStoredText(rawThread.projectName, 160),
    createdAt,
    updatedAt,
    turns
  };
}

function normalizeTopic(rawTopic) {
  if (isPlainObject(rawTopic)) {
    const text = trimStoredText(rawTopic.text, 200);

    if (!text) {
      return null;
    }

    return {
      text,
      updatedAt: normalizeIsoDate(rawTopic.updatedAt)
    };
  }

  const text = trimStoredText(rawTopic, 200);

  if (!text) {
    return null;
  }

  return {
    text,
    updatedAt: new Date().toISOString()
  };
}

function normalizeProjectRecord(rawProject, projectId) {
  const now = new Date().toISOString();

  if (!isPlainObject(rawProject)) {
    return {
      id: projectId,
      name: "",
      createdAt: now,
      updatedAt: now,
      threadIds: [],
      filePaths: [],
      recentTopics: []
    };
  }

  return {
    id: projectId,
    name: trimStoredText(rawProject.name, 160),
    createdAt: normalizeIsoDate(rawProject.createdAt, now),
    updatedAt: normalizeIsoDate(rawProject.updatedAt, now),
    threadIds: uniqueStrings(rawProject.threadIds).slice(-MAX_THREAD_TURNS),
    filePaths: uniqueStrings(rawProject.filePaths).slice(0, MAX_PROJECT_FILES),
    recentTopics: Array.isArray(rawProject.recentTopics)
      ? rawProject.recentTopics
          .map(normalizeTopic)
          .filter(Boolean)
          .slice(0, MAX_PROJECT_TOPICS)
      : []
  };
}

function chunkDocumentContent(content = "") {
  const normalized = String(content || "").replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return [];
  }

  const chunks = [];
  let start = 0;
  let ordinal = 0;

  while (start < normalized.length && chunks.length < MAX_DOCUMENT_CHUNKS) {
    let end = Math.min(normalized.length, start + DOCUMENT_CHUNK_SIZE);

    if (end < normalized.length) {
      const newlineIndex = normalized.lastIndexOf("\n", end);
      const sentenceIndex = normalized.lastIndexOf(". ", end);
      const whitespaceIndex = normalized.lastIndexOf(" ", end);
      const boundary = Math.max(newlineIndex, sentenceIndex, whitespaceIndex);

      if (boundary > start + Math.floor(DOCUMENT_CHUNK_SIZE * 0.55)) {
        end = boundary + 1;
      }
    }

    const text = normalized.slice(start, end).trim();

    if (text) {
      chunks.push({
        id: `chunk-${ordinal + 1}`,
        ordinal,
        text
      });
      ordinal += 1;
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - DOCUMENT_CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}

function normalizeDocumentChunk(rawChunk, index = 0) {
  if (!isPlainObject(rawChunk)) {
    return null;
  }

  const text = trimStoredText(rawChunk.text, DOCUMENT_CHUNK_SIZE * 2);

  if (!text) {
    return null;
  }

  return {
    id: normalizeId(rawChunk.id) || `chunk-${index + 1}`,
    ordinal: Number.isInteger(rawChunk.ordinal) ? rawChunk.ordinal : index,
    text
  };
}

function normalizeDocumentRecord(rawDocument, documentId) {
  const now = new Date().toISOString();

  if (!isPlainObject(rawDocument)) {
    return {
      id: documentId,
      path: documentId,
      title: path.basename(documentId),
      projectId: "",
      projectName: "",
      threadIds: [],
      updatedAt: now,
      chunks: []
    };
  }

  const documentPath = trimStoredText(rawDocument.path || documentId, 800);
  const chunks = Array.isArray(rawDocument.chunks)
    ? rawDocument.chunks
        .map((chunk, index) => normalizeDocumentChunk(chunk, index))
        .filter(Boolean)
        .slice(0, MAX_DOCUMENT_CHUNKS)
    : chunkDocumentContent(rawDocument.content || "");

  return {
    id: documentId,
    path: documentPath || documentId,
    title: trimStoredText(rawDocument.title || path.basename(documentPath || documentId), 160),
    projectId: normalizeId(rawDocument.projectId),
    projectName: trimStoredText(rawDocument.projectName, 160),
    threadIds: uniqueStrings(rawDocument.threadIds).slice(0, 48),
    updatedAt: normalizeIsoDate(rawDocument.updatedAt, now),
    chunks
  };
}

function normalizeStoreState(input = {}) {
  const base = createEmptyStoreState();

  if (!isPlainObject(input)) {
    return base;
  }

  const isStructuredStore =
    Object.prototype.hasOwnProperty.call(input, "schemaVersion") ||
    Object.prototype.hasOwnProperty.call(input, "personalMemory") ||
    Object.prototype.hasOwnProperty.call(input, "threads") ||
    Object.prototype.hasOwnProperty.call(input, "documents");

  if (!isStructuredStore) {
    base.personalMemory = normalizeMemory(input);
    return base;
  }

  base.personalMemory = normalizeMemory(input.personalMemory || {});

  if (isPlainObject(input.threads)) {
    for (const [threadId, rawThread] of Object.entries(input.threads)) {
      const cleanThreadId = normalizeId(threadId);

      if (!cleanThreadId) {
        continue;
      }

      base.threads[cleanThreadId] = normalizeThreadRecord(rawThread, cleanThreadId);
    }
  }

  if (isPlainObject(input.projects)) {
    for (const [projectId, rawProject] of Object.entries(input.projects)) {
      const cleanProjectId = normalizeId(projectId);

      if (!cleanProjectId) {
        continue;
      }

      base.projects[cleanProjectId] = normalizeProjectRecord(rawProject, cleanProjectId);
    }
  }

  if (isPlainObject(input.documents)) {
    for (const [documentId, rawDocument] of Object.entries(input.documents)) {
      const cleanDocumentId = normalizeId(documentId);

      if (!cleanDocumentId) {
        continue;
      }

      base.documents[cleanDocumentId] = normalizeDocumentRecord(rawDocument, cleanDocumentId);
    }
  }

  base.schemaVersion = CURRENT_SCHEMA_VERSION;
  return base;
}

class MemoryStore {
  constructor({ app }) {
    this.app = app;
    this.state = createEmptyStoreState();
    this.cache = this.state.personalMemory;
  }

  get memoryPath() {
    return path.join(this.app.getPath("userData"), "jarvis-memory.json");
  }

  async load() {
    try {
      const raw = await fs.readFile(this.memoryPath, "utf8");
      this.state = normalizeStoreState(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      this.state = createEmptyStoreState();
    }

    this.cache = this.state.personalMemory;
    return this.getSnapshot();
  }

  async writeState() {
    await fs.mkdir(path.dirname(this.memoryPath), {
      recursive: true
    });
    this.state.schemaVersion = CURRENT_SCHEMA_VERSION;
    this.cache = this.state.personalMemory;
    await fs.writeFile(this.memoryPath, JSON.stringify(this.state, null, 2), "utf8");
  }

  async writeCache() {
    await this.writeState();
  }

  getSnapshot() {
    return cloneMemory(this.state.personalMemory);
  }

  getStoreSnapshot() {
    return cloneStoreState(this.state);
  }

  formatForPrompt() {
    return formatMemoryForPrompt(this.state.personalMemory);
  }

  async merge(update = {}) {
    const normalized = normalizeMemory(update);
    let changed = false;

    for (const section of MEMORY_SECTIONS) {
      if (mergeSection(this.state.personalMemory[section], normalized[section])) {
        changed = true;
      }
    }

    if (changed) {
      await this.writeState();
    }

    return this.getSnapshot();
  }

  getOrCreateThread(threadId, now = new Date().toISOString()) {
    if (!this.state.threads[threadId]) {
      this.state.threads[threadId] = createThreadRecord(threadId, now);
    }

    return this.state.threads[threadId];
  }

  getOrCreateProject(projectId, projectName = "", now = new Date().toISOString()) {
    if (!this.state.projects[projectId]) {
      this.state.projects[projectId] = normalizeProjectRecord(
        {
          name: projectName,
          createdAt: now,
          updatedAt: now
        },
        projectId
      );
    }

    const project = this.state.projects[projectId];

    if (projectName && project.name !== projectName) {
      project.name = trimStoredText(projectName, 160);
    }

    return project;
  }

  linkThreadToProject({ threadId, projectId, projectName = "", now = new Date().toISOString() }) {
    if (!threadId || !projectId) {
      return false;
    }

    const project = this.getOrCreateProject(projectId, projectName, now);
    let changed = false;

    if (!project.threadIds.includes(threadId)) {
      project.threadIds = [threadId, ...project.threadIds].slice(0, MAX_THREAD_TURNS);
      changed = true;
    }

    if (projectName) {
      const cleanProjectName = trimStoredText(projectName, 160);

      if (cleanProjectName && project.name !== cleanProjectName) {
        project.name = cleanProjectName;
        changed = true;
      }
    }

    if (changed || project.updatedAt !== now) {
      project.updatedAt = now;
      changed = true;
    }

    return changed;
  }

  noteProjectTopic(projectId, text, now = new Date().toISOString()) {
    if (!projectId) {
      return false;
    }

    const cleanText = trimStoredText(text, 200);

    if (!cleanText) {
      return false;
    }

    const project = this.getOrCreateProject(projectId, "", now);
    const existing = project.recentTopics.filter((topic) => topic?.text && topic.text !== cleanText);
    project.recentTopics = [
      {
        text: cleanText,
        updatedAt: now
      },
      ...existing
    ].slice(0, MAX_PROJECT_TOPICS);
    project.updatedAt = now;
    return true;
  }

  noteProjectFile(projectId, filePath, now = new Date().toISOString()) {
    if (!projectId) {
      return false;
    }

    const cleanPath = trimStoredText(filePath, 800);

    if (!cleanPath) {
      return false;
    }

    const project = this.getOrCreateProject(projectId, "", now);
    const existing = project.filePaths.filter((entry) => entry !== cleanPath);
    project.filePaths = [cleanPath, ...existing].slice(0, MAX_PROJECT_FILES);
    project.updatedAt = now;
    return true;
  }

  updateThreadMetadata(thread, context = {}, now = new Date().toISOString()) {
    let changed = false;
    const hasTitle = Object.prototype.hasOwnProperty.call(context, "title") || Object.prototype.hasOwnProperty.call(context, "threadTitle");
    const hasProjectId = Object.prototype.hasOwnProperty.call(context, "projectId");
    const hasProjectName = Object.prototype.hasOwnProperty.call(context, "projectName");
    const title = trimStoredText(context.title || context.threadTitle, 160);
    const projectId = hasProjectId ? normalizeId(context.projectId) : undefined;
    const projectName = hasProjectName ? trimStoredText(context.projectName, 160) : undefined;

    if (hasTitle && title && thread.title !== title) {
      thread.title = title;
      changed = true;
    }

    if (hasProjectId && thread.projectId !== projectId) {
      thread.projectId = projectId || "";
      changed = true;
    }

    if (hasProjectName && thread.projectName !== (projectName || "")) {
      thread.projectName = projectName || "";
      changed = true;
    }

    if (thread.projectId) {
      if (this.linkThreadToProject({
        threadId: thread.id,
        projectId: thread.projectId,
        projectName: thread.projectName,
        now
      })) {
        changed = true;
      }
    } else if (hasProjectId && thread.projectName) {
      thread.projectName = "";
      changed = true;
    }

    if (changed) {
      thread.updatedAt = now;
    }

    return changed;
  }

  async setThreadContext(context = {}) {
    const memoryMode = context.memoryMode === "temporary" ? "temporary" : "persistent";
    const threadId = normalizeId(context.threadId);

    if (!threadId || memoryMode === "temporary") {
      return null;
    }

    const now = new Date().toISOString();
    const thread = this.getOrCreateThread(threadId, now);
    const changed = this.updateThreadMetadata(thread, context, now);

    if (changed) {
      await this.writeState();
    }

    return cloneStoreState({
      thread
    }).thread;
  }

  getRecentThreadTurns(threadId, limit = 12) {
    const cleanThreadId = normalizeId(threadId);
    const thread = cleanThreadId ? this.state.threads[cleanThreadId] : null;

    if (!thread?.turns?.length) {
      return [];
    }

    return cloneStoreState({
      turns: thread.turns.slice(-Math.max(1, limit))
    }).turns;
  }

  async appendThreadTurns(options = {}) {
    const memoryMode = options.memoryMode === "temporary" ? "temporary" : "persistent";
    const threadId = normalizeId(options.threadId);
    const turns = Array.isArray(options.turns) ? options.turns : [];

    if (!threadId || memoryMode === "temporary" || !turns.length) {
      return [];
    }

    const now = new Date().toISOString();
    const thread = this.getOrCreateThread(threadId, now);
    let changed = this.updateThreadMetadata(thread, options, now);

    for (const rawTurn of turns) {
      const normalizedTurn = normalizeTurn(
        {
          ...rawTurn,
          createdAt: rawTurn?.createdAt || now
        },
        thread.turns.length
      );

      if (!normalizedTurn) {
        continue;
      }

      const lastTurn = thread.turns[thread.turns.length - 1];
      if (
        lastTurn &&
        lastTurn.role === normalizedTurn.role &&
        lastTurn.content === normalizedTurn.content
      ) {
        continue;
      }

      thread.turns.push(normalizedTurn);
      changed = true;

      if (normalizedTurn.role === "user" && thread.projectId) {
        if (this.noteProjectTopic(thread.projectId, normalizedTurn.content, normalizedTurn.createdAt)) {
          changed = true;
        }
      }
    }

    if (thread.turns.length > MAX_THREAD_TURNS) {
      thread.turns = thread.turns.slice(-MAX_THREAD_TURNS);
      changed = true;
    }

    if (changed) {
      thread.updatedAt = thread.turns[thread.turns.length - 1]?.createdAt || now;
      await this.writeState();
    }

    return this.getRecentThreadTurns(threadId, turns.length);
  }

  getProjectContext(projectId) {
    const cleanProjectId = normalizeId(projectId);
    const project = cleanProjectId ? this.state.projects[cleanProjectId] : null;

    if (!project) {
      return null;
    }

    return {
      id: project.id,
      name: project.name,
      threadCount: project.threadIds.length,
      filePaths: [...project.filePaths],
      recentTopics: project.recentTopics.map((topic) => ({
        text: topic.text,
        updatedAt: topic.updatedAt
      })),
      updatedAt: project.updatedAt
    };
  }

  searchConversation({ query = "", threadId = "", projectId = "", limit = 6 } = {}) {
    const normalizedQuery = trimStoredText(query, 400);
    const queryTokens = tokenizeSearchText(normalizedQuery);

    if (!normalizedQuery && !queryTokens.length) {
      return [];
    }

    const results = [];

    for (const thread of Object.values(this.state.threads)) {
      if (!thread?.turns?.length) {
        continue;
      }

      const scope = thread.id === threadId ? "thread" : thread.projectId && thread.projectId === projectId ? "project" : "global";
      const scopeWeight = scope === "thread" ? 6 : scope === "project" ? 3 : 1;

      for (const turn of thread.turns) {
        const baseScore = scoreTextMatch(turn.content, normalizedQuery, queryTokens);

        if (baseScore <= 0) {
          continue;
        }

        results.push({
          threadId: thread.id,
          projectId: thread.projectId || "",
          projectName: thread.projectName || "",
          title: thread.title || "",
          role: turn.role,
          content: turn.content,
          createdAt: turn.createdAt,
          scope,
          score: baseScore + scopeWeight + scoreRecency(turn.createdAt)
        });
      }
    }

    return results
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, limit))
      .map(({ score, ...match }) => match);
  }

  async rememberDocument(options = {}) {
    const memoryMode = options.memoryMode === "temporary" ? "temporary" : "persistent";
    const documentPath = trimStoredText(options.path, 800);

    if (!documentPath || memoryMode === "temporary") {
      return null;
    }

    const now = new Date().toISOString();
    const documentId = documentPath;
    const document = this.state.documents[documentId] || normalizeDocumentRecord({}, documentId);
    const projectId = normalizeId(options.projectId || document.projectId);
    const projectName = trimStoredText(options.projectName || document.projectName, 160);
    const threadId = normalizeId(options.threadId);
    let changed = false;

    document.path = documentPath;
    document.title = trimStoredText(options.title || path.basename(documentPath), 160);
    document.projectId = projectId;
    document.projectName = projectName;
    document.updatedAt = now;
    document.chunks = chunkDocumentContent(options.content || "");

    if (threadId && !document.threadIds.includes(threadId)) {
      document.threadIds = [threadId, ...document.threadIds].slice(0, 48);
    }

    this.state.documents[documentId] = document;
    changed = true;

    if (projectId) {
      if (this.linkThreadToProject({
        threadId,
        projectId,
        projectName,
        now
      })) {
        changed = true;
      }

      if (this.noteProjectFile(projectId, documentPath, now)) {
        changed = true;
      }
    }

    if (changed) {
      await this.writeState();
    }

    return cloneStoreState({
      document
    }).document;
  }

  searchDocuments({ query = "", threadId = "", projectId = "", limit = 4 } = {}) {
    const normalizedQuery = trimStoredText(query, 400);
    const queryTokens = tokenizeSearchText(normalizedQuery);

    if (!normalizedQuery && !queryTokens.length) {
      return [];
    }

    const results = [];

    for (const document of Object.values(this.state.documents)) {
      const scope = document.threadIds.includes(threadId)
        ? "thread"
        : document.projectId && document.projectId === projectId
          ? "project"
          : "global";
      const scopeWeight = scope === "thread" ? 6 : scope === "project" ? 3 : 1;

      for (const chunk of document.chunks || []) {
        const baseScore = scoreTextMatch(chunk.text, normalizedQuery, queryTokens);

        if (baseScore <= 0) {
          continue;
        }

        results.push({
          path: document.path,
          title: document.title,
          projectId: document.projectId,
          projectName: document.projectName,
          updatedAt: document.updatedAt,
          scope,
          excerpt: chunk.text,
          score: baseScore + scopeWeight + scoreRecency(document.updatedAt)
        });
      }
    }

    return results
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, limit))
      .map(({ score, ...match }) => match);
  }
}

module.exports = {
  MemoryStore,
  createEmptyMemory,
  createEmptyStoreState,
  formatMemoryForPrompt,
  normalizeMemory,
  tokenizeSearchText
};
