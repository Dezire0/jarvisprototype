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
const MAX_VALUE_LENGTH = 280;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createEmptyMemory() {
  return Object.fromEntries(MEMORY_SECTIONS.map((section) => [section, {}]));
}

function cloneMemory(memory = createEmptyMemory()) {
  return JSON.parse(JSON.stringify(memory));
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

class MemoryStore {
  constructor({ app }) {
    this.app = app;
    this.cache = createEmptyMemory();
  }

  get memoryPath() {
    return path.join(this.app.getPath("userData"), "jarvis-memory.json");
  }

  async load() {
    try {
      const raw = await fs.readFile(this.memoryPath, "utf8");
      this.cache = normalizeMemory(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      this.cache = createEmptyMemory();
    }

    return this.getSnapshot();
  }

  async writeCache() {
    await fs.mkdir(path.dirname(this.memoryPath), {
      recursive: true
    });
    await fs.writeFile(this.memoryPath, JSON.stringify(this.cache, null, 2), "utf8");
  }

  getSnapshot() {
    return cloneMemory(this.cache);
  }

  formatForPrompt() {
    return formatMemoryForPrompt(this.cache);
  }

  async merge(update = {}) {
    const normalized = normalizeMemory(update);
    let changed = false;

    for (const section of MEMORY_SECTIONS) {
      if (mergeSection(this.cache[section], normalized[section])) {
        changed = true;
      }
    }

    if (changed) {
      await this.writeCache();
    }

    return this.getSnapshot();
  }
}

module.exports = {
  MemoryStore,
  createEmptyMemory,
  formatMemoryForPrompt,
  normalizeMemory
};
