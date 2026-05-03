const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BrowserAgentRuntime
} = require("../../src/main/browser-agent-runtime.cjs");

function createRuntime(overrides = {}) {
  return new BrowserAgentRuntime({
    automation: overrides.automation || {
      async execute() {},
      async typeText() {},
      async clickCoordinate() {},
      async runShellCommand() {
        return "";
      },
      async describeCurrentContext() {
        return {
          appName: "Browser",
          windowTitle: "Window"
        };
      },
      async getActiveApp() {
        return "Browser";
      }
    },
    browser: overrides.browser || {
      async navigate(url) {
        return {
          url,
          title: "Opened",
          elements: [],
          visibleText: "Opened page"
        };
      },
      async clickElement(elementId) {
        return {
          url: "https://example.com/after-click",
          title: "Clicked",
          elements: [],
          visibleText: `Clicked ${elementId}`
        };
      },
      async typeText(elementId, text) {
        return {
          url: "https://example.com",
          title: "Typed",
          elements: [
            {
              id: elementId,
              value: text,
              text: "",
              enabled: true,
              visible: true
            }
          ],
          visibleText: "Typed text"
        };
      },
      async pressKey(key) {
        return {
          url: "https://example.com/after-key",
          title: "Pressed",
          elements: [],
          visibleText: `Pressed ${key}`
        };
      },
      async scrollPage() {
        return {
          url: "https://example.com",
          title: "Scrolled",
          elements: [],
          visibleText: "Scrolled page"
        };
      },
      async waitAndObserve() {
        return {
          url: "https://example.com",
          title: "Observed",
          elements: [],
          visibleText: "Observed"
        };
      },
      async observe() {
        return {
          url: "https://example.com",
          title: "Observed",
          elements: [],
          visibleText: "Observed"
        };
      }
    },
    screen: {},
    chatClient: overrides.chatClient || (async () => "{}"),
    getRecentHistory: () => [],
    buildHistorySnippet: () => "",
    buildSessionMemorySnippet: () => "",
    makeAction: (type, target, status = "executed", extra = {}) => ({
      type,
      target,
      status,
      ...extra
    })
  });
}

test("browser agent rejects desktop.click while observed browser elements are available", async () => {
  let desktopClicked = false;
  const runtime = createRuntime({
    automation: {
      async execute() {},
      async typeText() {},
      async clickCoordinate() {
        desktopClicked = true;
      },
      async runShellCommand() {
        return "";
      },
      async describeCurrentContext() {
        return { appName: "Google Chrome", windowTitle: "Example" };
      },
      async getActiveApp() {
        return "Google Chrome";
      }
    }
  });

  const result = await runtime.executeStructuredAction(
    {
      tool: "desktop.click",
      input: {
        x: 100,
        y: 200
      }
    },
    {
      state: {
        url: "https://example.com",
        title: "Example",
        elements: [
          {
            id: "1",
            text: "Continue",
            enabled: true,
            visible: true
          }
        ]
      }
    }
  );

  assert.equal(desktopClicked, false);
  assert.match(result.error, /desktop\.click is unsafe/);
});

test("browser agent rejects browser.click when the target element is missing from the current observation", async () => {
  const runtime = createRuntime();

  const result = await runtime.executeStructuredAction(
    {
      tool: "browser.click",
      input: {
        elementId: "9"
      }
    },
    {
      state: {
        url: "https://example.com",
        title: "Example",
        elements: [
          {
            id: "1",
            text: "Continue",
            enabled: true,
            visible: true
          }
        ]
      }
    }
  );

  assert.match(result.error, /not in the current observation/);
});

test("browser agent verifies browser.type changed the observed element value", async () => {
  const runtime = createRuntime({
    browser: {
      async typeText(elementId) {
        return {
          url: "https://example.com",
          title: "Typed",
          elements: [
            {
              id: elementId,
              value: "",
              text: "",
              enabled: true,
              visible: true
            }
          ],
          visibleText: "Typed text"
        };
      },
      async observe() {
        return {
          url: "https://example.com",
          title: "Observed",
          elements: [],
          visibleText: "Observed"
        };
      }
    }
  });

  const result = await runtime.executeStructuredAction(
    {
      tool: "browser.type",
      input: {
        elementId: "5",
        text: "hello"
      }
    },
    {
      state: {
        url: "https://example.com",
        title: "Example",
        elements: [
          {
            id: "5",
            value: "",
            text: "",
            enabled: true,
            visible: true
          }
        ]
      }
    }
  );

  assert.match(result.error, /did not change the observed value/);
});

test("browser agent injects runtime hints into the planner prompt", async () => {
  const prompts = [];
  const runtime = createRuntime({
    chatClient: async (options) => {
      prompts.push(options.userPrompt);
      return JSON.stringify({
        thought: "Done",
        action: null,
        expectedOutcome: "",
        isFinal: true,
        finalMessage: "completed"
      });
    }
  });

  await runtime.runLoop({
    input: "Check Gmail inbox",
    language: "en",
    initialState: {
      url: "https://mail.google.com",
      title: "Gmail",
      elements: [],
      visibleText: "Inbox"
    },
    runtimeHints: [
      "openclaw-skill:gmail-inbox: Check Gmail inbox state before replying."
    ]
  });

  assert.equal(prompts.length > 0, true);
  assert.match(prompts[0], /Relevant skill hint:/);
  assert.match(prompts[0], /gmail-inbox/i);
});

test("browser agent stops for confirmation before sensitive final clicks", async () => {
  let clicked = false;
  const runtime = createRuntime({
    chatClient: async () => JSON.stringify({
      thought: "Confirm the purchase",
      action: {
        tool: "browser.click",
        input: {
          elementId: "pay"
        }
      },
      expectedOutcome: "The order should be placed",
      isFinal: false,
      finalMessage: null
    }),
    browser: {
      async clickElement() {
        clicked = true;
        return {
          url: "https://shop.example/paid",
          title: "Paid",
          elements: [],
          visibleText: "Paid"
        };
      },
      async observe() {
        return {
          url: "https://shop.example/checkout",
          title: "Checkout",
          elements: [],
          visibleText: "Checkout"
        };
      }
    }
  });

  const result = await runtime.runLoop({
    input: "결제를 완료해줘",
    language: "ko",
    initialState: {
      url: "https://shop.example/checkout",
      title: "Checkout",
      elements: [
        {
          id: "pay",
          text: "결제하기",
          enabled: true,
          visible: true
        }
      ],
      visibleText: "총액 10000원 결제하기"
    }
  });

  assert.equal(clicked, false);
  assert.equal(result.stopReason, "needs_user_confirmation");
  assert.equal(result.pendingConfirmation.action.tool, "browser.click");
  assert.equal(result.pendingConfirmation.targetLabel, "결제하기");
  assert.equal(result.actions.at(-1).status, "needs-confirmation");
  assert.match(result.finalSummary, /확인이 필요/);
});

test("browser agent stops when it ping-pongs between actions without progress", async () => {
  const plannerResponses = [
    JSON.stringify({
      thought: "Click the button",
      action: {
        tool: "browser.click",
        input: {
          elementId: "1"
        }
      },
      expectedOutcome: "The page should change",
      isFinal: false,
      finalMessage: null
    }),
    JSON.stringify({
      thought: "Observe the page again",
      action: {
        tool: "browser.observe",
        input: {}
      },
      expectedOutcome: "The page should look different",
      isFinal: false,
      finalMessage: null
    }),
    JSON.stringify({
      thought: "Click again",
      action: {
        tool: "browser.click",
        input: {
          elementId: "1"
        }
      },
      expectedOutcome: "The page should change",
      isFinal: false,
      finalMessage: null
    })
    ,
    JSON.stringify({
      thought: "Observe once more",
      action: {
        tool: "browser.observe",
        input: {}
      },
      expectedOutcome: "The page should look different",
      isFinal: false,
      finalMessage: null
    })
  ];
  const runtime = createRuntime({
    chatClient: async () => plannerResponses.shift() || plannerResponses[plannerResponses.length - 1],
    browser: {
      async clickElement() {
        return {
          url: "https://example.com",
          title: "Example",
          elements: [
            {
              id: "1",
              text: "Continue",
              enabled: true,
              visible: true
            }
          ],
          visibleText: "Static page"
        };
      },
      async observe() {
        return {
          url: "https://example.com",
          title: "Example",
          elements: [
            {
              id: "1",
              text: "Continue",
              enabled: true,
              visible: true
            }
          ],
          visibleText: "Static page"
        };
      }
    }
  });

  const result = await runtime.runLoop({
    input: "Press continue",
    language: "en",
    initialState: {
      url: "https://example.com",
      title: "Example",
      elements: [
        {
          id: "1",
          text: "Continue",
          enabled: true,
          visible: true
        }
      ],
      visibleText: "Static page"
    }
  });

  assert.equal(result.stopReason, "repeated_failure");
  assert.match(result.finalSummary, /bouncing between the same actions/i);
});
