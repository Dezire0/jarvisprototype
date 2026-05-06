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

function buildBrowserAgentSystemPrompt(profile = TOOL_PROFILE_FULL_ACCESS) {
  const tools = Array.from(buildToolSet(profile)).join(", ");

  return [
    "You are Jarvis' structured browser and desktop control planner.",
    "Return only a JSON object with thought, action, expectedOutcome, isFinal, and finalMessage.",
    `Allowed tools: ${tools}.`,
    "Prefer observing the current page before clicking, use visible element ids, and ask for secrets through pii.get instead of guessing.",
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
