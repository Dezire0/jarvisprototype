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
  ],
  orchestration: [
    "sessions_spawn",
    "subagents"
  ],
  media: [
    "media_get_og_info",
    "media_play",
    "media_pause",
    "media_seek",
    "media_get_lyrics"
  ],
  account: [
    "account_queue_add",
    "account_queue_list",
    "account_queue_cancel",
    "account_switch"
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
    tools.push(...TOOL_GROUPS.orchestration);
    tools.push(...TOOL_GROUPS.media);
    tools.push(...TOOL_GROUPS.account);
  }

  return new Set(tools);
}

function normalizePromptSignal(value = "") {
  return String(value || "").trim().toLowerCase();
}

function hasPromptSignal(signals = [], patterns = []) {
  const combined = signals.map((signal) => normalizePromptSignal(signal)).filter(Boolean).join(" ");
  return patterns.some((pattern) => pattern.test(combined));
}

function buildPromptToolSet(profile = TOOL_PROFILE_FULL_ACCESS, options = {}) {
  const allowedToolSet = buildToolSet(profile);
  if (normalizeProfile(profile) === TOOL_PROFILE_BROWSER_ONLY) {
    return allowedToolSet;
  }

  const signals = [
    options.goal,
    ...(Array.isArray(options.runtimeHints) ? options.runtimeHints : []),
    options.state?.url,
    options.state?.title,
    options.state?.visibleText,
    options.state?.screenText,
    options.state?.cmd_output,
    ...(Array.isArray(options.state?.anomalies) ? options.state.anomalies : [])
  ];

  const selected = new Set([
    "browser.observe",
    "browser.open",
    "browser.click"
  ]);

  const browserInputLikely = hasPromptSignal(signals, [
    /(login|sign in|log in|search|type|fill|input|enter|otp|password|email|검색|입력|로그인|인증|비밀번호|이메일)/i
  ]);
  if (browserInputLikely) {
    selected.add("browser.type");
    selected.add("browser.keypress");
  }

  const browserMovementLikely = hasPromptSignal(signals, [
    /(scroll|below|next|more|page|feed|timeline|목록|더 보기|스크롤|아래)/i
  ]);
  if (browserMovementLikely) {
    selected.add("browser.scroll");
  }

  const browserWaitLikely = hasPromptSignal(signals, [
    /(wait|loading|spinner|pending|timeout|redirect|전환|로딩|기다려)/i
  ]);
  if (browserWaitLikely) {
    selected.add("browser.wait_for");
  }

  const desktopLikely = hasPromptSignal(signals, [
    /(desktop|app|application|window|finder|discord|slack|notion|vscode|obs|terminal|앱|프로그램|창|파인더|디스코드|슬랙|노션|터미널)/i
  ]);
  if (desktopLikely) {
    selected.add("desktop.open_app");
  }

  const desktopTypeLikely = hasPromptSignal(signals, [
    /(desktop type|type into|paste|message|reply|send|write|입력|붙여넣기|메시지|답장|보내)/i
  ]);
  if (desktopTypeLikely) {
    selected.add("desktop.type");
  }

  const desktopClickLikely = hasPromptSignal(signals, [
    /(desktop click|coordinate|menu|button|popup|dialog|modal|좌표|메뉴|팝업|모달|버튼)/i
  ]);
  if (desktopClickLikely) {
    selected.add("desktop.click");
  }

  const shellLikely = hasPromptSignal(signals, [
    /(shell|command|terminal|cli|npm|pnpm|git|cargo|python|node|bash|zsh|명령어|터미널)/i
  ]);
  if (shellLikely) {
    selected.add("shell.run");
  }

  const piiLikely = hasPromptSignal(signals, [
    /(login|sign in|password|otp|verification|2fa|credential|secret|auth|로그인|비밀번호|인증|보안|계정)/i
  ]);
  if (piiLikely) {
    selected.add("pii.get");
  }

  const orchestrationLikely = hasPromptSignal(signals, [
    /(delegate|parallel|subagent|multi-agent|multi agent|research in parallel|spawn|orchestrate|break down|분담|병렬|하위 에이전트|멀티 에이전트|세션 생성|위임)/i
  ]);
  if (orchestrationLikely) {
    selected.add("sessions_spawn");
    selected.add("subagents");
  }

  const mediaLikely = hasPromptSignal(signals, [
    /(youtube|video|music|song|track|lyrics|player|pause|play|seek|미디어|노래|가사|재생|일시정지|영상)/i
  ]);
  if (mediaLikely) {
    TOOL_GROUPS.media.forEach((tool) => selected.add(tool));
  }

  const accountLikely = hasPromptSignal(signals, [
    /(account|accounts|multi account|queue|switch account|credential rotation|메일함 순회|계정 전환|계정 큐|대기열)/i
  ]);
  if (accountLikely) {
    TOOL_GROUPS.account.forEach((tool) => selected.add(tool));
  }

  const filtered = new Set([...selected].filter((tool) => allowedToolSet.has(tool)));
  return filtered.size ? filtered : allowedToolSet;
}

function buildBrowserAgentSystemPrompt(profile = TOOL_PROFILE_FULL_ACCESS, registry = skillRegistry, options = {}) {
  const toolSet = options.toolSet instanceof Set
    ? options.toolSet
    : buildPromptToolSet(profile, options);
  const tools = Array.from(toolSet).join(", ");
  const schemas = registry?.getSchemasForTools
    ? registry.getSchemasForTools(toolSet)
    : [];

  return [
    "You are the OpenClaw computer-use session planner inside Jarvis Desktop.",
    "Return only a JSON object with thought, action, expectedOutcome, isFinal, and finalMessage.",
    "SYSTEM_PROMPT_CACHE_BOUNDARY",
    `Allowed tools: ${tools}.`,
    "Use the following tool schemas exactly when you emit an action:",
    ...schemas,
    "",
    "=== Modular Skills & Extra Capabilities ===",
    "Legacy aliases remain available for compatibility: navigate(browser.open), click(browser.click), type(browser.type), press_key(browser.keypress), scroll(browser.scroll), wait(browser.wait_for), observe(browser.observe), os_type(desktop.type), os_app(desktop.open_app), os_click(desktop.click), os_cmd(shell.run), ask_pii(pii.get).",
    "Companion v2 adds YouTube-first media control skills and a single-worker account queue through the same registry.",
    "",
    "## Tool Call Style",
    "- Default: do not narrate routine, low-risk tool calls (just call the tool).",
    "- Narrate only when it helps: multi-step work, complex/challenging problems, sensitive actions (e.g., deletions), or when the user explicitly asks.",
    "- Keep narration brief and value-dense; avoid repeating obvious steps.",
    "- Use plain human language for narration unless in a technical context.",
    "- When a first-class tool exists for an action, use the tool directly instead of asking the user to run equivalent CLI or slash commands.",
    "",
    "## Execution Bias",
    "- Actionable request: act in this turn.",
    "- Non-final turn: use tools to advance, or ask for the one missing decision that blocks safe progress.",
    "- Continue until done or genuinely blocked; do not finish with a plan/promise when tools can move it forward.",
    "- Weak/empty tool result: vary query, path, command, or source before concluding.",
    "- Mutable facts need live checks: files, git, clocks, versions, services, processes, package state.",
    "- Final answer needs evidence: test/build/lint, screenshot, inspection, tool output, or a named blocker.",
    "- Longer work: brief progress update, then keep going; use background work or sub-agents when they fit.",
    "",
    "## Safety",
    "- You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking; avoid long-term plans beyond the user's request.",
    "- Prioritize safety and human oversight over completion; if instructions conflict, pause and ask; comply with stop/pause/audit requests and never bypass safeguards.",
    "- Do not manipulate or persuade anyone to expand access or disable safeguards. Do not copy yourself or change system prompts, safety rules, or tool policies unless explicitly requested.",
    "",
    "## Rules for Modular Skills",
    "1. Use Playwright-style browser control first: observe the current page, use visible element ids, then click, type, press keys, or scroll.",
    "2. Use desktop tools when a local app, desktop coordinate, or shell step is truly needed.",
    "3. Ask for secrets through pii.get instead of guessing or fabricating credentials.",
    "4. Think like a computer-use agent: observe, act once, verify, then continue.",
    "5. When the user goal is complete, set isFinal to true and provide finalMessage."
  ].join("\n");
}

module.exports = {
  TOOL_PROFILE_BROWSER_ONLY,
  TOOL_PROFILE_FULL_ACCESS,
  buildBrowserAgentSystemPrompt,
  buildPromptToolSet,
  buildToolSet,
  normalizeProfile
};
