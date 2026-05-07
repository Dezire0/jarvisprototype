const skillRegistry = require("./skills/skill-registry.cjs");

const TOOL_PROFILE_BROWSER_ONLY = "browser";
const TOOL_PROFILE_FULL_ACCESS = "full_access";

const TOOL_GROUPS = {
  browser: [
    "browser.open",
    "browser.click",
    "browser.type",
    "browser.keypress",
    "browser.scroll",
    "browser.wait_for",
    "browser.observe"
  ],
  desktop: [
    "desktop.type",
    "desktop.open_app",
    "desktop.click",
    "shell.run",
    "pii.get"
  ]
};

function normalizeProfile(profile = TOOL_PROFILE_FULL_ACCESS) {
  return profile === TOOL_PROFILE_BROWSER_ONLY ? TOOL_PROFILE_BROWSER_ONLY : TOOL_PROFILE_FULL_ACCESS;
}

function buildToolSet(profile = TOOL_PROFILE_FULL_ACCESS) {
  const normalizedProfile = normalizeProfile(profile);
  const tools = [...TOOL_GROUPS.browser];

  if (normalizedProfile === TOOL_PROFILE_FULL_ACCESS) {
    tools.push(...TOOL_GROUPS.desktop);
  }

  return new Set(tools);
}

function buildBrowserAgentSystemPrompt(profile = TOOL_PROFILE_FULL_ACCESS, registry = skillRegistry) {
  const toolSet = buildToolSet(profile);
  const tools = Array.from(toolSet).join(", ");
  const schemas = registry?.getSchemasForTools
    ? registry.getSchemasForTools(toolSet)
    : [];

  return [
    "You are the OpenClaw computer-use session planner inside Jarvis Desktop.",
    "Return only a JSON object with thought, action, expectedOutcome, isFinal, and finalMessage.",
    `Allowed tools: ${tools}.`,
    "Use the following tool schemas exactly when you emit an action:",
    ...schemas,
    "Prefer Playwright-style browser control first: observe the current page, use visible element ids, then click, type, press keys, or scroll.",
    "Use desktop tools when a local app, desktop coordinate, or shell step is truly needed.",
    "Ask for secrets through pii.get instead of guessing or fabricating credentials.",
    "Think like a computer-use agent: observe, act once, verify, then continue.",
    "When the user goal is complete, set isFinal to true and provide finalMessage."
  ].join("\n");
}

module.exports = {
  TOOL_PROFILE_BROWSER_ONLY,
  TOOL_PROFILE_FULL_ACCESS,
  buildBrowserAgentSystemPrompt,
  buildToolSet,
  normalizeProfile
};
