const test = require("node:test");
const assert = require("node:assert/strict");

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

test("buildHeuristicBrowserPlan builds a chained site workflow", () => {
  const plan = buildHeuristicBrowserPlan("깃허브에서 openai 검색하고 로그인하고 활동 보여줘");

  assert.deepEqual(
    plan.steps.map((step) => step.action),
    ["open_url", "login_saved", "site_search", "read_page"]
  );
  assert.equal(plan.steps[0].target, "https://github.com/");
  assert.equal(plan.steps[1].target, "깃허브");
  assert.equal(plan.steps[2].query, "openai");
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
