const CHAT_INPUT_HINTS = [
  "message",
  "send message",
  "type a message",
  "ask anything",
  "ask",
  "prompt",
  "chat",
  "conversation",
  "메시지",
  "전송",
  "질문",
  "프롬프트",
  "대화"
];

const SEND_BUTTON_HINTS = [
  "send",
  "send message",
  "submit",
  "continue",
  "보내기",
  "전송",
  "제출",
  "계속"
];

const STOP_BUTTON_HINTS = [
  "stop",
  "stop generating",
  "stop response",
  "cancel",
  "중지",
  "생성 중지",
  "응답 중지",
  "취소"
];

function normalizeComparableText(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function countHintMatches(text = "", hints = []) {
  const haystack = normalizeComparableText(text);
  if (!haystack) {
    return 0;
  }

  return hints.reduce((count, hint) => {
    return haystack.includes(normalizeComparableText(hint)) ? count + 1 : count;
  }, 0);
}

function scoreChatInputDescriptor(desc = {}, hints = []) {
  if (desc.hidden) {
    return Number.NEGATIVE_INFINITY;
  }

  const text = normalizeComparableText(
    [
      desc.placeholder,
      desc.ariaLabel,
      desc.title,
      desc.name,
      desc.text,
      desc.autocomplete
    ]
      .filter(Boolean)
      .join(" ")
  );

  let score = 0;
  if (desc.tag === "textarea" || desc.tag === "rich-textarea") score += 60;
  if (desc.tag === "input") score += 20;
  if (desc.isContentEditable) score += 55;
  if (desc.role === "textbox") score += 35;
  if (desc.role === "searchbox" || desc.type === "search") score -= 90;
  if (desc.type === "email" || desc.type === "password") score -= 80;
  if (desc.disabled) score -= 40;
  score += countHintMatches(text, hints) * 18;

  if (typeof desc.bottom === "number" && typeof desc.viewportHeight === "number") {
    const distanceFromBottom = Math.max(0, desc.viewportHeight - desc.bottom);
    score += Math.max(0, 30 - Math.min(distanceFromBottom, 300) / 10);
  }

  if (!text && (desc.tag === "textarea" || desc.isContentEditable)) {
    score += 10;
  }

  return score;
}

function scoreButtonDescriptor(desc = {}, hints = []) {
  if (desc.hidden) {
    return Number.NEGATIVE_INFINITY;
  }

  const text = normalizeComparableText(
    [
      desc.text,
      desc.ariaLabel,
      desc.title,
      desc.name,
      desc.value
    ]
      .filter(Boolean)
      .join(" ")
  );

  let score = 0;
  if (desc.tag === "button") score += 50;
  if (desc.role === "button") score += 25;
  if (desc.tag === "input" && desc.type === "submit") score += 35;
  if (desc.disabled) score -= 8;
  score += countHintMatches(text, hints) * 24;

  if (typeof desc.bottom === "number" && typeof desc.viewportHeight === "number") {
    const distanceFromBottom = Math.max(0, desc.viewportHeight - desc.bottom);
    score += Math.max(0, 18 - Math.min(distanceFromBottom, 240) / 15);
  }

  return score;
}

function buildDomHelperSource() {
  return `
const __jarvisChatInputHints = ${JSON.stringify(CHAT_INPUT_HINTS)};
const __jarvisSendButtonHints = ${JSON.stringify(SEND_BUTTON_HINTS)};
const __jarvisStopButtonHints = ${JSON.stringify(STOP_BUTTON_HINTS)};
${normalizeComparableText.toString()}
${countHintMatches.toString()}
${scoreChatInputDescriptor.toString()}
${scoreButtonDescriptor.toString()}
function jarvisIsVisible(node) {
  if (!node || typeof node.getBoundingClientRect !== "function") {
    return false;
  }

  const rect = node.getBoundingClientRect();
  const style = window.getComputedStyle(node);
  if (rect.width === 0 && rect.height === 0) return false;
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  if (rect.bottom < -20 || rect.top > window.innerHeight + 200) return false;
  return true;
}

function jarvisDescribeNode(node) {
  const rect = node.getBoundingClientRect();
  const tag = (node.tagName || "").toLowerCase();
  return {
    tag,
    type: node.getAttribute("type") || "",
    role: node.getAttribute("role") || "",
    placeholder: node.getAttribute("placeholder") || "",
    ariaLabel: node.getAttribute("aria-label") || "",
    title: node.getAttribute("title") || "",
    name: node.getAttribute("name") || "",
    autocomplete: node.getAttribute("autocomplete") || "",
    text: (node.innerText || node.textContent || "").trim().slice(0, 160),
    value: typeof node.value === "string" ? node.value.slice(0, 160) : "",
    disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
    isContentEditable: Boolean(node.isContentEditable || node.getAttribute("contenteditable") === "true"),
    hidden: !jarvisIsVisible(node),
    bottom: rect.bottom,
    viewportHeight: window.innerHeight
  };
}

function jarvisPickBestNode(selector, scorer, hints) {
  const nodes = Array.from(document.querySelectorAll(selector));
  let bestNode = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const score = scorer(jarvisDescribeNode(node), hints);
    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }

  return bestScore > 0 ? bestNode : null;
}

function jarvisFindChatInput() {
  return jarvisPickBestNode(
    "textarea, input:not([type='hidden']):not([type='password']):not([type='email']):not([type='submit']):not([type='checkbox']):not([type='radio']), [role='textbox'], [role='searchbox'], [contenteditable='true'], rich-textarea",
    scoreChatInputDescriptor,
    __jarvisChatInputHints
  );
}

function jarvisFindActionButton(mode = "send") {
  const hints = mode === "stop" ? __jarvisStopButtonHints : __jarvisSendButtonHints;
  return jarvisPickBestNode(
    "button, [role='button'], input[type='submit'], a[role='button']",
    scoreButtonDescriptor,
    hints
  );
}

function jarvisDispatchInput(node, value) {
  try {
    node.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      data: value,
      inputType: "insertText"
    }));
  } catch (_error) {
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }
  node.dispatchEvent(new Event("change", { bubbles: true }));
}

function jarvisSetComposerValue(node, value) {
  node.focus();

  if (node.isContentEditable || node.getAttribute("contenteditable") === "true" || node.tagName.toLowerCase() === "rich-textarea") {
    node.textContent = value;
    jarvisDispatchInput(node, value);
    return;
  }

  const tag = node.tagName.toLowerCase();
  const proto = tag === "textarea" ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
  const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
  if (setter) {
    setter.call(node, value);
  } else {
    node.value = value;
  }
  jarvisDispatchInput(node, value);
}

function jarvisSubmitPrompt(node) {
  const sendButton = jarvisFindActionButton("send");
  if (sendButton && !sendButton.disabled) {
    sendButton.click();
    return "button";
  }

  const events = [
    { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true },
    { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, ctrlKey: true }
  ];

  for (const eventInit of events) {
    node.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    node.dispatchEvent(new KeyboardEvent("keypress", eventInit));
    node.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  }

  if (node.form && typeof node.form.requestSubmit === "function") {
    node.form.requestSubmit();
  }

  return "keyboard";
}

function jarvisSnapshotConversation() {
  const selectors = [
    "main, [role='main']",
    "article",
    "section"
  ];

  for (const selector of selectors) {
    const texts = Array.from(document.querySelectorAll(selector))
      .filter(jarvisIsVisible)
      .map((node) => normalizeComparableText(node.innerText || node.textContent || ""))
      .filter((text) => text.length > 40);

    if (texts.length > 0) {
      return texts.join("\\n\\n").trim();
    }
  }

  return normalizeComparableText(document.body?.innerText || "");
}

function jarvisExtractDeltaText(baseline, current, prompt) {
  const base = normalizeComparableText(baseline);
  let delta = normalizeComparableText(current);
  const promptText = normalizeComparableText(prompt);

  if (base && delta.startsWith(base)) {
    delta = delta.slice(base.length).trim();
  } else if (base) {
    const baseIndex = delta.indexOf(base);
    if (baseIndex >= 0) {
      delta = delta.slice(baseIndex + base.length).trim();
    }
  }

  if (promptText && delta.startsWith(promptText)) {
    delta = delta.slice(promptText.length).trim();
  } else if (promptText) {
    const promptIndex = delta.indexOf(promptText);
    if (promptIndex >= 0 && promptIndex < Math.max(120, promptText.length * 2)) {
      delta = delta.slice(promptIndex + promptText.length).trim();
    }
  }

  return delta.trim();
}
`.trim();
}

module.exports = {
  CHAT_INPUT_HINTS,
  SEND_BUTTON_HINTS,
  STOP_BUTTON_HINTS,
  buildDomHelperSource,
  countHintMatches,
  normalizeComparableText,
  scoreButtonDescriptor,
  scoreChatInputDescriptor
};
