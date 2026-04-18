const fs = require("node:fs/promises");
const path = require("node:path");

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [value];
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeToken(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function interpolateEnv(value = "") {
  return String(value).replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, name) => process.env[name] || "");
}

function readPathValue(payload, pathExpression = "") {
  const parts = String(pathExpression)
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  let current = payload;

  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

class ExtensionsService {
  constructor({ app = null, workspaceRoot = process.cwd(), fetchImpl = globalThis.fetch } = {}) {
    this.app = app || null;
    this.workspaceRoot = workspaceRoot;
    this.fetchImpl = fetchImpl;
    this.registry = {
      connectors: [],
      skills: [],
      webhooks: []
    };
    this.loadedFiles = [];
  }

  getRegistryRoots() {
    const roots = [path.join(this.workspaceRoot, "extensions")];

    if (this.app) {
      roots.push(path.join(this.app.getPath("userData"), "extensions"));
    }

    return uniqueStrings(roots);
  }

  normalizeConnector(raw = {}, filePath = "") {
    const connector = raw.connector || raw.config || {};
    const match = raw.match || {};
    const canonicalName = String(
      connector.canonicalName || connector.appName || raw.appName || raw.name || path.basename(filePath, ".json")
    ).trim();

    return {
      kind: "connector",
      filePath,
      name: String(raw.name || canonicalName || path.basename(filePath, ".json")).trim(),
      description: String(raw.description || connector.description || "").trim(),
      enabled: raw.enabled !== false,
      canonicalName,
      aliases: uniqueStrings([
        canonicalName,
        ...ensureArray(raw.aliases),
        ...ensureArray(match.apps),
        ...ensureArray(match.aliases),
        ...ensureArray(connector.aliases)
      ]),
      planningHints: uniqueStrings([
        ...ensureArray(raw.planningHints),
        ...ensureArray(connector.planningHints),
        connector.instructions || raw.instructions || ""
      ])
    };
  }

  normalizeSkill(raw = {}, filePath = "") {
    const skill = raw.skill || raw.config || {};
    const match = raw.match || {};

    return {
      kind: "skill",
      filePath,
      name: String(raw.name || path.basename(filePath, ".json")).trim(),
      description: String(raw.description || skill.description || "").trim(),
      enabled: raw.enabled !== false,
      apps: uniqueStrings([
        ...ensureArray(raw.apps),
        ...ensureArray(match.apps),
        ...ensureArray(skill.apps)
      ]),
      instructions: String(skill.instructions || raw.instructions || "").trim(),
      planningHints: uniqueStrings([
        ...ensureArray(raw.planningHints),
        ...ensureArray(skill.planningHints)
      ])
    };
  }

  normalizeWebhook(raw = {}, filePath = "") {
    const webhook = raw.webhook || raw.config || {};
    const match = raw.match || raw.triggers || {};

    return {
      kind: "webhook",
      filePath,
      name: String(raw.name || path.basename(filePath, ".json")).trim(),
      description: String(raw.description || webhook.description || "").trim(),
      enabled: raw.enabled !== false,
      phrases: uniqueStrings([
        ...ensureArray(raw.phrases),
        ...ensureArray(match.phrases),
        ...ensureArray(webhook.phrases)
      ]),
      regex: uniqueStrings([
        ...ensureArray(raw.regex),
        ...ensureArray(match.regex),
        ...ensureArray(webhook.regex)
      ]),
      url: interpolateEnv(webhook.url || raw.url || ""),
      method: String(webhook.method || raw.method || "POST").trim().toUpperCase(),
      headers: Object.fromEntries(
        Object.entries(webhook.headers || raw.headers || {}).map(([key, value]) => [key, interpolateEnv(value)])
      ),
      timeoutMs: Number(webhook.timeoutMs || raw.timeoutMs) || 12_000,
      responsePath: String(webhook.responsePath || raw.responsePath || "").trim(),
      successReply: String(webhook.successReply || raw.successReply || "").trim(),
      includeHistory: webhook.includeHistory !== false && raw.includeHistory !== false
    };
  }

  normalizeManifest(raw = {}, filePath = "") {
    const kind = String(raw.kind || raw.type || "").trim().toLowerCase();

    if (kind === "connector") {
      return this.normalizeConnector(raw, filePath);
    }

    if (kind === "skill") {
      return this.normalizeSkill(raw, filePath);
    }

    if (kind === "webhook") {
      return this.normalizeWebhook(raw, filePath);
    }

    return null;
  }

  async load() {
    const nextRegistry = {
      connectors: [],
      skills: [],
      webhooks: []
    };
    const loadedFiles = [];

    for (const root of this.getRegistryRoots()) {
      let entries = [];

      try {
        entries = await fs.readdir(root, {
          withFileTypes: true
        });
      } catch (error) {
        if (error.code === "ENOENT") {
          continue;
        }

        throw error;
      }

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
          continue;
        }

        const filePath = path.join(root, entry.name);

        try {
          const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
          const manifest = this.normalizeManifest(raw, filePath);

          if (!manifest || manifest.enabled === false) {
            continue;
          }

          nextRegistry[`${manifest.kind}s`].push(manifest);
          loadedFiles.push(filePath);
        } catch (_error) {
          // Skip malformed manifests so one bad file does not break Jarvis.
        }
      }
    }

    this.registry = nextRegistry;
    this.loadedFiles = loadedFiles;
    return this.list();
  }

  list() {
    return cloneValue({
      connectors: this.registry.connectors,
      skills: this.registry.skills,
      webhooks: this.registry.webhooks,
      loadedFiles: this.loadedFiles
    });
  }

  getSummary() {
    return {
      connectors: this.registry.connectors.length,
      skills: this.registry.skills.length,
      webhooks: this.registry.webhooks.length
    };
  }

  resolveConnectorAppName(requestedApp = "") {
    const normalizedRequestedApp = normalizeToken(requestedApp);

    if (!normalizedRequestedApp) {
      return "";
    }

    const connector = this.registry.connectors.find((entry) =>
      entry.aliases.some((alias) => normalizeToken(alias) === normalizedRequestedApp)
    );

    return connector?.canonicalName || requestedApp;
  }

  getAppPlanningHints(appName = "") {
    const normalizedAppName = normalizeToken(appName);

    if (!normalizedAppName) {
      return [];
    }

    const connectorHints = this.registry.connectors
      .filter((entry) => entry.aliases.some((alias) => normalizeToken(alias) === normalizedAppName))
      .flatMap((entry) => entry.planningHints);
    const skillHints = this.registry.skills
      .filter((entry) => entry.apps.some((candidate) => normalizeToken(candidate) === normalizedAppName))
      .flatMap((entry) => [entry.instructions, ...entry.planningHints]);

    return uniqueStrings([...connectorHints, ...skillHints]);
  }

  getConnectorNames() {
    return uniqueStrings(this.registry.connectors.map((entry) => entry.canonicalName));
  }

  matchWebhook(input = "") {
    const lowered = String(input).trim().toLowerCase();

    if (!lowered) {
      return null;
    }

    for (const webhook of this.registry.webhooks) {
      if (webhook.phrases.some((phrase) => lowered.includes(String(phrase).toLowerCase()))) {
        return webhook;
      }

      for (const expression of webhook.regex) {
        try {
          if (new RegExp(expression, "i").test(input)) {
            return webhook;
          }
        } catch (_error) {
          // Ignore invalid regex and continue.
        }
      }
    }

    return null;
  }

  buildWebhookPayload(input, context = {}) {
    return {
      source: "jarvis-desktop",
      input,
      language: context.language || "ko",
      timestamp: new Date().toISOString(),
      lastActiveApp: context.lastActiveApp || "",
      route: context.route || "",
      history: Array.isArray(context.history) ? context.history : []
    };
  }

  async invokeWebhook(entry, input, context = {}) {
    if (!entry?.url) {
      throw new Error(`Webhook "${entry?.name || "unknown"}" is missing a URL.`);
    }

    if (typeof this.fetchImpl !== "function") {
      throw new Error("Global fetch is not available in this runtime.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), entry.timeoutMs);
    const payload = this.buildWebhookPayload(input, {
      ...context,
      history: entry.includeHistory ? context.history : []
    });

    try {
      const method = entry.method || "POST";
      const isGet = method === "GET";
      const requestUrl = isGet
        ? `${entry.url}${entry.url.includes("?") ? "&" : "?"}input=${encodeURIComponent(input)}`
        : entry.url;
      const response = await this.fetchImpl(requestUrl, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...entry.headers
        },
        body: isGet ? undefined : JSON.stringify(payload),
        signal: controller.signal
      });
      const contentType = response.headers.get("content-type") || "";
      let jsonPayload = null;
      let textPayload = "";

      if (contentType.includes("application/json")) {
        jsonPayload = await response.json();
      } else {
        textPayload = await response.text();
      }

      if (!response.ok) {
        const failureText = jsonPayload ? JSON.stringify(jsonPayload) : textPayload;
        throw new Error(`Webhook returned ${response.status}: ${failureText || response.statusText}`);
      }

      const resolvedReply =
        (entry.responsePath && readPathValue(jsonPayload, entry.responsePath)) ||
        jsonPayload?.reply ||
        textPayload ||
        entry.successReply ||
        `Webhook ${entry.name} executed successfully.`;

      return {
        reply: String(resolvedReply).trim(),
        provider: "extension-webhook",
        actions: [
          {
            type: "extension_webhook",
            target: entry.name,
            status: "executed"
          }
        ],
        details: {
          webhook: {
            name: entry.name,
            url: entry.url,
            method
          },
          response: jsonPayload || textPayload || null
        }
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async maybeHandleWebhook(input, context = {}) {
    const match = this.matchWebhook(input);

    if (!match) {
      return null;
    }

    return this.invokeWebhook(match, input, context);
  }
}

module.exports = {
  ExtensionsService
};
