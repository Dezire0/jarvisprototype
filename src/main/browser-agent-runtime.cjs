const { FAST_PLANNER_MODEL } = require("./ollama-service.cjs");
const notificationMonitor = require("./notification-monitor.cjs");
const piiManager = require("./pii-manager.cjs");
const {
  MACOS_AUTOMATION_PERMISSION_MESSAGE,
  normalizeAutomationFailureMessage
} = require("./automation-error-utils.cjs");
const {
  TOOL_PROFILE_FULL_ACCESS,
  buildBrowserAgentSystemPrompt,
  buildToolSet,
  normalizeProfile
} = require("./agent-tool-registry.cjs");

const BROWSER_AGENT_DEFAULTS = {
  maxSteps: 15,
  maxConsecutiveFailures: 3,
  maxRepeatActions: 2,
  maxNoProgressActions: 3,
  maxPingPongActions: 4
};

const STRUCTURED_BROWSER_AGENT_DECISION_SCHEMA = {
  type: "object",
  properties: {
    thought: {
      type: "string"
    },
    action: {
      type: ["object", "null"],
      properties: {
        tool: {
          type: "string"
        },
        input: {
          type: "object"
        }
      }
    },
    expectedOutcome: {
      type: "string"
    },
    isFinal: {
      type: "boolean"
    },
    finalMessage: {
      type: ["string", "null"]
    }
  },
  required: ["thought", "action", "expectedOutcome", "isFinal", "finalMessage"]
};

const BROWSER_AGENT_SYSTEM_PROMPT = buildBrowserAgentSystemPrompt(TOOL_PROFILE_FULL_ACCESS);

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const match = String(raw).match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (__error) {
      return null;
    }
  }
}

function normalizeWhitespace(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function normalizeAgentText(value = "") {
  return normalizeWhitespace(String(value || ""));
}

function normalizeElementId(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function clampWaitMs(value, fallback = 2000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return Math.max(200, Math.min(Math.round(numeric), 10000));
}

function limitStructuredText(value = "", limit = 1200) {
  return normalizeAgentText(value).slice(0, limit);
}

function normalizeLegacyBrowserAgentDecision(parsed = {}) {
  const actionName = String(parsed?.action || "").trim();
  const reason = normalizeAgentText(parsed?.reason || parsed?.summary || "");
  let tool = "";
  let input = {};

  switch (actionName) {
    case "navigate":
      tool = "browser.open";
      input = { url: String(parsed?.url || "").trim() };
      break;
    case "click":
      tool = "browser.click";
      input = { elementId: normalizeElementId(parsed?.element_id) };
      break;
    case "type":
      tool = "browser.type";
      input = {
        elementId: normalizeElementId(parsed?.element_id),
        text: String(parsed?.text || "")
      };
      break;
    case "press_key":
      tool = "browser.keypress";
      input = { key: String(parsed?.key || "Enter").trim() };
      break;
    case "scroll":
      tool = "browser.scroll";
      input = { direction: String(parsed?.direction || "down").trim().toLowerCase() };
      break;
    case "wait":
      tool = "browser.wait_for";
      input = { ms: clampWaitMs(parsed?.ms, 2000) };
      break;
    case "ask_pii":
      tool = "pii.get";
      input = { field: String(parsed?.field || "").trim() };
      break;
    case "os_type":
      tool = "desktop.type";
      input = { text: String(parsed?.text || "") };
      break;
    case "os_app":
      tool = "desktop.open_app";
      input = { name: String(parsed?.name || "").trim() };
      break;
    case "os_click":
      tool = "desktop.click";
      input = {
        x: Number(parsed?.x),
        y: Number(parsed?.y)
      };
      break;
    case "os_cmd":
      tool = "shell.run";
      input = { command: String(parsed?.command || "").trim() };
      break;
    case "done":
      return {
        thought: reason,
        action: null,
        expectedOutcome: "",
        isFinal: true,
        finalMessage: String(parsed?.summary || "").trim()
      };
    default:
      return null;
  }

  return {
    thought: reason,
    action: {
      tool,
      input
    },
    expectedOutcome: "",
    isFinal: false,
    finalMessage: null
  };
}

function parseStructuredBrowserAgentDecision(raw) {
  const parsed = typeof raw === "string" ? safeJsonParse(raw) : raw;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  if (typeof parsed.action === "string") {
    return normalizeLegacyBrowserAgentDecision(parsed);
  }

  const derivedTool =
    String(
      parsed.action?.tool ||
      parsed.tool ||
      parsed.toolName ||
      parsed.actionName ||
      ""
    ).trim();
  const derivedInput =
    parsed.action?.input && typeof parsed.action.input === "object" && !Array.isArray(parsed.action.input)
      ? { ...parsed.action.input }
      : parsed.input && typeof parsed.input === "object" && !Array.isArray(parsed.input)
        ? { ...parsed.input }
        : parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
          ? { ...parsed.args }
          : parsed.parameters && typeof parsed.parameters === "object" && !Array.isArray(parsed.parameters)
            ? { ...parsed.parameters }
            : {};
  const isFinal =
    Boolean(parsed.isFinal) ||
    Boolean(parsed.done) ||
    Boolean(parsed.complete) ||
    String(parsed.status || "").trim().toLowerCase() === "done";
  const finalMessageCandidate =
    parsed.finalMessage ??
    parsed.message ??
    parsed.summary ??
    parsed.result ??
    null;

  const normalized = {
    thought: normalizeAgentText(parsed.thought || parsed.reason || ""),
    action: derivedTool
      ? {
          tool: derivedTool,
          input: derivedInput
        }
      : null,
    expectedOutcome: normalizeAgentText(parsed.expectedOutcome || parsed.expected || ""),
    isFinal,
    finalMessage:
      finalMessageCandidate === null || finalMessageCandidate === undefined
        ? null
        : String(finalMessageCandidate)
  };

  if (!normalized.isFinal && !normalized.action?.tool) {
    return null;
  }

  return normalized;
}

function validateStructuredBrowserAgentDecision(decision = {}, options = {}) {
  const toolSet = options.toolSet instanceof Set ? options.toolSet : buildToolSet(options.toolProfile);
  if (!decision || typeof decision !== "object") {
    return {
      ok: false,
      error: "Planner response must be a JSON object."
    };
  }

  if (decision.isFinal) {
    return {
      ok: true,
      decision: {
        thought: normalizeAgentText(decision.thought || ""),
        action: null,
        expectedOutcome: normalizeAgentText(decision.expectedOutcome || ""),
        isFinal: true,
        finalMessage:
          decision.finalMessage === null || decision.finalMessage === undefined
            ? ""
            : String(decision.finalMessage)
      }
    };
  }

  const tool = String(decision.action?.tool || "").trim();
  const input = decision.action?.input && typeof decision.action.input === "object" && !Array.isArray(decision.action.input)
    ? { ...decision.action.input }
    : {};

  if (!toolSet.has(tool)) {
    return {
      ok: false,
      error: `Unsupported tool: ${tool || "(missing tool name)"}`
    };
  }

  const normalizedDecision = {
    thought: normalizeAgentText(decision.thought || ""),
    action: {
      tool,
      input: {}
    },
    expectedOutcome: normalizeAgentText(decision.expectedOutcome || ""),
    isFinal: false,
    finalMessage: null
  };

  switch (tool) {
    case "browser.open": {
      const url = String(input.url || "").trim();
      if (!url) {
        return { ok: false, error: "browser.open requires input.url." };
      }
      normalizedDecision.action.input = { url };
      break;
    }
    case "browser.click": {
      const elementId = normalizeElementId(input.elementId);
      if (!elementId) {
        return { ok: false, error: "browser.click requires input.elementId." };
      }
      normalizedDecision.action.input = { elementId };
      break;
    }
    case "browser.type": {
      const elementId = normalizeElementId(input.elementId);
      if (!elementId) {
        return { ok: false, error: "browser.type requires input.elementId." };
      }
      normalizedDecision.action.input = {
        elementId,
        text: String(input.text || "")
      };
      break;
    }
    case "browser.keypress": {
      const key = String(input.key || "").trim();
      if (!key) {
        return { ok: false, error: "browser.keypress requires input.key." };
      }
      normalizedDecision.action.input = { key };
      break;
    }
    case "browser.scroll": {
      const direction = String(input.direction || "down").trim().toLowerCase();
      if (!["up", "down"].includes(direction)) {
        return { ok: false, error: "browser.scroll input.direction must be 'up' or 'down'." };
      }
      normalizedDecision.action.input = { direction };
      break;
    }
    case "browser.wait_for":
      normalizedDecision.action.input = { ms: clampWaitMs(input.ms, 2000) };
      break;
    case "browser.observe":
      normalizedDecision.action.input = {};
      break;
    case "desktop.type": {
      const text = String(input.text || "");
      if (!text) {
        return { ok: false, error: "desktop.type requires input.text." };
      }
      normalizedDecision.action.input = { text };
      break;
    }
    case "desktop.open_app": {
      const name = String(input.name || "").trim();
      if (!name) {
        return { ok: false, error: "desktop.open_app requires input.name." };
      }
      normalizedDecision.action.input = { name };
      break;
    }
    case "desktop.click": {
      const x = Number(input.x);
      const y = Number(input.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, error: "desktop.click requires numeric input.x and input.y." };
      }
      normalizedDecision.action.input = { x, y };
      break;
    }
    case "shell.run": {
      const command = String(input.command || "").trim();
      if (!command) {
        return { ok: false, error: "shell.run requires input.command." };
      }
      normalizedDecision.action.input = { command };
      break;
    }
    case "pii.get": {
      const field = String(input.field || "").trim();
      if (!field) {
        return { ok: false, error: "pii.get requires input.field." };
      }
      normalizedDecision.action.input = { field };
      break;
    }
    default:
      return { ok: false, error: `Unsupported tool: ${tool}` };
  }

  return {
    ok: true,
    decision: normalizedDecision
  };
}

function buildStructuredBrowserToolSignature(action = {}) {
  const tool = String(action?.tool || "").trim();
  const input = action?.input && typeof action.input === "object" && !Array.isArray(action.input)
    ? action.input
    : {};
  const normalizedInput = {};
  for (const key of Object.keys(input).sort()) {
    normalizedInput[key] = input[key];
  }
  return JSON.stringify({
    tool,
    input: normalizedInput
  });
}

function mapStructuredBrowserToolToActionType(tool = "") {
  return String(tool || "")
    .replace(/\./g, "_")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function summarizeStructuredBrowserToolTarget(action = {}) {
  const tool = String(action?.tool || "").trim();
  const input = action?.input && typeof action.input === "object" && !Array.isArray(action.input)
    ? action.input
    : {};

  switch (tool) {
    case "browser.open":
      return input.url || "";
    case "browser.click":
    case "browser.type":
      return `element_${normalizeElementId(input.elementId)}`;
    case "browser.keypress":
      return input.key || "";
    case "browser.scroll":
      return input.direction || "";
    case "browser.wait_for":
      return `${clampWaitMs(input.ms, 2000)}ms`;
    case "desktop.type":
      return String(input.text || "").slice(0, 80);
    case "desktop.open_app":
      return input.name || "";
    case "desktop.click":
      return `${Number(input.x)},${Number(input.y)}`;
    case "shell.run":
      return input.command || "";
    case "pii.get":
      return input.field || "";
    case "browser.observe":
      return "observe";
    default:
      return tool;
  }
}

function deriveBrowserAgentStopReason({ error = "", state = {}, repeated = false, maxStepsReached = false } = {}) {
  if (maxStepsReached) {
    return "timeout";
  }

  if (repeated) {
    return "repeated_failure";
  }

  const text = `${String(error || "")}\n${Array.isArray(state?.anomalies) ? state.anomalies.join(" ") : ""}`.toLowerCase();

  if (/(login_required|2fa_required|password|otp|auth|sign in|log in|credential|pii)/i.test(text)) {
    return "blocked_by_auth";
  }

  if (/(permission|accessibility|not allowed|denied|apple event error -1743|automation permission)/i.test(text)) {
    return "blocked_by_permission";
  }

  if (/(missing|not installed|dependency|module not found|command not found)/i.test(text)) {
    return "missing_dependency";
  }

  if (/(unclear|ambiguous|clarify|which one|unsure)/i.test(text)) {
    return "ambiguous_goal";
  }

  return "repeated_failure";
}

function buildPlannerFailureReply(language, summary) {
  return language === "ko" ? summary : summary;
}

function normalizeComparableText(value = "", limit = 240) {
  return limitStructuredText(value, limit).toLowerCase();
}

function getObservedElements(state = {}) {
  return Array.isArray(state?.elements) ? state.elements : [];
}

function getObservedElement(state = {}, elementId = "") {
  const normalizedElementId = normalizeElementId(elementId);
  if (!normalizedElementId) {
    return null;
  }
  return getObservedElements(state).find((element) => normalizeElementId(element?.id) === normalizedElementId) || null;
}

function hasBrowserSurface(state = {}) {
  return Boolean(state?.url || state?.title || getObservedElements(state).length);
}

function hasActionableBrowserElements(state = {}) {
  return getObservedElements(state).some((element) => element?.visible !== false && element?.enabled !== false);
}

function hasBrowserTextEntryTargets(state = {}) {
  return getObservedElements(state).some((element) => {
    const role = normalizeComparableText(element?.role || "", 60);
    const text = normalizeComparableText(element?.text || "", 60);
    const selector = normalizeComparableText(element?.selector || "", 120);
    return (
      role.includes("textbox") ||
      role.includes("searchbox") ||
      selector.includes("input") ||
      selector.includes("textarea") ||
      text.includes("search")
    );
  });
}

function getObservedElementLabel(element = {}) {
  return normalizeComparableText([
    element.text,
    element.ariaLabel,
    element.placeholder,
    element.selector,
    element.role
  ].filter(Boolean).join(" "), 240);
}

function isSensitiveFinalElement(element = {}) {
  const label = getObservedElementLabel(element);
  return /(purchase|buy now|place order|pay now|checkout|subscribe|confirm payment|confirm order|결제|구매|주문|구독|카드|송금|이체|예약 확정)/i.test(label);
}

function buildSensitiveConfirmation(action = {}, element = {}) {
  const label = limitStructuredText(
    element?.text || element?.ariaLabel || element?.placeholder || action?.input?.elementId || "sensitive action",
    160
  );
  return {
    reason: "sensitive_final_action",
    message: `This looks like a sensitive final action: ${label}`,
    action,
    targetLabel: label
  };
}

function buildObservedStateFingerprint(state = {}) {
  return JSON.stringify({
    url: String(state?.url || ""),
    title: String(state?.title || ""),
    visibleText: limitStructuredText(state?.visibleText || "", 400),
    elementCount: Number(state?.elementCount || getObservedElements(state).length || 0),
    elements: getObservedElements(state).slice(0, 20).map((element) => ({
      id: normalizeElementId(element?.id),
      text: limitStructuredText(element?.text || "", 60),
      value: limitStructuredText(element?.value || "", 60),
      enabled: element?.enabled !== false,
      visible: element?.visible !== false
    })),
    anomalies: Array.isArray(state?.anomalies) ? state.anomalies.slice(0, 10) : [],
    cmd_output: limitStructuredText(state?.cmd_output || "", 120)
  });
}

function compareObservedState(beforeState = {}, afterState = {}) {
  return {
    changed: buildObservedStateFingerprint(beforeState) !== buildObservedStateFingerprint(afterState)
  };
}

function normalizeHintList(hints = [], limit = 5) {
  if (!Array.isArray(hints)) {
    return [];
  }

  return [...new Set(
    hints
      .map((hint) => normalizeAgentText(hint))
      .filter(Boolean)
  )].slice(0, limit);
}

function buildActionOutcomeFingerprint(result = {}) {
  return JSON.stringify({
    state: result?.state ? buildObservedStateFingerprint(result.state) : "",
    error: normalizeAgentText(result?.error || "")
  });
}

function detectToolProgressLoop(history = [], thresholds = {}) {
  const maxNoProgressActions = Number(thresholds.maxNoProgressActions) || BROWSER_AGENT_DEFAULTS.maxNoProgressActions;
  const maxPingPongActions = Number(thresholds.maxPingPongActions) || BROWSER_AGENT_DEFAULTS.maxPingPongActions;
  const recentHistory = Array.isArray(history) ? history : [];

  if (recentHistory.length >= maxNoProgressActions) {
    const tail = recentHistory.slice(-maxNoProgressActions);
    const first = tail[0];
    const sameSignature = tail.every((entry) => entry.signature === first.signature);
    const sameOutcome = tail.every((entry) => entry.outcomeFingerprint === first.outcomeFingerprint);
    if (sameSignature && sameOutcome) {
      return {
        kind: "no_progress_repeat",
        signature: first.signature,
        count: tail.length
      };
    }
  }

  if (recentHistory.length >= maxPingPongActions) {
    const tail = recentHistory.slice(-maxPingPongActions);
    const uniqueSignatures = [...new Set(tail.map((entry) => entry.signature))];
    if (uniqueSignatures.length === 2) {
      const alternating = tail.every((entry, index) => entry.signature === uniqueSignatures[index % 2]);
      const stableOutcomes = tail.every((entry, index) =>
        index < 2 || entry.outcomeFingerprint === tail[index - 2].outcomeFingerprint
      );
      if (alternating && stableOutcomes) {
        return {
          kind: "ping_pong",
          signatures: uniqueSignatures,
          count: tail.length
        };
      }
    }
  }

  return null;
}

function normalizeGoalGuardrails(goalGuardrails = {}) {
  return {
    requiresMeaningfulInteraction: Boolean(goalGuardrails?.requiresMeaningfulInteraction),
    requiresContentEvidence: Boolean(goalGuardrails?.requiresContentEvidence),
    continueFromCurrentPageIfPossible: Boolean(goalGuardrails?.continueFromCurrentPageIfPossible)
  };
}

class BrowserAgentRuntime {
  constructor({
    automation,
    browser,
    screen,
    toolProfile = TOOL_PROFILE_FULL_ACCESS,
    chatClient,
    getRecentHistory,
    buildHistorySnippet,
    buildSessionMemorySnippet,
    makeAction
  }) {
    this.automation = automation;
    this.browser = browser;
    this.screen = screen;
    this.toolProfile = normalizeProfile(toolProfile);
    this.toolSet = buildToolSet(this.toolProfile);
    this.systemPrompt = buildBrowserAgentSystemPrompt(this.toolProfile);
    this.chatClient = chatClient;
    this.getRecentHistory = typeof getRecentHistory === "function" ? getRecentHistory : () => [];
    this.buildHistorySnippet = typeof buildHistorySnippet === "function" ? buildHistorySnippet : () => "";
    this.buildSessionMemorySnippet = typeof buildSessionMemorySnippet === "function"
      ? buildSessionMemorySnippet
      : () => "";
    this.makeAction = typeof makeAction === "function"
      ? makeAction
      : (type, target, status = "executed", extra = {}) => ({
          type,
          target,
          status,
          ...extra
        });
  }

  async collectDesktopContext() {
    const currentContext = this.automation?.describeCurrentContext
      ? await this.automation.describeCurrentContext().catch(() => ({
          appName: "",
          windowTitle: ""
        }))
      : {
          appName: "",
          windowTitle: ""
        };
    const activeApp = this.automation?.getActiveApp
      ? await this.automation.getActiveApp().catch(() => currentContext.appName || "")
      : currentContext.appName || "";

    return {
      activeApp: activeApp || currentContext.appName || "",
      currentContext: {
        appName: currentContext.appName || "",
        windowTitle: currentContext.windowTitle || ""
      }
    };
  }

  async buildObservationSnapshot(
    goal,
    goalGuardrails,
    state,
    stepNum,
    errorMessage = "",
    recentActions = [],
    sessionContext = null,
    runtimeHints = []
  ) {
    const desktopContext = await this.collectDesktopContext();
    const notifications = notificationMonitor.getAIContextString();
    const notes = [];
    const hasDesktopAction = recentActions.some((action) => /^(desktop|shell)\./.test(String(action.tool || "")));
    const hasBrowserSurface = Boolean(state?.url || state?.title || Array.isArray(state?.elements));
    const contextType = hasDesktopAction ? (hasBrowserSurface ? "mixed" : "desktop") : "browser";
    let screenText = "";

    if (Array.isArray(state?.anomalies) && state.anomalies.length) {
      notes.push(`Detected anomalies: ${state.anomalies.join(", ")}`);
    }
    if (errorMessage) {
      notes.push(`Previous action failed: ${errorMessage}`);
    }
    if (notifications) {
      notes.push(`System notifications: ${limitStructuredText(notifications, 500)}`);
    }
    if (state?.cmd_output) {
      notes.push(`Recent shell output: ${limitStructuredText(state.cmd_output, 500)}`);
    }
    if (state?.pii_retrieved) {
      notes.push("A previously requested stored secret is attached on the observation as pii_retrieved.");
    }
    const normalizedRuntimeHints = normalizeHintList(runtimeHints);
    if (normalizedRuntimeHints.length) {
      notes.push(`Relevant skill hints: ${normalizedRuntimeHints.join(" | ")}`);
    }

    if (contextType !== "browser" && this.screen && typeof this.screen.captureAndOcr === "function") {
      const capture = await this.screen.captureAndOcr().catch(() => null);
      screenText = limitStructuredText(capture?.text || "", 500);
    }

    return {
      goal: String(goal || ""),
      goalGuardrails: normalizeGoalGuardrails(goalGuardrails),
      step: stepNum,
      contextType,
      url: state?.url || "",
      title: state?.title || "",
      activeApp: desktopContext.activeApp || "",
      currentContext: desktopContext.currentContext,
      elements: Array.isArray(state?.elements)
        ? state.elements.slice(0, 60).map((element) => ({
            id: normalizeElementId(element.id),
            role: element.role || element.tag || "",
            text: limitStructuredText(element.text || element.ariaLabel || element.placeholder || "", 120),
            selector: element.selector || null,
            enabled: element.enabled !== false,
            visible: element.visible !== false
          }))
        : [],
      consoleErrors: Array.isArray(state?.consoleErrors) ? state.consoleErrors.slice(0, 10) : [],
      recentActions: recentActions.slice(-5),
      notes,
      visibleText: limitStructuredText(state?.visibleText || "", 1500),
      screenText,
      sessionContext: sessionContext
        ? {
            continuedSession: Boolean(sessionContext.continuedSession),
            previousInput: limitStructuredText(sessionContext.previousInput || "", 240),
            currentPage: sessionContext.currentPage || null
          }
        : null
    };
  }

  buildObservationPrompt(observation) {
    return [
      `=== Step ${observation.step} Structured Observation ===`,
      "Use the following JSON state to choose the next single tool action.",
      JSON.stringify(observation, null, 2)
    ].join("\n");
  }

  async repairPlannerResponse(rawResponse, language = "en") {
    const repairPrompt = [
      "Convert the following browser-planner output into valid JSON only.",
      "Do not explain or add markdown.",
      'Required schema: {"thought":"...","action":{"tool":"browser.click","input":{"elementId":"3"}},"expectedOutcome":"...","isFinal":false,"finalMessage":null}',
      'If the original response indicates completion or a blocked state, use: {"thought":"...","action":null,"expectedOutcome":"","isFinal":true,"finalMessage":"..."}',
      "",
      "Original response:",
      String(rawResponse || ""),
      "",
      `Return only corrected JSON in ${language === "ko" ? "Korean" : "English"} where relevant.`
    ].join("\n");

    return this.chatClient({
      systemPrompt: this.systemPrompt,
      tier: "fast",
      model: FAST_PLANNER_MODEL,
      jsonOnly: true,
      jsonSchema: STRUCTURED_BROWSER_AGENT_DECISION_SCHEMA,
      history: [],
      userPrompt: repairPrompt
    }).catch(() => "");
  }

  isPrematureFinalDecision(goalGuardrails = {}, actions = [], state = {}) {
    const normalizedGuardrails = normalizeGoalGuardrails(goalGuardrails);

    if (!normalizedGuardrails.requiresMeaningfulInteraction) {
      return false;
    }

    const hasMeaningfulAction = actions.some((action) =>
      !["browser_navigate", "open_url", "browser_open", "browser_observe"].includes(action.type)
    );
    const hasBlockingAnomaly = Array.isArray(state?.anomalies)
      && state.anomalies.some((anomaly) => ["login_required", "2fa_required", "captcha", "access_denied"].includes(anomaly));
    const hasReadableEvidence = Boolean(limitStructuredText(state?.visibleText || "", 240));

    return !hasMeaningfulAction && !hasBlockingAnomaly && !hasReadableEvidence;
  }

  judgeStructuredAction(action = {}, state = null, options = {}) {
    const safeState = state && typeof state === "object" ? state : null;
    const tool = String(action?.tool || "").trim();
    const input = action?.input && typeof action.input === "object" && !Array.isArray(action.input)
      ? action.input
      : {};

    if (!safeState) {
      return { ok: true, action: { tool, input } };
    }

    switch (tool) {
      case "browser.click":
      case "browser.type": {
        const observedElement = getObservedElement(safeState, input.elementId);
        if (!observedElement) {
          return {
            ok: false,
            error: `Element [${normalizeElementId(input.elementId) || "unknown"}] is not in the current observation. Re-observe before interacting.`
          };
        }
        if (observedElement.visible === false) {
          return {
            ok: false,
            error: `Element [${normalizeElementId(input.elementId)}] is not currently visible. Re-observe and choose a visible target.`
          };
        }
        if (observedElement.enabled === false) {
          return {
            ok: false,
            error: `Element [${normalizeElementId(input.elementId)}] is disabled right now. Choose another action.`
          };
        }
        if (tool === "browser.click" && !options.allowSensitive && isSensitiveFinalElement(observedElement)) {
          return {
            ok: false,
            error: "Sensitive confirmation is required before clicking this element.",
            requiresConfirmation: true,
            confirmation: buildSensitiveConfirmation({ tool, input }, observedElement)
          };
        }
        break;
      }
      case "desktop.click":
        if (hasBrowserSurface(safeState) && hasActionableBrowserElements(safeState)) {
          return {
            ok: false,
            error: "desktop.click is unsafe while browser elements are available. Use browser.click with an observed elementId instead."
          };
        }
        break;
      case "desktop.type":
        if (hasBrowserSurface(safeState) && hasBrowserTextEntryTargets(safeState)) {
          return {
            ok: false,
            error: "desktop.type is unsafe on an active browser page with observable text fields. Use browser.type instead."
          };
        }
        break;
      case "shell.run":
        if (String(input.command || "").includes("\n")) {
          return {
            ok: false,
            error: "shell.run must be a single-line command for reliable execution."
          };
        }
        break;
      default:
        break;
    }

    return { ok: true, action: { tool, input } };
  }

  async verifyStructuredActionResult(action = {}, beforeState = null, result = {}) {
    const safeBeforeState = beforeState && typeof beforeState === "object" ? beforeState : null;
    const safeAfterState = result?.state && typeof result.state === "object" ? result.state : null;
    if (!safeBeforeState || !safeAfterState) {
      return { ok: true };
    }

    switch (action.tool) {
      case "browser.type": {
        const beforeElement = getObservedElement(safeBeforeState, action.input.elementId);
        const afterElement = getObservedElement(safeAfterState, action.input.elementId);
        const beforeValue = String(beforeElement?.value || "");
        const afterValue = String(afterElement?.value || "");
        if (beforeElement && afterElement && beforeValue === afterValue && afterValue !== String(action.input.text || "")) {
          return {
            ok: false,
            error: `browser.type did not change the observed value for element [${normalizeElementId(action.input.elementId)}].`
          };
        }
        return { ok: true };
      }
      case "browser.click":
      case "browser.keypress":
      case "browser.open": {
        const comparison = compareObservedState(safeBeforeState, safeAfterState);
        if (!comparison.changed) {
          return {
            ok: false,
            error: `${action.tool} produced no observable browser state change. Re-observe or choose a more precise action.`
          };
        }
        return { ok: true };
      }
      case "desktop.open_app": {
        const desktopContext = await this.collectDesktopContext().catch(() => null);
        const activeApp = normalizeComparableText(desktopContext?.activeApp || "", 120);
        const requestedApp = normalizeComparableText(action.input?.name || "", 120);
        if (requestedApp && activeApp && !activeApp.includes(requestedApp)) {
          return {
            ok: false,
            error: `desktop.open_app expected ${action.input.name} to be active, but the frontmost app appears to be ${desktopContext.activeApp || "unknown"}.`
          };
        }
        return { ok: true };
      }
      default:
        return { ok: true };
    }
  }

  async executeStructuredAction(action, options = {}) {
    const stateBeforeAction = options?.state && typeof options.state === "object" ? options.state : null;
    const judgment = this.judgeStructuredAction(action, stateBeforeAction, {
      allowSensitive: Boolean(options.allowSensitive)
    });
    if (!judgment.ok) {
      return {
        state: stateBeforeAction,
        error: judgment.error,
        requiresConfirmation: Boolean(judgment.requiresConfirmation),
        confirmation: judgment.confirmation || null,
        pendingAction: judgment.confirmation?.action || null
      };
    }

    const safeAction = judgment.action;
    try {
      let result;
      switch (safeAction.tool) {
        case "browser.open":
          result = { state: await this.browser.navigate(safeAction.input.url), error: null };
          break;
        case "browser.click":
          result = { state: await this.browser.clickElement(safeAction.input.elementId), error: null };
          break;
        case "browser.type":
          result = { state: await this.browser.typeText(safeAction.input.elementId, safeAction.input.text), error: null };
          break;
        case "browser.keypress":
          result = { state: await this.browser.pressKey(safeAction.input.key || "Enter"), error: null };
          break;
        case "browser.scroll":
          result = { state: await this.browser.scrollPage(safeAction.input.direction || "down"), error: null };
          break;
        case "browser.wait_for":
          result = { state: await this.browser.waitAndObserve(clampWaitMs(safeAction.input.ms, 2000)), error: null };
          break;
        case "browser.observe":
          result = { state: await this.browser.observe(), error: null };
          break;
        case "pii.get": {
          const storedPii = piiManager.get(safeAction.input.field);
          if (storedPii) {
            result = { state: { ...await this.browser.observe(), pii_retrieved: storedPii }, error: null };
            break;
          }
          result = {
            state: await this.browser.observe(),
            error: `Missing PII for ${safeAction.input.field}. Ask the user to provide or save it first.`
          };
          break;
        }
        case "desktop.type":
          await this.automation.typeText(safeAction.input.text);
          result = { state: await this.browser.observe(), error: null };
          break;
        case "desktop.open_app":
          await this.automation.execute({ type: "open_app", target: safeAction.input.name });
          result = { state: await this.browser.observe(), error: null };
          break;
        case "desktop.click":
          await this.automation.clickCoordinate(safeAction.input.x, safeAction.input.y);
          result = { state: await this.browser.observe(), error: null };
          break;
        case "shell.run": {
          const output = await this.automation.runShellCommand(safeAction.input.command);
          result = { state: { ...await this.browser.observe(), cmd_output: output }, error: null };
          break;
        }
        default:
          result = { state: await this.browser.observe(), error: `Unknown tool: ${safeAction.tool}` };
          break;
      }

      if (result?.error) {
        return result;
      }

      const verification = await this.verifyStructuredActionResult(safeAction, stateBeforeAction, result);
      if (!verification.ok) {
        return {
          state: result?.state || stateBeforeAction,
          error: verification.error
        };
      }

      return result;
    } catch (error) {
      const normalizedError = normalizeAutomationFailureMessage(error?.message || error, error?.message || String(error || ""));
      try {
        const recoveryState = await this.browser.observe();
        return { state: recoveryState, error: normalizedError };
      } catch {
        return { state: null, error: normalizedError };
      }
    }
  }

  async runLoop({
    input,
    language,
    initialState,
    initialActions = [],
    sessionContext = null,
    goalGuardrails = {},
    runtimeHints = []
  }) {
    const actions = [...initialActions];
    const maxSteps = BROWSER_AGENT_DEFAULTS.maxSteps;
    const maxConsecutiveFailures = BROWSER_AGENT_DEFAULTS.maxConsecutiveFailures;
    const maxRepeatActions = BROWSER_AGENT_DEFAULTS.maxRepeatActions;
    const maxNoProgressActions = BROWSER_AGENT_DEFAULTS.maxNoProgressActions;
    const maxPingPongActions = BROWSER_AGENT_DEFAULTS.maxPingPongActions;
    const agentHistory = [];
    const actionOutcomeHistory = [];
    let state = initialState;
    let lastError = "";
    let finalSummary = "";
    let stopReason = "success";
    let consecutiveFailures = 0;
    let repeatedActionCount = 0;
    let lastActionSignature = "";
    let finished = false;
    let lastObservation = null;
    let pendingConfirmation = null;

    for (let step = 1; step <= maxSteps; step++) {
      const recentActions = actions.map((action) => ({
        tool: action.tool || action.type,
        target: action.target,
        status: action.status
      }));
      lastObservation = await this.buildObservationSnapshot(
        input,
        goalGuardrails,
        state,
        step,
        lastError,
        recentActions,
        sessionContext,
        runtimeHints
      );
      const observation = this.buildObservationPrompt(lastObservation);
      lastError = "";
      const userPrompt = step === 1
        ? `User's goal: ${input}\n\n${observation}\n\nDecide your first action to achieve the user's goal.`
        : `${observation}\n\nContinue working toward the goal: ${input}`;

      agentHistory.push({ role: "user", content: userPrompt });

      let aiResponse;
      try {
        const sessionMemory = this.buildSessionMemorySnippet();
        aiResponse = await this.chatClient({
          systemPrompt: this.systemPrompt,
          tier: "fast",
          model: FAST_PLANNER_MODEL,
          jsonOnly: true,
          jsonSchema: STRUCTURED_BROWSER_AGENT_DECISION_SCHEMA,
          history: [
            ...this.getRecentHistory(6),
            ...agentHistory.slice(-8)
          ],
          userPrompt: [
            "Keep the user's broader conversation context intact while controlling the browser.",
            "If a local fallback is needed later, it will receive this same context; do not assume a fresh session.",
            ...normalizeHintList(runtimeHints).map((hint) => `Relevant skill hint: ${hint}`),
            sessionMemory ? `Session memory:\n${sessionMemory}` : "",
            userPrompt
          ].filter(Boolean).join("\n\n")
        });
      } catch {
        stopReason = "repeated_failure";
        finalSummary = language === "ko"
          ? "브라우저 작업 중 AI 응답에 문제가 있었어요."
          : "There was a problem with the AI response during the browser task.";
        finished = true;
        break;
      }

      let parsedDecision = parseStructuredBrowserAgentDecision(aiResponse);
      if (!parsedDecision) {
        const repairedResponse = await this.repairPlannerResponse(aiResponse, language);
        const repairedParsed = parseStructuredBrowserAgentDecision(repairedResponse);

        if (repairedParsed) {
          aiResponse = repairedResponse;
          parsedDecision = repairedParsed;
        }
      }

      if (!parsedDecision) {
        const sessionMemory = this.buildSessionMemorySnippet();
        const localResponse = await this.chatClient({
          systemPrompt: this.systemPrompt,
          tier: "fast",
          model: FAST_PLANNER_MODEL,
          jsonOnly: true,
          jsonSchema: STRUCTURED_BROWSER_AGENT_DECISION_SCHEMA,
          history: agentHistory.slice(-8),
          userPrompt: [
            "The configured API response was not a valid browser action. Continue as a local fallback without losing context.",
            ...normalizeHintList(runtimeHints).map((hint) => `Relevant skill hint: ${hint}`),
            sessionMemory ? `Session memory:\n${sessionMemory}` : "",
            "Recent user conversation:",
            this.buildHistorySnippet(),
            "",
            userPrompt
          ].filter(Boolean).join("\n"),
          localOnly: true
        }).catch(() => "");
        let localParsed = parseStructuredBrowserAgentDecision(localResponse);

        if (!localParsed) {
          const repairedLocalResponse = await this.repairPlannerResponse(localResponse, language);
          localParsed = parseStructuredBrowserAgentDecision(repairedLocalResponse);
          if (localParsed) {
            aiResponse = repairedLocalResponse;
          }
        }

        if (localParsed) {
          if (!aiResponse || !parseStructuredBrowserAgentDecision(aiResponse)) {
            aiResponse = localResponse;
          }
          parsedDecision = localParsed;
        }
      }

      agentHistory.push({ role: "assistant", content: aiResponse });

      if (!parsedDecision) {
        lastError = "Invalid AI response (not valid JSON matching the planner schema). Try again.";
        consecutiveFailures += 1;
        if (consecutiveFailures >= maxConsecutiveFailures) {
          stopReason = deriveBrowserAgentStopReason({
            error: lastError,
            state
          });
          finalSummary = language === "ko"
            ? `브라우저 에이전트가 유효한 JSON 계획을 계속 만들지 못해서 중단했어요. ${lastError}`
            : `I stopped because the browser agent kept failing to return a valid JSON plan. ${lastError}`;
          finished = true;
          break;
        }
        continue;
      }

      const validation = validateStructuredBrowserAgentDecision(parsedDecision, {
        toolProfile: this.toolProfile,
        toolSet: this.toolSet
      });
      if (!validation.ok) {
        lastError = validation.error;
        consecutiveFailures += 1;
        if (consecutiveFailures >= maxConsecutiveFailures) {
          stopReason = deriveBrowserAgentStopReason({
            error: validation.error,
            state
          });
          finalSummary = language === "ko"
            ? `브라우저 에이전트 계획을 검증하는 중 문제가 반복되어 중단했어요. ${validation.error}`
            : `I stopped because the browser agent kept producing invalid tool plans. ${validation.error}`;
          finished = true;
          break;
        }
        continue;
      }

      const decision = validation.decision;

      if (decision.isFinal) {
        if (this.isPrematureFinalDecision(goalGuardrails, actions, state)) {
          lastError = "The planner tried to stop before doing meaningful page work. Continue with a real browser action or explain a clear block.";
          consecutiveFailures += 1;
          continue;
        }
        finalSummary = String(decision.finalMessage || "").trim();
        actions.push(this.makeAction("browser_done", finalSummary || "completed", "completed", {
          thought: decision.thought,
          expectedOutcome: decision.expectedOutcome
        }));
        finished = true;
        break;
      }

      const actionSignature = buildStructuredBrowserToolSignature(decision.action);
      if (actionSignature === lastActionSignature) {
        repeatedActionCount += 1;
      } else {
        repeatedActionCount = 1;
        lastActionSignature = actionSignature;
      }

      if (repeatedActionCount > maxRepeatActions) {
        stopReason = deriveBrowserAgentStopReason({
          repeated: true,
          state,
          error: `Repeated tool action: ${decision.action.tool}`
        });
        finalSummary = language === "ko"
          ? "같은 도구 행동이 반복되어 더 진행하지 않고 멈췄어요."
          : "I stopped because the same tool action kept repeating without progress.";
        finished = true;
        break;
      }

      const result = await this.executeStructuredAction(decision.action, {
        state
      });

      if (result.requiresConfirmation) {
        pendingConfirmation = {
          ...(result.confirmation || {}),
          action: result.pendingAction || decision.action,
          state
        };
        stopReason = "needs_user_confirmation";
        finalSummary = language === "ko"
          ? "이 동작은 결제, 구매, 구독처럼 민감한 최종 행동으로 보여서 실행 직전에 확인이 필요해요."
          : "This looks like a sensitive final action, so I need confirmation before I perform it.";
        actions.push(this.makeAction(
          mapStructuredBrowserToolToActionType(decision.action.tool),
          summarizeStructuredBrowserToolTarget(decision.action),
          "needs-confirmation",
          {
            tool: decision.action.tool,
            thought: decision.thought,
            expectedOutcome: decision.expectedOutcome,
            confirmation: pendingConfirmation
          }
        ));
        finished = true;
        break;
      }

      actionOutcomeHistory.push({
        signature: actionSignature,
        outcomeFingerprint: buildActionOutcomeFingerprint(result)
      });
      actions.push(this.makeAction(
        mapStructuredBrowserToolToActionType(decision.action.tool),
        summarizeStructuredBrowserToolTarget(decision.action),
        result.error ? "failed" : "executed",
        {
          tool: decision.action.tool,
          thought: decision.thought,
          expectedOutcome: decision.expectedOutcome
        }
      ));

      if (result.error) {
        lastError = result.error;
        consecutiveFailures += 1;
      } else {
        consecutiveFailures = 0;
      }

      if (result.state) {
        state = result.state;
      }

      const progressLoop = detectToolProgressLoop(actionOutcomeHistory, {
        maxNoProgressActions,
        maxPingPongActions
      });
      if (progressLoop) {
        stopReason = "repeated_failure";
        finalSummary = language === "ko"
          ? progressLoop.kind === "ping_pong"
            ? "두 가지 행동 사이를 오가며 같은 결과만 반복해서 여기서 멈췄어요."
            : "같은 행동이 같은 결과만 반복되어 진행이 없어서 여기서 멈췄어요."
          : progressLoop.kind === "ping_pong"
            ? "I stopped because the agent was bouncing between the same actions without making progress."
            : "I stopped because the same action kept producing the same outcome without progress.";
        finished = true;
        break;
      }

      if (result.error && consecutiveFailures >= maxConsecutiveFailures) {
        stopReason = deriveBrowserAgentStopReason({
          error: result.error,
          state
        });
        finalSummary = language === "ko"
          ? `브라우저 작업을 계속 진행하기 어려워서 멈췄어요. ${result.error}`
          : `I stopped because the browser task kept failing. ${result.error}`;
        finished = true;
        break;
      }
    }

    if (!finished && !finalSummary) {
      stopReason = deriveBrowserAgentStopReason({
        state,
        maxStepsReached: true
      });
      finalSummary = language === "ko"
        ? "브라우저 작업 단계 한도에 도달해서 여기서 멈췄어요."
        : "I stopped because the browser task hit its step limit.";
    }

    return {
      actions,
      finalSummary: buildPlannerFailureReply(language, finalSummary),
      lastObservation,
      pendingConfirmation,
      state,
      stopReason
    };
  }
}

module.exports = {
  BROWSER_AGENT_DEFAULTS,
  BROWSER_AGENT_SYSTEM_PROMPT,
  BrowserAgentRuntime,
  MACOS_AUTOMATION_PERMISSION_MESSAGE,
  deriveBrowserAgentStopReason,
  mapStructuredBrowserToolToActionType,
  parseStructuredBrowserAgentDecision,
  summarizeStructuredBrowserToolTarget,
  validateStructuredBrowserAgentDecision
};
