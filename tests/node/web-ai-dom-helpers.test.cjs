const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CHAT_INPUT_HINTS,
  SEND_BUTTON_HINTS,
  buildDomHelperSource,
  scoreButtonDescriptor,
  scoreChatInputDescriptor
} = require("../../src/main/web-ai-dom-helpers.cjs");

test("chat input scoring prefers a message composer over a search box", () => {
  const composerScore = scoreChatInputDescriptor(
    {
      tag: "textarea",
      placeholder: "Send message",
      bottom: 920,
      viewportHeight: 960
    },
    CHAT_INPUT_HINTS
  );
  const searchScore = scoreChatInputDescriptor(
    {
      tag: "input",
      type: "search",
      role: "searchbox",
      placeholder: "Search",
      bottom: 120,
      viewportHeight: 960
    },
    CHAT_INPUT_HINTS
  );

  assert.ok(composerScore > searchScore);
});

test("button scoring prefers a visible send action over a generic secondary button", () => {
  const sendScore = scoreButtonDescriptor(
    {
      tag: "button",
      ariaLabel: "Send message",
      bottom: 920,
      viewportHeight: 960
    },
    SEND_BUTTON_HINTS
  );
  const genericScore = scoreButtonDescriptor(
    {
      tag: "button",
      text: "Cancel",
      bottom: 400,
      viewportHeight: 960
    },
    SEND_BUTTON_HINTS
  );

  assert.ok(sendScore > genericScore);
});

test("DOM helper source avoids brittle provider-specific selector ids", () => {
  const source = buildDomHelperSource();

  assert.equal(source.includes("#prompt-textarea"), false);
  assert.equal(source.includes("data-testid=\"send-button\""), false);
  assert.equal(source.includes("absolute.bottom-1.5"), false);
});
