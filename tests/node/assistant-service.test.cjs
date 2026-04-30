const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AssistantService,
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

test("handleBrowser labels Gmail direct opens as Gmail", async () => {
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
        assert.fail("simple Gmail open should not use Playwright automation");
      }
    },
    credentials: {},
    files: {},
    obs: {},
    screen: {},
    tts: {}
  });

  const result = await service.handleBrowser("Gmail 열어줘");

  assert.deepEqual(calls, [
    {
      type: "open_url",
      target: "https://mail.google.com/"
    }
  ]);
  assert.equal(result.reply, "지메일 열었어요.");
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
  assert.match(result.reply, /앱을 찾지 못했어요/);
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
      async loginWithStoredCredential() {
        assert.fail("manual login should not autofill saved credentials by default");
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

  const result = await service.handleBrowserLogin("깃허브 로그인해줘", {
    siteOrUrl: "깃허브"
  });

  assert.deepEqual(calls, [
    {
      type: "open_url",
      target: "https://github.com/"
    }
  ]);
  assert.equal(result.details.loginMode, "manual");
  assert.match(result.reply, /직접 로그인/);
});
