const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AssistantService,
  chooseAutomationReasoningTier,
  buildHeuristicBrowserPlan,
  buildRouteFallback,
  chooseChatModelTier,
  extractAppName
} = require("../../src/main/assistant-service.cjs");

test("chooseChatModelTier keeps short casual prompts on the fast tier", () => {
  assert.equal(chooseChatModelTier("오늘 저녁 뭐 먹을까?"), "fast");
  assert.equal(chooseChatModelTier("크롬 열어줘"), "fast");
});

test("chooseChatModelTier escalates deep reasoning prompts to the complex tier", () => {
  assert.equal(
    chooseChatModelTier("이 코드 구조를 분석해서 병목이 어디인지 자세히 설명해줘"),
    "complex"
  );
  assert.equal(
    chooseChatModelTier(
      "Please compare three architecture options, explain the trade-offs, and give me a step by step migration plan."
    ),
    "complex"
  );
});

test("chooseChatModelTier uses the complex tier for long context-heavy follow-ups", () => {
  const history = [
    { role: "user", content: "첫 번째 요구사항 정리해줘" },
    { role: "assistant", content: "정리했어요." },
    { role: "user", content: "두 번째 조건도 추가하자" },
    { role: "assistant", content: "반영했어요." },
    { role: "user", content: "이제 에러 케이스도 생각해보자" },
    { role: "assistant", content: "좋아요." }
  ];

  assert.equal(
    chooseChatModelTier(
      "지금까지 조건을 다 합쳐서 설계상 위험한 부분이 뭔지 정리하고 우선순위까지 나눠줘",
      history
    ),
    "complex"
  );
});

test("chooseAutomationReasoningTier keeps simple browser opens fast", () => {
  assert.equal(
    chooseAutomationReasoningTier("구글 열어줘", {
      route: "browser",
      requires_automation: false
    }),
    "fast"
  );
});

test("chooseAutomationReasoningTier escalates browser judgment and login flows", () => {
  assert.equal(
    chooseAutomationReasoningTier("지메일 들어가서 가장 최신 메시지 누가 보냈는지 확인해줘", {
      route: "browser",
      requires_automation: true
    }),
    "complex"
  );
  assert.equal(
    chooseAutomationReasoningTier("amazon.ca 로그인 진행해줘", {
      route: "browser_login",
      requires_automation: false
    }),
    "complex"
  );
});

test("buildRouteFallback detects direct computer briefing requests", () => {
  assert.deepEqual(buildRouteFallback("지금 이 컴퓨터 상태랑 상황을 브리핑해줘"), {
    route: "system_briefing",
    language: "ko"
  });
});

test("buildRouteFallback detects Steam install requests", () => {
  assert.deepEqual(buildRouteFallback("스팀에서 PUBG 설치해줘"), {
    route: "game_install",
    language: "ko",
    platform: "steam",
    query: "PUBG"
  });
});

test("buildRouteFallback detects Epic update requests", () => {
  assert.deepEqual(buildRouteFallback("에픽에서 포트나이트 업데이트해줘"), {
    route: "game_update",
    language: "ko",
    platform: "epic",
    query: "포트나이트"
  });
});

test("buildRouteFallback detects installed game list requests", () => {
  assert.deepEqual(buildRouteFallback("설치된 게임 목록 보여줘"), {
    route: "game_list",
    language: "ko",
    platform: "both"
  });
});

test("buildRouteFallback detects coding project generation requests", () => {
  assert.deepEqual(buildRouteFallback("스네이크 게임 만들어줘"), {
    route: "code_project",
    language: "ko"
  });
});

test("buildRouteFallback treats YouTube playback requests as browser work", () => {
  assert.deepEqual(buildRouteFallback("can you play some music in YouTube?"), {
    route: "browser",
    language: "en"
  });
});

test("buildRouteFallback keeps recommendation-style Spotify questions in chat", () => {
  assert.deepEqual(buildRouteFallback("요즘 스포티파이에 들을만한 노래가 없나?"), {
    route: "chat",
    language: "ko"
  });
});

test("buildRouteFallback still routes direct Spotify commands to spotify_play", () => {
  assert.deepEqual(buildRouteFallback("스포티파이에서 lofi 틀어줘"), {
    route: "spotify_play",
    language: "ko",
    query: "lofi"
  });
});

test("buildRouteFallback treats bare workspace app open as app_open", () => {
  assert.deepEqual(buildRouteFallback("디스코드 열어줘"), {
    route: "app_open",
    language: "ko",
    appName: "Discord"
  });
});

test("buildRouteFallback extracts app names from known app mentions without launch suffix rules", () => {
  assert.deepEqual(buildRouteFallback("디스코드 열어줄래?"), {
    route: "app_open",
    language: "ko",
    appName: "Discord"
  });
  assert.equal(extractAppName("크롬 켜줄래"), "Google Chrome");
  assert.equal(extractAppName("노션 실행해줄래"), "Notion");
  assert.equal(extractAppName("계산기 열어줄래"), "");
});

test("buildRouteFallback extracts mixed app and web open targets", () => {
  assert.deepEqual(buildRouteFallback("크롬 켜고 Gmail 열어줘"), {
    route: "open_targets",
    language: "ko",
    targets: {
      apps: [
        {
          label: "Google Chrome",
          url: "",
          tokens: ["google chrome", "chrome", "구글 크롬", "구글크롬", "크롬"]
        }
      ],
      web: [
        {
          label: "Gmail",
          url: "https://mail.google.com/",
          tokens: ["gmail", "지메일"]
        }
      ]
    }
  });
});

test("buildRouteFallback keeps chained login workflows on the browser route", () => {
  assert.deepEqual(buildRouteFallback("깃허브에서 openai 검색하고 로그인하고 활동 보여줘"), {
    route: "browser",
    language: "ko"
  });
});

test("buildHeuristicBrowserPlan builds a chained site workflow", () => {
  const plan = buildHeuristicBrowserPlan("깃허브에서 openai 검색하고 로그인하고 활동 보여줘");

  assert.deepEqual(
    plan.steps.map((step) => step.action),
    ["open_url", "site_search", "read_page"]
  );
  assert.equal(plan.steps[0].target, "https://github.com/");
  assert.equal(plan.steps[1].query, "openai");
  assert.deepEqual(plan.login, {
    required: true,
    mode: "manual",
    site: "깃허브"
  });
});

test("buildHeuristicBrowserPlan opens known sites directly instead of searching for them", () => {
  const plan = buildHeuristicBrowserPlan("구글 열어줘");

  assert.deepEqual(plan.steps, [
    {
      action: "open_url",
      target: "https://www.google.com/"
    }
  ]);
});

test("buildHeuristicBrowserPlan keeps Amazon as the target site in English login/search requests", () => {
  const plan = buildHeuristicBrowserPlan("hi, could you find some cool things in Amazon, with log ins?");

  assert.deepEqual(plan.steps, [
    {
      action: "open_url",
      target: "https://www.amazon.com/"
    },
    {
      action: "site_search",
      query: "some cool things"
    }
  ]);
  assert.deepEqual(plan.login, {
    required: true,
    mode: "manual",
    site: "Amazon"
  });
});

test("buildHeuristicBrowserPlan turns YouTube music requests into YouTube search", () => {
  const plan = buildHeuristicBrowserPlan("can you play some music in YouTube?");

  assert.deepEqual(plan.steps, [
    {
      action: "search_youtube",
      query: "music mix"
    }
  ]);
});

test("buildHeuristicBrowserPlan strips correction lead-ins before planning", () => {
  const plan = buildHeuristicBrowserPlan("i said go to youtube and play some music");

  assert.deepEqual(plan.steps, [
    {
      action: "search_youtube",
      query: "music mix"
    }
  ]);
});

test("buildHeuristicBrowserPlan forces current browser context for pronoun follow-ups", () => {
  const plan = buildHeuristicBrowserPlan("거기서 아무거나 틀어", {
    currentBrowserUrl: "https://www.youtube.com/watch?v=test",
    currentBrowserLabel: "YouTube"
  });

  assert.equal(plan.forceCurrentBrowserContext, true);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.reply, "YouTube");
});

test("setSessionContext hydrates recent history from the current thread state", async () => {
  let capturedContext = null;
  const service = new AssistantService({
    automation: {},
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {},
    memory: {
      setThreadContext(payload) {
        capturedContext = payload;
      },
      getRecentThreadTurns() {
        return [
          {
            role: "user",
            content: "예전 메일 내용도 기억해둬"
          }
        ];
      }
    }
  });

  await service.setSessionContext({
    threadId: "thread-memory",
    projectId: "project-jarvis",
    projectName: "Jarvis",
    threadTitle: "Mail follow-up",
    stateMessages: [
      {
        role: "user",
        text: "지메일 열어줘",
        status: "complete"
      },
      {
        role: "assistant",
        text: "지메일을 열었어요.",
        status: "complete"
      }
    ]
  });

  assert.deepEqual(service.getRecentHistory(2), [
    { role: "user", content: "지메일 열어줘" },
    { role: "assistant", content: "지메일을 열었어요." }
  ]);
  assert.equal(capturedContext.threadId, "thread-memory");
  assert.equal(capturedContext.projectId, "project-jarvis");
  assert.equal(capturedContext.projectName, "Jarvis");
  assert.equal(capturedContext.title, "Mail follow-up");
});

test("looksLikeBrowserContextFollowUp recognizes Korean and English pronoun follow-ups", () => {
  const service = new AssistantService({
    automation: {},
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });
  service.lastBrowserContext = {
    url: "https://www.youtube.com/",
    label: "YouTube"
  };

  assert.equal(service.looksLikeBrowserContextFollowUp("거기서 아무거나 틀어"), true);
  assert.equal(service.looksLikeBrowserContextFollowUp("play anything there"), true);
  assert.equal(service.looksLikeBrowserContextFollowUp("play anything on that"), true);
});

test("buildAugmentedUserPrompt includes long-term, project, conversation, and document memory", async () => {
  const service = new AssistantService({
    automation: {},
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {},
    memory: {
      formatForPrompt() {
        return "Preferences\n- Language: Korean";
      },
      getProjectContext() {
        return {
          id: "project-jarvis",
          name: "Jarvis",
          threadCount: 1,
          filePaths: ["/workspace/jarvis/spec.md"],
          recentTopics: [
            {
              text: "OpenClaw browser follow-up memory",
              updatedAt: new Date().toISOString()
            }
          ]
        };
      },
      searchConversation() {
        return [
          {
            scope: "thread",
            role: "assistant",
            content: "가장 최신 Google Pay 메일을 보고 있는 중이에요."
          }
        ];
      },
      searchDocuments() {
        return [
          {
            scope: "project",
            path: "/workspace/jarvis/spec.md",
            excerpt: "The preview card should stay visible while the browser session is active."
          }
        ];
      }
    }
  });

  await service.setSessionContext({
    threadId: "thread-memory",
    projectId: "project-jarvis",
    projectName: "Jarvis"
  });

  const prompt = service.buildAugmentedUserPrompt("누구한테 왔어?");

  assert.match(prompt, /Known long-term user context/);
  assert.match(prompt, /Active project: Jarvis/);
  assert.match(prompt, /Relevant past conversation/);
  assert.match(prompt, /Google Pay 메일/);
  assert.match(prompt, /Relevant files and documents/);
  assert.match(prompt, /preview card/i);
  assert.match(prompt, /User request:\n누구한테 왔어\?/);
});

test("handleBrowser opens simple one-step navigation through the OpenClaw Playwright path", async () => {
  const calls = [];
  const service = new AssistantService({
    automation: {
      async execute(action) {
        calls.push(action);
      }
    },
    browser: {
      async navigate(target) {
        return {
          url: target,
          title: "Google"
        };
      },
      async observe() {
        return {
          url: "about:blank",
          title: "",
          elements: [],
          elementCount: 0,
          visibleText: ""
        };
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleAutonomousTask("구글 열어줘");

  assert.deepEqual(calls, []);
  assert.equal(result.provider, "openclaw-computer-use");
  assert.equal(result.actions[0].tool, "browser.open");
  assert.equal(result.details.executorMode, "playwright");
  assert.equal(result.details.url, "https://www.google.com/");
  assert.equal(result.reply, "구글 열었어요.");
});

test("handleBrowser labels Gmail direct opens as Gmail", async () => {
  const service = new AssistantService({
    automation: {},
    browser: {
      async navigate(target) {
        return {
          url: target,
          title: "Inbox - Gmail"
        };
      },
      async observe() {
        return {
          url: "about:blank",
          title: "",
          elements: [],
          elementCount: 0,
          visibleText: ""
        };
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleAutonomousTask("Gmail 열어줘");

  assert.equal(result.provider, "openclaw-computer-use");
  assert.equal(result.actions[0].tool, "browser.open");
  assert.equal(result.details.url, "https://mail.google.com/");
  assert.equal(result.reply, "지메일 열었어요.");
});

test("handleToolInvocation routes app opens through the OpenClaw desktop tool path", async () => {
  const calls = [];
  const service = new AssistantService({
    automation: {
      async listInstalledApps() {
        return {
          apps: [],
          totalCount: 0
        };
      },
      async resolveAppTarget(target) {
        return {
          resolvedTarget: target
        };
      },
      async execute(action) {
        calls.push(action);
        return {
          resolvedTarget: action.target
        };
      }
    },
    browser: {
      async observe() {
        return {
          url: "",
          title: "",
          elements: [],
          elementCount: 0,
          visibleText: ""
        };
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleToolInvocation("app:open", {
    appName: "Discord"
  });

  assert.equal(result.provider, "openclaw-computer-use");
  assert.equal(result.actions[0].tool, "desktop.open_app");
  assert.equal(result.details.executorMode, "desktop");
  assert.deepEqual(calls, [
    {
      type: "open_app",
      target: "Discord"
    }
  ]);
});

test("handleToolInvocation routes browser opens through the OpenClaw Playwright path", async () => {
  const service = new AssistantService({
    automation: {},
    browser: {
      async navigate(target) {
        return {
          url: target,
          title: "Google"
        };
      },
      async observe() {
        return {
          url: "about:blank",
          title: "",
          elements: [],
          elementCount: 0,
          visibleText: ""
        };
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleToolInvocation("browser:open", {
    target: "https://www.google.com/"
  });

  assert.equal(result.provider, "openclaw-computer-use");
  assert.equal(result.actions[0].tool, "browser.open");
  assert.equal(result.details.executorMode, "playwright");
  assert.equal(result.details.url, "https://www.google.com/");
});

test("handleToolInvocation reads the current page through an OpenClaw-style browser result", async () => {
  const service = new AssistantService({
    automation: {},
    browser: {
      async readPage() {
        return {
          url: "https://mail.google.com/",
          title: "Inbox - Gmail",
          text: "Latest unread mail preview"
        };
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleToolInvocation("browser:read");

  assert.equal(result.provider, "openclaw-computer-use");
  assert.equal(result.actions[0].tool, "browser.observe");
  assert.equal(result.details.executorMode, "playwright");
  assert.match(result.reply, /현재 페이지를 읽어왔어요/);
});

test("handleBrowser opens YouTube playback results through the OpenClaw Playwright path", async () => {
  const service = new AssistantService({
    automation: {},
    browser: {
      async navigate(target) {
        return {
          url: target,
          title: "YouTube"
        };
      },
      async observe() {
        return {
          url: "about:blank",
          title: "",
          elements: [],
          elementCount: 0,
          visibleText: ""
        };
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleAutonomousTask("i said go to youtube and play some music");

  assert.equal(result.provider, "openclaw-computer-use");
  assert.equal(result.actions[0].tool, "browser.open");
  assert.match(result.details.url, /youtube\.com\/results/);
  assert.equal(result.reply, "I opened YouTube results so you can play something right away.");
});

test("handleBrowser prefers Playwright for official install or verification pages", async () => {
  const service = new AssistantService({
    automation: {
      async execute() {
        assert.fail("official install checks should prefer Playwright before the system browser");
      }
    },
    browser: {
      async navigate(target) {
        return {
          url: target,
          title: "Download"
        };
      },
      getProviderLabel() {
        return "playwright bundled browser";
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleAutonomousTask("Discord 공식 다운로드 페이지 열어줘");

  assert.equal(result.provider, "openclaw-computer-use");
  assert.match(result.details.url, /google\.com\/search/);
});

test("handleBrowser prefers an OpenClaw session plan when available", async () => {
  const service = new AssistantService({
    automation: {},
    browser: {
      async navigate(target) {
        return {
          url: target,
          title: "Amazon"
        };
      },
      async observe() {
        return {
          url: "about:blank",
          title: "",
          elements: [],
          elementCount: 0,
          visibleText: ""
        };
      }
    },
    openClaw: {
      async planBrowserTask() {
        return {
          plan: {
            steps: [
              {
                action: "open_url",
                target: "https://www.amazon.com/"
              }
            ]
          },
          sessionRef: "latest",
          commandLine: "claw --resume latest prompt ...",
          toolUses: []
        };
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleAutonomousTask("아마존 공식 사이트", {
    route: "browser",
    language: "ko",
    requires_automation: false
  });

  assert.equal(result.provider, "openclaw-computer-use");
  assert.equal(result.actions[0].tool, "browser.open");
  assert.equal(result.details.url, "https://www.amazon.com/");
  assert.equal(result.details.planner, "openclaw-session");
  assert.equal(result.details.plannerReason, "claw-session-plan");
  assert.equal(result.details.openClawSessionRef, "latest");
});

test("handleBrowser executes multi-step OpenClaw plans through the browser executor", async () => {
  const executedPlans = [];
  const service = new AssistantService({
    automation: {
      async execute() {
        assert.fail("structured OpenClaw plans should stay inside the browser executor");
      }
    },
    browser: {
      async executePlan(steps) {
        executedPlans.push(steps);
        return {
          steps: steps.map((step) => ({
            ...step,
            result: {
              url: "https://github.com/search?q=openai"
            }
          })),
          final: {
            url: "https://github.com/search?q=openai",
            title: "GitHub",
            text: "OpenAI repositories"
          }
        };
      }
    },
    openClaw: {
      async planBrowserTask() {
        return {
          plan: {
            steps: [
              {
                action: "open_url",
                target: "https://github.com/"
              },
              {
                action: "site_search",
                query: "openai"
              },
              {
                action: "read_page",
                limit: 4000
              }
            ]
          },
          sessionRef: "latest",
          toolUses: []
        };
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleAutonomousTask("깃허브에서 openai 검색해줘", {
    route: "browser",
    language: "ko",
    requires_automation: true
  });

  assert.equal(executedPlans.length, 1);
  assert.deepEqual(
    executedPlans[0].map((step) => step.action),
    ["open_url", "site_search", "read_page"]
  );
  assert.equal(result.details.planner, "openclaw-session");
  assert.equal(result.details.plannerReason, "claw-session-plan");
});

test("handleBrowser uses an OpenClaw Jarvis delegate for login continuations", async () => {
  const service = new AssistantService({
    automation: {},
    browser: {
      async navigate(target) {
        return {
          url: target,
          title: "GitHub"
        };
      }
    },
    openClaw: {
      async planBrowserTask() {
        return {
          plan: {
            steps: [
              {
                action: "open_url",
                target: "https://github.com/"
              },
              {
                action: "jarvis_delegate",
                route: "browser_login",
                site: "GitHub",
                reason: "Need Jarvis secure credential prompt"
              },
              {
                action: "site_search",
                query: "openai"
              },
              {
                action: "read_page",
                limit: 4000
              }
            ]
          },
          sessionRef: "latest",
          toolUses: []
        };
      }
    },
    credentials: {
      async getCredential() {
        return null;
      }
    },
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const pending = await service.handleAutonomousTask("깃허브에서 openai 검색하고 로그인하고 활동 보여줘", {
    route: "browser",
    language: "ko",
    requires_automation: true
  });

  assert.equal(pending.provider, "openclaw-computer-use");
  assert.equal(pending.details.pendingBrowserContinuation, true);
  assert.equal(pending.details.planner, "openclaw-session");
  assert.match(pending.reply, /로그인 화면/);
});

test("handleInput opens Chrome and navigates Gmail for mixed Korean open command", async () => {
  const calls = [];
  const service = new AssistantService({
    automation: {
      async listInstalledApps() {
        return {
          apps: []
        };
      },
      async resolveAppTarget(appName) {
        return {
          requestedTarget: appName,
          resolvedTarget: appName,
          strategy: "direct"
        };
      },
      async execute(action) {
        calls.push(action);
        return {
          appName: action.target,
          resolvedTarget: action.target,
          target: action.target
        };
      }
    },
    browser: {
      async executePlan() {
        assert.fail("mixed direct open command should not use browser plan automation");
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleInput("크롬 켜고 Gmail 열어줘");

  assert.deepEqual(calls, [
    {
      type: "open_app",
      target: "Google Chrome"
    },
    {
      type: "chrome_navigate",
      target: "https://mail.google.com/",
      newTab: false
    }
  ]);
  assert.equal(result.provider, "local");
  assert.match(result.reply, /Google Chrome/);
  assert.match(result.reply, /Gmail/);
});

test("handleAppOpen asks again instead of executing unresolved full-sentence app names", async () => {
  const calls = [];
  const service = new AssistantService({
    automation: {
      async listInstalledApps() {
        return {
          apps: []
        };
      },
      async resolveAppTarget() {
        return null;
      },
      async execute(action) {
        calls.push(action);
        assert.fail("unresolved app names should not be executed directly");
      }
    },
    browser: {},
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleAppOpen("디스코드 열어줄래?", {
    route: "app_open",
    language: "ko",
    appName: "디스코드 열어줄래"
  });

  assert.deepEqual(calls, []);
  assert.equal(result.provider, "local-clarify");
  assert.match(result.reply, /이 컴퓨터에서 찾지 못했어요/);
  assert.match(result.reply, /공식 웹/);
});

test("handleAppOpen offers official web fallback for missing web-runnable apps", async () => {
  const calls = [];
  const service = new AssistantService({
    automation: {
      async listInstalledApps() {
        return {
          apps: []
        };
      },
      async resolveAppTarget() {
        return null;
      },
      async execute(action) {
        calls.push(action);
        assert.fail("missing app recovery should not open local apps or system browser before the user chooses");
      }
    },
    browser: {
      async navigate(target) {
        return {
          url: target,
          title: "Discord"
        };
      },
      getProviderLabel() {
        return "playwright bundled browser";
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const pending = await service.handleAppOpen("디스코드 열어줘", {
    route: "app_open",
    language: "ko",
    appName: "Discord"
  });

  assert.equal(pending.provider, "local-clarify");
  assert.match(pending.reply, /공식 웹에서 실행/);
  assert.deepEqual(calls, []);

  const resumed = await service.continuePendingClarification("웹으로 열어줘");

  assert.equal(resumed.provider, "openclaw-computer-use");
  assert.equal(resumed.details.recovery, "web");
  assert.equal(resumed.details.officialWebUrl, "https://discord.com/app");
});

test("handleAppOpen explains OpenClaw official install and run commands when missing", async () => {
  const service = new AssistantService({
    automation: {
      async listInstalledApps() {
        return {
          apps: []
        };
      },
      async resolveAppTarget() {
        return null;
      },
      async execute() {
        assert.fail("missing OpenClaw should not execute a local app");
      }
    },
    browser: {},
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const pending = await service.handleAppOpen("OpenClaw 실행해줘", {
    route: "app_open",
    language: "ko",
    appName: "OpenClaw"
  });

  assert.equal(pending.provider, "local-clarify");
  assert.match(pending.reply, /공식 실행 흐름/);

  const commands = await service.continuePendingClarification("명령만 보여줘");

  assert.equal(commands.details.recovery, "commands");
  assert.match(commands.reply, /openclaw onboard/);
  assert.match(commands.reply, /openclaw dashboard/);
});

test("handleBrowser waits for manual login before running the rest of a chained site workflow", async () => {
  const calls = [];
  const browserPlans = [];
  const service = new AssistantService({
    automation: {
      async execute(action) {
        calls.push(action);
        return {
          target: action.target
        };
      }
    },
    browser: {
      async executePlan(steps) {
        browserPlans.push(steps);
        return {
          steps: steps.map((step) => ({
            ...step,
            result: {
              url: "https://github.com/search?q=openai"
            }
          })),
          final: {
            url: "https://github.com/search?q=openai",
            title: "GitHub",
            text: ""
          }
        };
      },
      async open(target) {
        return {
          url: target,
          title: "GitHub"
        };
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const pending = await service.handleAutonomousTask("깃허브에서 openai 검색하고 로그인하고 활동 보여줘");

  assert.deepEqual(calls, [
    {
      type: "open_url",
      target: "https://github.com/"
    }
  ]);
  assert.equal(browserPlans.length, 0);
  assert.equal(pending.details.pendingBrowserContinuation, true);
  assert.match(pending.reply, /로그인 화면/);

  const resumed = await service.continuePendingBrowserContinuation("계속");

  assert.equal(browserPlans.length, 1);
  assert.deepEqual(
    browserPlans[0].map((step) => step.action),
    ["open_url", "site_search", "read_page"]
  );
  assert.equal(resumed.details.resumedBrowserContinuation, true);
});

test("handleBrowser opens the latest mailbox message inside the current browser context", async () => {
  const service = new AssistantService({
    automation: {},
    browser: {
      async openLatestMailboxMessage() {
        return {
          url: "https://mail.google.com/mail/u/0/#inbox/FMfcgzQ...",
          title: "Inbox - Gmail",
          openedMailboxItem: "Latest message",
          visibleText: "Latest message body"
        };
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  service.lastBrowserContext = {
    url: "https://mail.google.com/mail/u/0/#inbox",
    title: "Inbox - Gmail",
    label: "Gmail",
    updatedAt: Date.now()
  };

  const result = await service.handleAutonomousTask("가장 최신 메시지 들어가줘", {
    route: "browser",
    language: "ko",
    requires_automation: true
  });

  assert.equal(result.provider, "openclaw-computer-use");
  assert.equal(result.actions[0].type, "browser_open_latest_mailbox_message");
  assert.match(result.reply, /최신 메일/);
});

test("handleBrowserLogin opens a secure credential prompt when no saved login exists", async () => {
  const calls = [];
  const service = new AssistantService({
    automation: {
      async execute(action) {
        calls.push(action);
        return {
          target: action.target
        };
      }
    },
    browser: {
      async loginWithStoredCredential() {
        assert.fail("login should not autofill when no saved credential exists");
      },
      async open(target) {
        return {
          url: target,
          title: "GitHub"
        };
      }
    },
    credentials: {
      async getCredential() {
        return null;
      }
    },
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleBrowserLogin("깃허브 로그인해줘", {
    siteOrUrl: "깃허브"
  });

  assert.deepEqual(calls, [
    {
      type: "open_url",
      target: "https://github.com/"
    }
  ]);
  assert.equal(result.details.loginMode, "secure-prompt");
  assert.equal(result.details.credentialPrompt.kind, "login_credentials");
  assert.equal(result.details.credentialPrompt.siteOrUrl, "https://github.com/");
  assert.match(result.reply, /보안 입력 카드|로그인 칸/);
});

test("handleBrowserLogin normalizes polluted login targets like amazon login", async () => {
  const calls = [];
  const service = new AssistantService({
    automation: {
      async execute(action) {
        calls.push(action);
        return {
          target: action.target
        };
      }
    },
    browser: {
      async loginWithStoredCredential() {
        assert.fail("login should not autofill when no saved credential exists");
      },
      async open(target) {
        return {
          url: target,
          title: "Amazon"
        };
      }
    },
    credentials: {
      async getCredential() {
        return null;
      }
    },
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleBrowserLogin("go to amazon login", {
    siteOrUrl: "amazon login"
  });

  assert.deepEqual(calls, [
    {
      type: "open_url",
      target: "https://www.amazon.com/"
    }
  ]);
  assert.equal(result.details.credentialPrompt.siteOrUrl, "https://www.amazon.com/");
  assert.equal(result.details.site, "Amazon");
});

test("handleBrowserLogin asks for clarification instead of falling back to Google on unknown login targets", async () => {
  const calls = [];
  const service = new AssistantService({
    automation: {
      async execute(action) {
        calls.push(action);
        assert.fail("ambiguous login targets should not open a guessed search page");
      }
    },
    browser: {
      async open() {
        assert.fail("ambiguous login targets should not open a guessed browser page");
      }
    },
    credentials: {
      async getCredential() {
        return null;
      }
    },
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleBrowserLogin("로그인 좀 해줘", {
    siteOrUrl: "please log me in somewhere"
  });

  assert.deepEqual(calls, []);
  assert.equal(result.provider, "local-clarify");
  assert.match(result.reply, /확실히 정하지 못했어요|determine the login site confidently/);
});

test("handleBrowserLogin can reuse the last opened browser target for follow-up login requests", async () => {
  const calls = [];
  const service = new AssistantService({
    automation: {
      async execute(action) {
        calls.push(action);
        return {
          target: action.target
        };
      }
    },
    browser: {
      async loginWithStoredCredential() {
        assert.fail("login should not autofill when no saved credential exists");
      },
      async navigate(target) {
        return {
          url: target,
          title: "Amazon"
        };
      },
      async open(target) {
        return {
          url: target,
          title: "Amazon"
        };
      }
    },
    credentials: {
      async getCredential() {
        return null;
      }
    },
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  await service.openBrowserTargetForUser("https://www.amazon.com/", {
    preferAssistant: true,
    language: "ko"
  });

  const result = await service.handleBrowserLogin("거기 로그인해줘", {
    siteOrUrl: "거기 로그인"
  });

  assert.deepEqual(calls, []);
  assert.equal(result.provider, "openclaw-computer-use");
  assert.equal(result.details.credentialPrompt.siteOrUrl, "https://www.amazon.com/");
  assert.equal(result.details.site, "아마존");
});

test("handleBrowserLogin fills saved credentials when a secure credential exists", async () => {
  const calls = [];
  const service = new AssistantService({
    automation: {
      async execute(action) {
        calls.push(action);
        return {
          target: action.target
        };
      }
    },
    browser: {
      async loginWithStoredCredential(siteOrUrl) {
        return {
          site: "github.com",
          url: siteOrUrl,
          submitted: false
        };
      },
      async open() {
        assert.fail("saved credential login should not open manual prompt first");
      }
    },
    credentials: {
      async getCredential(siteOrUrl) {
        assert.equal(siteOrUrl, "https://github.com/");
        return {
          site: "github.com",
          username: "octo"
        };
      }
    },
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleBrowserLogin("깃허브 로그인해줘", {
    siteOrUrl: "깃허브"
  });

  assert.deepEqual(calls, []);
  assert.equal(result.details.loginMode, "saved");
  assert.equal(result.details.url, "https://github.com/");
  assert.match(result.reply, /로그인 정보를 입력/);
});
