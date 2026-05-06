const test = require("node:test");
const assert = require("node:assert/strict");
const unofficialAI = require("../../src/main/unofficial-ai-provider.cjs");

const {
  AssistantService,
  buildHeuristicBrowserPlan,
  buildRouteFallback,
  chooseChatModelTier
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

test("buildRouteFallback keeps chained login workflows on the browser route", () => {
  assert.deepEqual(buildRouteFallback("깃허브에서 openai 검색하고 로그인하고 활동 보여줘"), {
    route: "browser",
    language: "ko"
  });
});

test("buildRouteFallback treats Korean email-site follow-ups as browser work", () => {
  assert.deepEqual(buildRouteFallback("이메일 사이트에 접속할게"), {
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

test("buildHeuristicBrowserPlan treats Amazon official-site requests as direct site opens", () => {
  const plan = buildHeuristicBrowserPlan("아마존 공식 사이트");

  assert.deepEqual(plan.steps, [
    {
      action: "open_url",
      target: "https://www.amazon.com/"
    }
  ]);
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

test("handleBrowser opens simple one-step navigation in the system browser", async () => {
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
      async executePlan() {
        assert.fail("simple open_url should not use Playwright automation");
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleBrowser("구글 열어줘");

  assert.deepEqual(calls, [
    {
      type: "open_url",
      target: "https://www.google.com/"
    }
  ]);
  assert.equal(result.provider, "system-browser");
  assert.equal(result.reply, "구글 열었어요.");
});

test("handleBrowser opens YouTube playback results in the system browser", async () => {
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
      async executePlan() {
        assert.fail("simple search_youtube should not use Playwright automation");
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleBrowser("i said go to youtube and play some music");

  assert.deepEqual(calls, [
    {
      type: "open_url",
      target: "https://www.youtube.com/results?search_query=music%20mix"
    }
  ]);
  assert.equal(result.provider, "system-browser");
  assert.equal(result.reply, "I opened YouTube results so you can play something right away.");
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

  const pending = await service.handleBrowser("깃허브에서 openai 검색하고 로그인하고 활동 보여줘");

  assert.deepEqual(calls, []);
  assert.equal(browserPlans.length, 0);
  assert.equal(pending.details.pendingBrowserContinuation, true);
  assert.match(pending.reply, /로그인 화면/);
  assert.equal(pending.provider, "assistant-browser");

  const resumed = await service.continuePendingBrowserContinuation("계속");

  assert.equal(browserPlans.length, 1);
  assert.deepEqual(
    browserPlans[0].map((step) => step.action),
    ["open_url", "site_search", "read_page"]
  );
  assert.equal(resumed.details.resumedBrowserContinuation, true);
});

test("handleBrowser maps a generic email-site follow-up to Gmail instead of a Google search", async () => {
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
      async executePlan() {
        assert.fail("generic email site open should not invoke the browser planner");
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleBrowser("이메일 사이트에 접속할게");

  assert.deepEqual(calls, [
    {
      type: "open_url",
      target: "https://mail.google.com/"
    }
  ]);
  assert.equal(result.provider, "system-browser");
  assert.equal(result.reply, "지메일 열었어요.");
});

test("handleBrowser opens the latest mailbox message inside the controlled browser context", async () => {
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

  service.lastBrowserTargetUrl = "https://mail.google.com/mail/u/0/#inbox";
  service.lastBrowserTargetLabel = "Gmail";

  const result = await service.handleBrowser("가장 최신 메시지 들어가줘");

  assert.equal(result.provider, "assistant-browser");
  assert.equal(result.actions[0].type, "browser_open_latest_mailbox_message");
  assert.match(result.reply, /최신 메일/);
});

test("handleBrowser prefers an OpenClaw session plan when available", async () => {
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
      async executePlan() {
        assert.fail("simple OpenClaw open_url plan should use the external browser open path");
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

  const result = await service.handleBrowser("아마존 공식 사이트");

  assert.deepEqual(calls, [
    {
      type: "open_url",
      target: "https://www.amazon.com/"
    }
  ]);
  assert.equal(result.details.planner, "openclaw-session");
  assert.equal(result.details.plannerReason, "claw-session-plan");
  assert.equal(result.details.openClawSessionRef, "latest");
});

test("handleBrowser falls back to Jarvis heuristics when the OpenClaw planner errors", async () => {
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
      async executePlan() {
        assert.fail("simple heuristic browser open should not invoke the structured planner");
      }
    },
    openClaw: {
      async planBrowserTask() {
        throw new Error("claw unavailable");
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleBrowser("구글 열어줘");

  assert.deepEqual(calls, [
    {
      type: "open_url",
      target: "https://www.google.com/"
    }
  ]);
  assert.equal(result.details.planner, "jarvis-heuristic");
  assert.equal(result.details.plannerReason, "openclaw-error");
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

  const result = await service.handleBrowser("깃허브에서 openai 검색해줘");

  assert.equal(executedPlans.length, 1);
  assert.deepEqual(
    executedPlans[0].map((step) => step.action),
    ["open_url", "site_search", "read_page"]
  );
  assert.equal(result.details.planner, "openclaw-session");
  assert.equal(result.details.plannerReason, "claw-session-plan");
});

test("handleAppOpen falls back to the official site when the app is missing", async () => {
  const service = new AssistantService({
    automation: {
      async listInstalledApps() {
        return {
          apps: []
        };
      },
      async execute(action) {
        assert.equal(action.type, "open_app");
        throw new Error("app not found");
      }
    },
    browser: {},
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const browserCalls = [];
  service.handleBrowser = async (query) => {
    browserCalls.push(query);
    return {
      reply: "아마존 열었어요.",
      actions: [{ type: "browser_open_url", target: "https://www.amazon.com/" }],
      provider: "system-browser",
      details: {
        url: "https://www.amazon.com/"
      }
    };
  };

  const result = await service.handleAppOpen("아마존 열어줘", {
    appName: "Amazon Shopping"
  });

  assert.deepEqual(browserCalls, ["Amazon Shopping 공식 사이트"]);
  assert.equal(result.provider, "system-browser");
  assert.match(result.reply, /공식 사이트/);
  assert.equal(result.details.fallbackMode, "official-site");
  assert.equal(result.details.executionEngine, "openclaw-fallback");
});

test("handleAppOpen falls back to the download page for install-style requests", async () => {
  const service = new AssistantService({
    automation: {
      async listInstalledApps() {
        return {
          apps: []
        };
      },
      async execute(action) {
        assert.equal(action.type, "open_app");
        throw new Error("app not found");
      }
    },
    browser: {},
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const browserCalls = [];
  service.handleBrowser = async (query) => {
    browserCalls.push(query);
    return {
      reply: "설치 페이지 열었어요.",
      actions: [{ type: "browser_open_url", target: "https://example.com/download" }],
      provider: "system-browser",
      details: {
        url: "https://example.com/download"
      }
    };
  };

  const result = await service.handleAppOpen("Amazon Shopping 설치해줘", {
    appName: "Amazon Shopping"
  });

  assert.deepEqual(browserCalls, ["Amazon Shopping 다운로드 공식 사이트"]);
  assert.equal(result.provider, "system-browser");
  assert.match(result.reply, /설치 페이지/);
  assert.equal(result.details.fallbackMode, "download-page");
  assert.equal(result.details.executionEngine, "openclaw-fallback");
});

test("executeRoute annotates browser work as openclaw fallback", async () => {
  const service = new AssistantService({
    automation: {},
    browser: {},
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  service.handleBrowser = async () => ({
    reply: "browser",
    actions: [],
    provider: "local",
    details: {}
  });

  const result = await service.executeRoute("아마존 공식 사이트", {
    route: "browser",
    language: "ko"
  });

  assert.equal(result.details.executionEngine, "openclaw-fallback");
  assert.equal(result.details.executionReason, "web-task");
});

test("executeRoute keeps installed app opens on the Jarvis structured path", async () => {
  const service = new AssistantService({
    automation: {
      async listInstalledApps() {
        return {
          apps: [{ name: "Calculator" }]
        };
      },
      async execute(action) {
        assert.equal(action.type, "open_app");
        return {
          resolvedTarget: "Calculator"
        };
      }
    },
    browser: {},
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.executeRoute("Calculator 열어줘", {
    route: "app_open",
    language: "ko",
    appName: "Calculator"
  });

  assert.equal(result.details.executionEngine, "jarvis-structured");
  assert.equal(result.details.executionReason, "installed-app-candidate");
});

test("buildHeuristicBrowserPlan does not mistake Google Pay email requests for the Google homepage", () => {
  const plan = buildHeuristicBrowserPlan("google pay한테 온 이메일");

  assert.deepEqual(plan.steps, [
    {
      action: "open_url",
      target: "google pay한테 온 이메일"
    }
  ]);
});

test("mailbox follow-ups keep the current Gmail context instead of falling back to chat", async () => {
  const originalIsConnected = unofficialAI.isConnected;

  try {
    unofficialAI.isConnected = async () => false;

    const service = new AssistantService({
      automation: {},
      browser: {},
      credentials: {},
      files: {},
      obs: {},
      screen: {},
      tts: {}
    });

    service.lastBrowserTargetUrl = "https://mail.google.com/mail/u/0/#inbox";
    service.lastBrowserTargetLabel = "Gmail";
    service.routeInput = async () => ({
      route: "chat",
      language: "ko"
    });
    service.executeRoute = async (input, route) => ({
      reply: `${route.route}:${input}`,
      actions: [],
      provider: "local"
    });
    service.handleGeneral = async () => ({
      reply: "chat:ok",
      actions: [],
      provider: "cloud"
    });

    const result = await service.handleInput("google pay한테 온 이메일");

    assert.equal(result.reply, "browser:google pay한테 온 이메일");
    assert.equal(result.provider, "local");
  } finally {
    unofficialAI.isConnected = originalIsConnected;
  }
});

test("generic email-site opens do not get trapped inside an unrelated previous browser context", () => {
  const service = new AssistantService({
    automation: {},
    browser: {},
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  service.lastBrowserTargetUrl = "https://github.com/openai";
  service.lastBrowserTargetLabel = "GitHub";

  assert.equal(service.looksLikeBrowserContextFollowUp("이메일 사이트에 접속할게"), false);
});

test("handleBrowserLogin opens the login page for manual sign-in by default", async () => {
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
      async openLoginEntry(target) {
        return {
          url: target,
          title: "GitHub",
          openMode: "assistant-browser"
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

  assert.deepEqual(calls, []);
  assert.equal(result.details.loginMode, "manual");
  assert.equal(result.provider, "assistant-browser");
  assert.match(result.reply, /로그인 화면/);
});

test("handleBrowserLogin reuses the current browser context when the user does not repeat the site", async () => {
  const loginTargets = [];
  const service = new AssistantService({
    automation: {},
    browser: {
      async openLoginEntry(target) {
        loginTargets.push(target);
        return {
          url: "https://www.amazon.ca/ap/signin",
          title: "Amazon Sign-In",
          openMode: "assistant-browser"
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

  service.lastBrowserTargetUrl = "https://www.amazon.ca/";
  service.lastBrowserTargetLabel = "Amazon";

  const result = await service.handleBrowserLogin("로그인 진행해줘 로그인창으로 먼저 들어가", {});

  assert.deepEqual(loginTargets, ["https://www.amazon.ca/"]);
  assert.equal(result.details.site, "Amazon");
  assert.equal(result.provider, "assistant-browser");
});

test("handleBrowserLogin prefills saved credentials after opening the login screen", async () => {
  const fillCalls = [];
  const service = new AssistantService({
    automation: {},
    browser: {
      async fillStoredCredential(target, options) {
        fillCalls.push({
          target,
          options
        });
        return {
          site: "amazon.ca",
          url: "https://www.amazon.ca/ap/signin",
          title: "Amazon Sign-In",
          usernameFilled: true,
          passwordFilled: true,
          loginPrefilled: true
        };
      }
    },
    credentials: {
      async getCredential() {
        return {
          site: "amazon.ca",
          username: "user@example.com",
          password: "secret"
        };
      }
    },
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleBrowserLogin("amazon.ca 로그인 진행해줘", {
    siteOrUrl: "amazon.ca"
  });

  assert.deepEqual(fillCalls, [
    {
      target: "amazon.ca",
      options: {
        submit: false,
        ensureLoginPage: true
      }
    }
  ]);
  assert.equal(result.details.loginMode, "prefilled");
  assert.equal(result.provider, "assistant-browser");
  assert.match(result.reply, /아이디와 비밀번호/);
});

test("handleInput still uses the local action router when a web AI provider is connected", async () => {
  const originalIsConnected = unofficialAI.isConnected;

  try {
    unofficialAI.isConnected = async () => "connected-web-ai";

    const service = new AssistantService({
      automation: {},
      browser: {},
      credentials: {},
      files: {},
      obs: {},
      screen: {},
      tts: {}
    });

    service.routeInput = async () => ({
      route: "browser",
      language: "ko"
    });
    service.executeRoute = async (_input, route) => ({
      reply: `${route.route}:ok`,
      actions: [],
      provider: "local"
    });
    service.handleGeneral = async () => ({
      reply: "chat:ok",
      actions: [],
      provider: "cloud"
    });

    const result = await service.handleInput("구글 열어줘");

    assert.equal(result.reply, "browser:ok");
    assert.equal(result.provider, "local");
  } finally {
    unofficialAI.isConnected = originalIsConnected;
  }
});
