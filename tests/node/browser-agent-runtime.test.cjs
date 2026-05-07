const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BROWSER_AGENT_DEFAULTS,
  BrowserAgentRuntime,
  chooseBrowserAgentReasoningTier
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
    skillRegistry: overrides.skillRegistry,
    subAgentManager: overrides.subAgentManager,
    runtimeDepth: overrides.runtimeDepth,
    currentSessionId: overrides.currentSessionId,
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

test("browser agent system prompt includes dynamic skill schemas for allowed tools", async () => {
  const runtime = createRuntime();

  assert.match(runtime.systemPrompt, /Use the following tool schemas exactly/);
  assert.match(runtime.systemPrompt, /"tool":"browser\.open"/);
  assert.doesNotMatch(runtime.systemPrompt, /"tool":"desktop\.open_app"/);
});

test("browser agent narrows prompt tool schemas for browser-only login context", async () => {
  const runtime = createRuntime();

  const promptOptions = runtime.buildPlannerPromptOptions(
    "gmail에서 최신 메일 확인해줘",
    {
      url: "https://mail.google.com",
      title: "Gmail",
      elements: [
        {
          id: "1",
          role: "textbox",
          text: "",
          placeholder: "Search mail",
          enabled: true,
          visible: true
        }
      ],
      visibleText: "Inbox Search mail"
    },
    ["openclaw-skill:gmail-inbox"]
  );

  assert.equal(promptOptions.toolSet.has("browser.open"), true);
  assert.equal(promptOptions.toolSet.has("browser.type"), true);
  assert.equal(promptOptions.toolSet.has("browser.keypress"), true);
  assert.equal(promptOptions.toolSet.has("desktop.open_app"), false);
  assert.doesNotMatch(promptOptions.systemPrompt, /"tool":"desktop\.open_app"/);
  assert.match(promptOptions.systemPrompt, /"tool":"browser\.type"/);
});

test("browser agent exposes expanded retry defaults for multi-step recovery", async () => {
  assert.equal(BROWSER_AGENT_DEFAULTS.maxSteps, 24);
  assert.equal(BROWSER_AGENT_DEFAULTS.maxConsecutiveFailures, 6);
  assert.equal(BROWSER_AGENT_DEFAULTS.maxRepeatActions, 4);
  assert.equal(BROWSER_AGENT_DEFAULTS.maxNoProgressActions, 5);
  assert.equal(BROWSER_AGENT_DEFAULTS.maxPingPongActions, 6);
});

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
          },
          {
            id: "modal",
            role: "dialog",
            text: "Cookie consent",
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

test("browser agent uses the complex reasoning tier for structured automation", async () => {
  const seenTiers = [];
  const runtime = createRuntime({
    chatClient: async (options) => {
      seenTiers.push(options.tier);
      return JSON.stringify({
        thought: "I can answer now.",
        action: null,
        expectedOutcome: "",
        isFinal: true,
        finalMessage: "done"
      });
    }
  });

  const result = await runtime.runLoop({
    input: "gmail에서 최신 메일 확인하고 내용 알려줘",
    language: "ko",
    initialState: {
      url: "https://mail.google.com/",
      title: "Gmail",
      elements: [],
      visibleText: "Inbox"
    },
    goalGuardrails: {
      requiresMeaningfulInteraction: false
    }
  });

  assert.equal(chooseBrowserAgentReasoningTier(), "complex");
  assert.deepEqual(seenTiers, ["complex"]);
  assert.equal(result.stopReason, "success");
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
          },
          {
            id: "modal",
            role: "dialog",
            text: "Cookie consent",
            enabled: true,
            visible: true
          }
        ]
      }
    }
  );

  assert.match(result.error, /not in the current observation/);
  assert.match(result.error, /popup or dialog looks active/i);
});

test("browser agent delegates structured tool execution through the skill registry", async () => {
  let delegatedAction = null;
  let navigated = false;
  const runtime = createRuntime({
    browser: {
      async navigate() {
        navigated = true;
        return {
          url: "https://unexpected.example",
          title: "Unexpected",
          elements: [],
          visibleText: "Unexpected"
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
    skillRegistry: {
      async execute(action) {
        delegatedAction = action;
        return {
          state: {
            url: "https://delegated.example",
            title: "Delegated",
            elements: [],
            visibleText: "Delegated result"
          },
          error: null
        };
      },
      getSchemasForTools() {
        return [];
      }
    }
  });

  const result = await runtime.executeStructuredAction(
    {
      tool: "browser.open",
      input: {
        url: "https://example.com"
      }
    },
    {
      state: {
        url: "about:blank",
        title: "Blank",
        elements: [],
        visibleText: ""
      }
    }
  );

  assert.equal(navigated, false);
  assert.deepEqual(delegatedAction, {
    action: "navigate",
    tool: "browser.open",
    input: {
      url: "https://example.com"
    },
    url: "https://example.com"
  });
  assert.equal(result.state.url, "https://delegated.example");
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

test("browser agent explains no-progress results with login-specific guidance", async () => {
  const runtime = createRuntime({
    skillRegistry: {
      async execute() {
        return {
          state: {
            url: "https://accounts.google.com/signin",
            title: "Sign in",
            elements: [
              {
                id: "email",
                role: "textbox",
                text: "",
                enabled: true,
                visible: true
              }
            ],
            visibleText: "Sign in Email Password"
          },
          error: null
        };
      },
      getSchemasForTools() {
        return [];
      }
    }
  });

  const result = await runtime.executeStructuredAction(
    {
      tool: "browser.open",
      input: {
        url: "https://accounts.google.com/signin"
      }
    },
    {
      state: {
        url: "https://accounts.google.com/signin",
        title: "Sign in",
        elements: [
          {
            id: "email",
            role: "textbox",
            text: "",
            enabled: true,
            visible: true
          }
        ],
        visibleText: "Sign in Email Password"
      }
    }
  );

  assert.match(result.error, /waiting for login or verification/i);
});

test("browser agent delegates sessions_spawn through the sub-agent manager", async () => {
  let spawnPayload = null;
  const runtime = createRuntime({
    currentSessionId: "root-session",
    runtimeDepth: 0,
    subAgentManager: {
      async spawn(payload) {
        spawnPayload = payload;
        return {
          state: {
            session: {
              sessionId: "subagent-1234",
              status: "running"
            }
          },
          error: null
        };
      }
    }
  });

  const result = await runtime.executeStructuredAction(
    {
      tool: "sessions_spawn",
      input: {
        task: "Investigate the current page",
        agentId: "researcher",
        depth: 1
      }
    },
    {
      state: {
        url: "https://example.com",
        title: "Example",
        elements: [],
        visibleText: "Example"
      },
      language: "en"
    }
  );

  assert.deepEqual(spawnPayload, {
    task: "Investigate the current page",
    agentId: "researcher",
    depth: 1,
    parentSessionId: "root-session",
    language: "en"
  });
  assert.equal(result.state.session.sessionId, "subagent-1234");
});

test("browser agent returns possible_fix when automation permission is missing", async () => {
  const runtime = createRuntime({
    skillRegistry: {
      async execute() {
        throw new Error("Accessibility permission not authorized for keyboard input");
      },
      getSchemasForTools() {
        return [];
      }
    }
  });

  const result = await runtime.executeStructuredAction(
    {
      tool: "desktop.type",
      input: {
        text: "hello"
      }
    },
    {
      state: {
        url: "",
        title: "",
        elements: []
      },
      language: "en"
    }
  );

  assert.match(result.error, /Accessibility permission/i);
  assert.match(result.possible_fix, /System Settings/i);
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
    }),
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
