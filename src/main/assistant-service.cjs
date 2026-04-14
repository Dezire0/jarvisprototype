const {
  chat,
  buildBasePrompt,
  detectLanguageCode,
  ROUTER_MODEL,
  PLANNER_MODEL
} = require("./ollama-service.cjs");

const WEB_TARGET_ALIASES = new Set([
  "google",
  "구글",
  "youtube",
  "유튜브",
  "github",
  "깃허브",
  "gmail",
  "지메일",
  "naver",
  "네이버",
  "daum",
  "다음",
  "instagram",
  "인스타그램",
  "facebook",
  "페이스북",
  "twitter",
  "트위터",
  "x",
  "spotify",
  "스포티파이"
]);

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s]+|(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i);
  return match ? match[0] : "";
}

function extractAfterWakeWord(text) {
  return String(text)
    .replace(/^\s*(jarvis|자비스)\s*[,:]?\s*/i, "")
    .trim();
}

function normalizePlanText(text) {
  return extractAfterWakeWord(text)
    .replace(/[.?!]+$/g, "")
    .trim();
}

function normalizeWhitespace(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const match = String(raw).match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (__error) {
      return null;
    }
  }
}

function stripCommandPrefix(text) {
  return normalizePlanText(text)
    .replace(
      /^(open|go to|visit|search|browse|launch|run|open app|open the app|브라우저|열어|검색해|검색해서|찾아|찾아서|실행해|실행해줘|켜줘|켜)\s*/i,
      ""
    )
    .trim();
}

function guessSiteName(text) {
  const normalized = normalizePlanText(text);

  if (/(youtube|유튜브)/i.test(normalized)) {
    return "YouTube";
  }

  if (/(google|구글)/i.test(normalized)) {
    return "Google";
  }

  if (/(github|깃허브)/i.test(normalized)) {
    return "GitHub";
  }

  const domain = extractUrl(normalized);

  if (domain) {
    return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }

  const firstPhrase = normalized.match(/([A-Za-z0-9가-힣_-]{2,})/);
  return firstPhrase ? firstPhrase[1] : "";
}

function getKnownSiteUrl(siteName = "") {
  const lowered = siteName.toLowerCase();

  if (lowered === "youtube" || lowered === "유튜브") {
    return "https://www.youtube.com/";
  }

  if (lowered === "github" || lowered === "깃허브") {
    return "https://github.com/";
  }

  if (lowered === "google" || lowered === "구글") {
    return "https://www.google.com/";
  }

  return "";
}

function buildHeuristicBrowserPlan(input) {
  const normalized = normalizePlanText(input);
  const plan = {
    reply: "",
    steps: []
  };

  const explicitUrl = extractUrl(normalized);

  if (explicitUrl) {
    plan.steps.push({
      action: "open_url",
      target: explicitUrl
    });
    return plan;
  }

  if (/(유튜브에서|youtube.*search|search youtube)/i.test(normalized)) {
    const query = normalized
      .replace(/.*?(유튜브에서|youtube(?:에서)?)/i, "")
      .replace(/(검색.*|search.*)$/i, "")
      .trim();

    if (query) {
      plan.steps.push({
        action: "search_youtube",
        query
      });
    } else {
      plan.steps.push({
        action: "open_url",
        target: "https://www.youtube.com/"
      });
    }

    return plan;
  }

  const wantsSearch = /(검색|search|find|찾아)/i.test(normalized);
  const wantsEnter = /(들어가|들어가줘|열어줘|visit|go in|go there|open it|들어가서)/i.test(normalized);
  const mentionsGoogle = /(google|구글)/i.test(normalized);
  const siteName = guessSiteName(normalized);

  if (mentionsGoogle && wantsSearch) {
    const queryMatch =
      normalized.match(/(?:구글에서|google(?:에서)?)(.+?)(?:검색|search)/i) ||
      normalized.match(/(.+?)(?:검색|search)/i);
    const query = queryMatch?.[1]?.replace(/에서/g, "").trim() || siteName;

    plan.steps.push({
      action: "search_google",
      query
    });

    if (wantsEnter) {
      const knownSiteUrl = getKnownSiteUrl(siteName);

      if (knownSiteUrl) {
        plan.steps.push({
          action: "open_url",
          target: knownSiteUrl
        });
      } else if (siteName && query.length <= 24) {
        plan.steps.push({
          action: "click_text",
          text: siteName
        });
      } else {
        plan.steps.push({
          action: "click_search_result",
          index: 1
        });
      }
    }

    return plan;
  }

  if (wantsSearch) {
    const query = stripCommandPrefix(normalized);

    plan.steps.push({
      action: "search_google",
      query
    });

    if (wantsEnter) {
      plan.steps.push({
        action: "click_search_result",
        index: 1
      });
    }

    return plan;
  }

  if (/(유튜브|youtube)/i.test(normalized) && wantsEnter) {
    plan.steps.push({
      action: "open_url",
      target: "https://www.youtube.com/"
    });
    return plan;
  }

  plan.steps.push({
    action: "open_url",
    target: stripCommandPrefix(normalized)
  });

  return plan;
}

function buildLanguageName(languageCode) {
  return languageCode === "ko" ? "Korean" : "English";
}

function detectReplyLanguage(input) {
  return detectLanguageCode(input) === "ko" ? "ko" : "en";
}

function buildCommandFallback(language, message) {
  if (message) {
    return message;
  }

  return language === "ko" ? "처리했어요." : "Done.";
}

function looksComplexChainedRequest(text = "") {
  const normalized = normalizePlanText(text);

  return (
    /(?:그리고|그다음|다음에|이어서|한 다음|동시에|먼저|그 후|after that|and then|then|next|followed by|once|before|while)/i.test(
      normalized
    ) || normalized.length > 90
  );
}

function isFastBrowserPlan(plan = {}) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const allowedActions = new Set([
    "open_url",
    "search_google",
    "search_youtube",
    "click_text",
    "click_search_result"
  ]);

  return Boolean(steps.length) && steps.length <= 3 && steps.every((step) => allowedActions.has(step.action));
}

function isFastAppPlan(plan = {}) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const allowedActions = new Set([
    "open_app",
    "open_url",
    "app_type",
    "app_key",
    "app_shortcut",
    "app_menu_click"
  ]);

  return Boolean(steps.length) && steps.length <= 4 && steps.every((step) => allowedActions.has(step.action));
}

function shouldUseFallbackRouteDirectly(input, route = {}) {
  if (!route?.route || route.route === "chat") {
    return false;
  }

  if (looksComplexChainedRequest(input)) {
    return false;
  }

  return [
    "app_open",
    "app_action",
    "app_list",
    "browser",
    "browser_login",
    "spotify_play",
    "obs_connect",
    "obs_status",
    "obs_start",
    "obs_stop",
    "obs_scene",
    "file_list"
  ].includes(route.route);
}

function shouldSkipCommandPolish(input, result = {}) {
  const actions = Array.isArray(result.actions) ? result.actions : [];

  if (!actions.length) {
    return true;
  }

  if (looksComplexChainedRequest(input)) {
    return false;
  }

  return actions.length <= 3;
}

function buildCompactBrowserReply(input, steps = [], finalPage = {}) {
  const language = detectReplyLanguage(input);
  const lastStep = steps[steps.length - 1] || {};

  if (lastStep.action === "search_google" || lastStep.action === "search_youtube") {
    return language === "ko"
      ? `${lastStep.query || "요청한 내용"} 검색했어요.`
      : `I searched for ${lastStep.query || "that"}.`;
  }

  if (lastStep.action === "click_search_result") {
    return language === "ko"
      ? `${finalPage.title || "검색 결과"} 열었어요.`
      : `I opened ${finalPage.title || "the result"}.`;
  }

  if (lastStep.action === "open_url") {
    return language === "ko"
      ? `${finalPage.title || "페이지"} 열었어요.`
      : `I opened ${finalPage.title || "the page"}.`;
  }

  return language === "ko" ? "브라우저 작업을 처리했어요." : "I handled the browser task.";
}

function buildLocalRecommendationReply(input, language) {
  const lowered = normalizePlanText(input).toLowerCase();

  if (/(공부|study|learn|영어|english|시험|test)/i.test(lowered)) {
    return language === "ko"
      ? "이럴 때는 짧게 끊어서 가는 게 좋아요. 먼저 15분짜리 한 주제를 정하고, Notes에 핵심 표현 5개만 적은 뒤, 마지막에 제가 짧게 복습 질문을 드리는 흐름을 추천해요."
      : "A short focused loop usually works best here. Pick one 15-minute topic, write down five key phrases in Notes, and then let me quiz you briefly at the end.";
  }

  if (/(생산성|집중|focus|productive|work|todo|task|일정)/i.test(lowered)) {
    return language === "ko"
      ? "지금 바로 효율을 올리려면 세 가지가 좋아요. 오늘 가장 중요한 일 3개 정리, 필요한 앱만 먼저 열기, 그리고 집중 음악이나 타이머를 같이 켜는 흐름을 추천해요."
      : "Three things would help most right now: narrow today down to three important tasks, open only the apps you actually need, and pair that with focus music or a timer.";
  }

  if (/(음악|music|playlist|spotify|노래)/i.test(lowered)) {
    return language === "ko"
      ? "분위기에 따라 다르게 가는 게 좋아요. 집중용이면 lo-fi나 focus playlist, 기분 전환이면 upbeat pop, 밤에는 jazz나 ambient 쪽을 추천해요."
      : "It depends on the mood. For focus, I would go with a lo-fi or focus playlist. For a lift, upbeat pop works well, and for late-night work, jazz or ambient usually feels better.";
  }

  return language === "ko"
    ? "원하시면 이렇게 시작해볼 수 있어요. 먼저 지금 필요한 걸 짧게 정리하고, 그다음 바로 실행할 항목 하나를 정한 뒤, 제가 이어서 추천이나 실행까지 도와드릴게요."
    : "A good way to start is to quickly clarify what you need most, pick one thing to do first, and then let me either recommend the next step or carry it out for you.";
}

function buildLocalCapabilityReply(language) {
  return language === "ko"
    ? "저는 자연스럽게 대화하면서도 실제 작업까지 이어서 처리할 수 있어요. 앱 실행, 웹 탐색, 메시지 작성, 파일 읽기와 편집, 화면 이해, 추천 정리까지 한 흐름으로 도와드릴 수 있습니다."
    : "I can keep up a real conversation and also carry things through into desktop actions. That includes opening apps, navigating the web, drafting messages, handling files, understanding the screen, and giving useful recommendations.";
}

function buildLocalChatReply(input, history = []) {
  const language = detectReplyLanguage(input);
  const normalized = normalizePlanText(input);
  const lowered = normalized.toLowerCase();
  const lastAssistantMessage =
    history
      .slice()
      .reverse()
      .find((entry) => entry.role === "assistant")?.content || "";

  if (!normalized) {
    return language === "ko"
      ? "편하게 말씀해 주세요. 같이 정리해도 좋고, 바로 실행할 일부터 시작해도 괜찮습니다."
      : "Talk to me naturally. We can think it through together or move straight into the task.";
  }

  if (/(안녕|반가워|하이|hello|hi|hey)/i.test(normalized)) {
    return language === "ko"
      ? "안녕하세요. 무엇을 도와드릴까요? 편하게 대화하셔도 되고, 필요하면 바로 작업으로 이어서 처리하겠습니다."
      : "Hello. What can I help you with? We can talk naturally, and when you are ready I can carry the task out as well.";
  }

  if (/(고마워|감사|thanks|thank you)/i.test(normalized)) {
    return language === "ko"
      ? "언제든지요. 이어서 필요한 일이 있으면 바로 도와드리겠습니다."
      : "Anytime. If there is another step you want to take, I am ready.";
  }

  if (/(너 누구|누구야|정체|who are you|what are you)/i.test(lowered)) {
    return language === "ko"
      ? "저는 자비스예요. 자연스럽게 대화하면서도, 필요할 때는 바로 앱과 웹 작업까지 이어서 처리하도록 설계된 비서입니다."
      : "I am Jarvis. The idea is to feel conversational while still being able to carry real app and web actions through when needed.";
  }

  if (/(대화할 수 있|얘기할 수 있|말동무|chat with me|can you chat|can we talk|talk to me)/i.test(lowered)) {
    return language === "ko"
      ? "네, 가능합니다. 편하게 말 걸어 주시면 대화도 자연스럽게 이어가고, 필요할 때는 바로 작업으로 전환할 수 있어요."
      : "Yes. You can talk to me naturally, ask questions, or switch straight into getting something done.";
  }

  if (/(뭐 할 수|무엇을 할 수|할 수 있어|도움말|help|capabilities|what can you do)/i.test(lowered)) {
    return buildLocalCapabilityReply(language);
  }

  if (/(추천|recommend|suggest|idea|어떨까|어때)/i.test(lowered)) {
    return buildLocalRecommendationReply(input, language);
  }

  if (/(잘 지내|어때|how are you|how's it going)/i.test(lowered)) {
    return language === "ko"
      ? "좋습니다. 바로 도와드릴 준비가 되어 있어요. 지금은 대화로 정리해도 되고, 실행할 일부터 바로 시작해도 괜찮습니다."
      : "Doing well, and ready to help. We can talk things through first or jump straight into something concrete.";
  }

  if (/(계속|이어|then|next|follow up|follow-up)/i.test(lowered) && lastAssistantMessage) {
    return language === "ko"
      ? `좋아요. 방금 흐름을 이어가겠습니다. ${lastAssistantMessage}에서 바로 다음 단계로 넘어갈 수 있게 도와드릴게요.`
      : `Certainly. We can continue from the last step and move forward without losing the thread.`;
  }

  if (/[?？]$/.test(normalized) || /(왜|어떻게|뭐야|무슨|가능해|can you|could you|would you|how|why|what|which)/i.test(lowered)) {
    return language === "ko"
      ? "네, 같이 풀어볼 수 있어요. 원하시면 핵심만 짧게 설명드리거나, 바로 실전 쪽으로 이어질 수 있게 정리해드릴게요."
      : "Yes, we can work through that. If you want, I can keep it short and direct or turn it into a practical next step.";
  }

  return language === "ko"
    ? `${normalized} 방향으로 이어가면 되겠어요. 원하시면 제가 핵심을 정리하거나 다음 행동을 바로 추천해드릴게요.`
    : `We can keep going in that direction. If you want, I can tighten it up for you or suggest the best next move.`;
}

function looksLikeAppListRequest(text = "") {
  return /(앱 목록|앱 리스트|설치된 앱|사용 가능한 앱|list apps|installed apps|available apps)/i.test(normalizePlanText(text));
}

function extractQuotedText(text = "") {
  const match = String(text).match(/["“'`](.+?)["”'`]/);
  return match?.[1]?.trim() || "";
}

function refersToCurrentAppContext(text = "") {
  return /(거기|그 앱|그 안|that app|there|inside there|current app|방금 연 앱|현재 앱)/i.test(normalizePlanText(text));
}

function extractAppActionTarget(text = "") {
  const normalized = normalizePlanText(text);
  const patterns = [
    /^(.+?)\s*(?:앱에서|에서)\s+/i,
    /^(.+?)\s*(?:앱에|에)\s+/i,
    /(?:in|inside|within|on)\s+(.+?)(?=\s+(?:type|press|click|search|find|save|copy|paste|new|close|quit|focus)|$)/i,
    /^([A-Za-z0-9가-힣 .&+_-]+?)\s+(?:(?:type|press|click|search|find|save|copy|paste|new|close|quit|focus)|(?:입력|눌러|클릭|검색|저장|복사|붙여넣|새|닫아|종료))/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      if (refersToCurrentAppContext(candidate) || candidate.length > 60) {
        return "";
      }

      return candidate;
    }
  }

  return "";
}

function stripAppActionPrefix(text = "") {
  const normalized = normalizePlanText(text);
  const fromMatch = normalized.match(/^(.+?)\s*(?:앱에서|에서)\s+(.+)$/i);

  if (fromMatch?.[2]) {
    return fromMatch[2].trim();
  }

  const toMatch = normalized.match(/^(.+?)\s*(?:앱에|에)\s+(.+)$/i);

  if (toMatch?.[2]) {
    return toMatch[2].trim();
  }

  return normalized.replace(/^(?:in|inside|within|on)\s+.+?\s+/i, "").trim();
}

function looksLikeAppAction(text = "") {
  const lowered = normalizePlanText(text).toLowerCase();

  return (
    hasAny(lowered, [
      "open",
      "show",
      "go to",
      "switch",
      "move to",
      "열어",
      "보여",
      "이동",
      "입력",
      "type",
      "paste",
      "붙여넣",
      "press",
      "눌러",
      "shortcut",
      "단축키",
      "click",
      "클릭",
      "search",
      "find",
      "검색",
      "찾기",
      "save",
      "저장",
      "copy",
      "복사",
      "cut",
      "잘라내",
      "send",
      "message",
      "reply",
      "보내",
      "메시지",
      "답장",
      "new tab",
      "new window",
      "new note",
      "new document",
      "새 탭",
      "새 창",
      "새 노트",
      "새 문서",
      "menu",
      "메뉴",
      "enter",
      "엔터",
      "tab",
      "escape",
      "esc",
      "space",
      "spacebar",
      "backspace",
      "delete",
      "up",
      "down",
      "left",
      "right",
      "close",
      "닫아",
      "quit",
      "종료",
      "focus",
      "포커스",
      "play",
      "pause",
      "resume",
      "next track",
      "previous track",
      "재생",
      "일시정지",
      "다음 곡",
      "이전 곡"
    ]) &&
    !hasAny(lowered, ["브라우저", "browser login", "obs", "파일"])
  );
}

function wantsEnterAfterTyping(text = "") {
  return /(엔터|enter|return|검색 실행|search it|run search|확인해|실행해)$/i.test(normalizePlanText(text));
}

function mentionsSearchField(text = "") {
  return /(검색창|search box|search field|find box)/i.test(text);
}

function extractTypeText(text = "") {
  const quoted = extractQuotedText(text);
  if (quoted) {
    return quoted;
  }

  const stripped = stripAppActionPrefix(text);
  const patterns = [
    /(?:type|paste)\s+(.+)$/i,
    /(.+?)\s*(?:라고|을|를)?\s*(?:입력해줘|입력해|입력|붙여넣어줘|붙여넣어)$/i,
    /(?:입력해줘|입력해|입력)\s+(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = stripped.match(pattern);
    if (match?.[1]) {
      return match[1]
        .trim()
        .replace(/^(?:새\s*(?:탭|창|노트|문서|메모)\s*(?:만들어|만들고|열어|열고|create|open)\s*(?:주고|하고|한 다음|then|and)?\s*)+/i, "")
        .replace(/^(?:검색창\s*(?:열고|띄우고)\s*)+/i, "")
        .trim();
    }
  }

  return "";
}

function extractSearchQueryInApp(text = "") {
  const quoted = extractQuotedText(text);
  if (quoted && /(검색|search|find|찾아)/i.test(text)) {
    return quoted;
  }

  const stripped = stripAppActionPrefix(text);
  const patterns = [
    /(?:search(?: for)?|find)\s+(.+)$/i,
    /(.+?)\s*(?:검색해줘|검색해|검색|찾아줘|찾아)$/i
  ];

  for (const pattern of patterns) {
    const match = stripped.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return "";
}

function extractMenuPath(text = "") {
  const match = normalizePlanText(text).match(/(?:menu|메뉴)\s+(.+)$/i);

  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split(/>|\/|→|›/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function inferShortcutIntent(text = "") {
  const lowered = normalizePlanText(text).toLowerCase();

  if (/(새\s*탭|new tab)/i.test(lowered)) {
    return {
      key: "t",
      modifiers: ["command"],
      description: "new tab"
    };
  }

  if (/(새\s*폴더|new folder)/i.test(lowered)) {
    return {
      key: "n",
      modifiers: ["command", "shift"],
      description: "new folder"
    };
  }

  if (/(새\s*(창|문서|노트)|new (window|document|note))/i.test(lowered)) {
    return {
      key: "n",
      modifiers: ["command"],
      description: "new item"
    };
  }

  if (/(저장|save)/i.test(lowered)) {
    return {
      key: "s",
      modifiers: ["command"],
      description: "save"
    };
  }

  if (/(복사|copy)/i.test(lowered)) {
    return {
      key: "c",
      modifiers: ["command"],
      description: "copy"
    };
  }

  if (/(붙여넣|paste)/i.test(lowered) && !extractTypeText(text)) {
    return {
      key: "v",
      modifiers: ["command"],
      description: "paste"
    };
  }

  if (/(잘라내|cut)/i.test(lowered)) {
    return {
      key: "x",
      modifiers: ["command"],
      description: "cut"
    };
  }

  if (/(전체 선택|select all)/i.test(lowered)) {
    return {
      key: "a",
      modifiers: ["command"],
      description: "select all"
    };
  }

  if (/(되돌리기|undo)/i.test(lowered)) {
    return {
      key: "z",
      modifiers: ["command"],
      description: "undo"
    };
  }

  if (/(다시 실행|redo)/i.test(lowered)) {
    return {
      key: "z",
      modifiers: ["command", "shift"],
      description: "redo"
    };
  }

  if (/(닫아|close)/i.test(lowered)) {
    return {
      key: "w",
      modifiers: ["command"],
      description: "close"
    };
  }

  if (/(종료|quit)/i.test(lowered)) {
    return {
      key: "q",
      modifiers: ["command"],
      description: "quit"
    };
  }

  if (/(검색|search|find|찾기)/i.test(lowered)) {
    return {
      key: "f",
      modifiers: ["command"],
      description: "find"
    };
  }

  return null;
}

function inferKeyPress(text = "") {
  const lowered = normalizePlanText(text).toLowerCase();

  const keyMap = [
    { pattern: /(엔터|enter|return)/i, key: "enter" },
    { pattern: /\btab\b|탭/i, key: "tab" },
    { pattern: /(escape|esc|취소)/i, key: "escape" },
    { pattern: /(spacebar|space|스페이스)/i, key: "space" },
    { pattern: /(backspace|delete|삭제)/i, key: "delete" },
    { pattern: /(왼쪽|left)/i, key: "left" },
    { pattern: /(오른쪽|right)/i, key: "right" },
    { pattern: /(위로|up)/i, key: "up" },
    { pattern: /(아래로|down)/i, key: "down" }
  ];

  for (const item of keyMap) {
    if (item.pattern.test(lowered)) {
      return {
        key: item.key,
        modifiers: []
      };
    }
  }

  return null;
}

function buildFallbackAppPlan(input, appName) {
  const typingText = extractTypeText(input);
  const searchQuery = extractSearchQueryInApp(input);
  const menuPath = extractMenuPath(input);
  const shortcutIntent = inferShortcutIntent(input);
  const keyPress = inferKeyPress(input);
  const steps = [
    {
      action: "open_app",
      target: appName
    }
  ];

  if (menuPath.length) {
    steps.push({
      action: "app_menu_click",
      target: appName,
      menuPath
    });

    return {
      reply: "",
      steps
    };
  }

  if (searchQuery || (mentionsSearchField(input) && typingText)) {
    const query = searchQuery || typingText;

    if (/spotify/i.test(appName)) {
      const spotifyTargets = buildSpotifyTargets(query);
      steps.push({
        action: "open_url",
        target: spotifyTargets.uri,
        fallbackTarget: spotifyTargets.webUrl
      });

      return {
        reply: "",
        steps
      };
    }

    steps.push({
      action: "app_shortcut",
      target: appName,
      key: "f",
      modifiers: ["command"]
    });
    steps.push({
      action: "app_type",
      target: appName,
      text: query
    });
    steps.push({
      action: "app_key",
      target: appName,
      key: "enter"
    });

    return {
      reply: "",
      steps
    };
  }

  if (shortcutIntent) {
    steps.push({
      action: "app_shortcut",
      target: appName,
      key: shortcutIntent.key,
      modifiers: shortcutIntent.modifiers
    });
  }

  if (typingText) {
    steps.push({
      action: "app_type",
      target: appName,
      text: typingText
    });

    if (wantsEnterAfterTyping(input)) {
      steps.push({
        action: "app_key",
        target: appName,
        key: "enter"
      });
    }
  } else if (keyPress) {
    steps.push({
      action: "app_key",
      target: appName,
      key: keyPress.key,
      modifiers: keyPress.modifiers
    });
  }

  return {
    reply: "",
    steps
  };
}

function isLikelyWebTarget(text = "") {
  const normalized = normalizePlanText(text).toLowerCase();
  const stripped = stripCommandPrefix(text).toLowerCase();
  const appLike = extractAppName(text).toLowerCase();

  return (
    Boolean(extractUrl(normalized)) ||
    WEB_TARGET_ALIASES.has(normalized) ||
    WEB_TARGET_ALIASES.has(stripped) ||
    WEB_TARGET_ALIASES.has(appLike) ||
    /\b(?:website|site|url|browser|search|검색|브라우저|홈페이지|페이지)\b/i.test(text)
  );
}

function looksLikeAppLaunch(text) {
  const lowered = normalizePlanText(text).toLowerCase();
  const hasLaunchVerb = hasAny(lowered, [
    "open ",
    "launch",
    "run ",
    "start ",
    "execute",
    "켜",
    "실행",
    "열어",
    "시작해"
  ]);
  const looksWebLike =
    isLikelyWebTarget(text) ||
    hasAny(lowered, ["website", "site", "browser", "브라우저", "검색", "search", "google", "youtube"]);

  return hasLaunchVerb && !looksWebLike;
}

function looksLikeWebOpen(text) {
  const lowered = normalizePlanText(text).toLowerCase();
  const hasOpenVerb = hasAny(lowered, ["open", "visit", "go to", "열어", "들어가", "켜"]);

  return hasOpenVerb && isLikelyWebTarget(text);
}

function extractAppName(text) {
  return normalizePlanText(text)
    .replace(
      /^(please\s+)?(open|launch|run|start|execute|open app|open the app|켜|실행|열어|실행해|실행해줘|열어줘|켜줘|시작해줘)\s*/i,
      ""
    )
    .replace(/\s*(open|launch|run|start|execute|열어줘|열어|켜줘|켜|실행해줘|실행해|실행|시작해줘|시작해)\s*$/i, "")
    .replace(/\s+(app|application|앱)\s*$/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function extractFileWriteParts(input) {
  const match = input.match(/(?:write|edit|save)\s+file\s+(.+?)\s*:::\s*([\s\S]+)/i);

  if (!match) {
    return null;
  }

  return {
    path: match[1].trim(),
    content: match[2]
  };
}

function extractFileReadPath(input) {
  const match =
    input.match(/(?:read|open)\s+file\s+(.+)/i) ||
    input.match(/파일\s+(.+?)\s*(?:읽어|열어|보여줘)/i);

  return match?.[1]?.trim() || "";
}

function extractFileListPath(input) {
  const match =
    input.match(/(?:list|show)\s+(?:files?|directory|dir)\s*(.*)/i) ||
    input.match(/(.+?)\s*(?:폴더|디렉터리)\s*(?:목록|보여줘)/i);

  return match?.[1]?.trim() || ".";
}

function extractSceneName(input) {
  const match =
    input.match(/scene\s+(.+)/i) ||
    input.match(/씬\s+(.+?)\s*(?:로|으로)?\s*(?:바꿔|전환|변경)/i);

  return match?.[1]?.trim() || "";
}

function isSpotifyRequest(text = "") {
  return /(spotify|스포티파이)/i.test(normalizePlanText(text));
}

function looksLikeSpotifyPlayback(text = "") {
  const lowered = normalizePlanText(text).toLowerCase();

  return (
    isSpotifyRequest(lowered) &&
    hasAny(lowered, [
      "play",
      "playlist",
      "music",
      "song",
      "track",
      "틀어",
      "재생",
      "들려",
      "음악",
      "노래",
      "플레이리스트"
    ])
  );
}

function extractSpotifyQuery(input = "") {
  const query = normalizePlanText(input)
    .replace(/.*?(spotify|스포티파이)(?:에서|에서는|에서도|에서만)?\s*/i, "")
    .replace(
      /\s*(틀어줘|틀어|재생해줘|재생해|재생|play it|play this|play|들려줘|들려|켜줘|켜)\s*$/i,
      ""
    )
    .trim();

  if (!query) {
    return "";
  }

  if (/^(music|song|songs|track|playlist|음악|노래|플레이리스트)$/i.test(query)) {
    return "";
  }

  return query;
}

function detectWorkspaceAppName(text = "") {
  const normalized = normalizePlanText(text);

  if (/(slack|슬랙)/i.test(normalized)) {
    return "Slack";
  }

  if (/(discord|디스코드)/i.test(normalized)) {
    return "Discord";
  }

  return "";
}

function looksLikeFreshWorkspaceCommand(text = "") {
  return Boolean(detectWorkspaceAppName(text)) &&
    /(메시지|message|reply|답장|send|보내|dm|대화|conversation|채널|channel|열어|open|이동|switch|focus)/i.test(
      normalizePlanText(text)
    );
}

function buildSpotifyTargets(query = "") {
  const normalizedQuery = normalizeWhitespace(query);

  if (!normalizedQuery) {
    return {
      uri: "spotify:",
      webUrl: "https://open.spotify.com/"
    };
  }

  const encodedQuery = encodeURIComponent(normalizedQuery);
  return {
    uri: `spotify:search:${encodedQuery}`,
    webUrl: `https://open.spotify.com/search/${encodedQuery}`
  };
}

function cleanupParsedText(value = "") {
  return String(value)
    .trim()
    .replace(/^["“'`]+|["”'`]+$/g, "")
    .replace(/^[,:-]+|[,:-]+$/g, "")
    .replace(/[.?!]+$/g, "")
    .trim();
}

function cleanupWorkspaceMessage(value = "") {
  return cleanupParsedText(
    String(value)
      .replace(/\s*라고\s*$/i, "")
      .replace(/\s*라는\s*메시지\s*$/i, "")
  );
}

function getSpecializedAppSkill(appName = "") {
  const normalized = normalizePlanText(appName).toLowerCase();

  if (/(spotify|스포티파이)/i.test(normalized)) {
    return "spotify";
  }

  if (/(finder|파인더)/i.test(normalized)) {
    return "finder";
  }

  if (/(notes|메모)/i.test(normalized)) {
    return "notes";
  }

  if (/(google chrome|chrome|크롬|구글크롬)/i.test(normalized)) {
    return "chrome";
  }

  if (/(slack|슬랙)/i.test(normalized)) {
    return "slack";
  }

  if (/(discord|디스코드)/i.test(normalized)) {
    return "discord";
  }

  return "";
}

function parseSpotifySkill(input = "", route = {}) {
  const normalized = normalizePlanText(input);
  const query = normalizeWhitespace(route.query || extractSpotifyQuery(input));

  if (/(다음\s*곡|skip|next(?: track)?)/i.test(normalized)) {
    return {
      intent: "next"
    };
  }

  if (/(이전\s*곡|previous(?: track)?|prev(?: track)?)/i.test(normalized)) {
    return {
      intent: "previous"
    };
  }

  if (/(일시정지|pause|멈춰|정지해)/i.test(normalized)) {
    return {
      intent: "pause"
    };
  }

  if (/(다시\s*재생|재생\s*다시|resume|continue|keep playing)/i.test(normalized)) {
    return {
      intent: "resume"
    };
  }

  if (query) {
    return {
      intent: "search",
      query
    };
  }

  if (/(play|재생|틀어|들려|음악|노래|playlist|song|track)/i.test(normalized)) {
    return {
      intent: "resume"
    };
  }

  return {
    intent: "open"
  };
}

function extractFinderLocation(text = "") {
  const quoted = extractQuotedText(text);

  if (quoted && /(폴더|folder|path|directory|경로|finder|파인더|open|show|reveal|go to|열어|보여|이동)/i.test(text)) {
    return cleanupParsedText(quoted);
  }

  const stripped = stripAppActionPrefix(text)
    .replace(/^(?:새\s*창(?:을)?\s*(?:열고|열어|만들고|만들어)\s*)+/i, "")
    .replace(/^(?:new window\s*(?:and\s*)?)+/i, "")
    .trim();
  const patterns = [
    /(?:open|show|reveal|go to)\s+(.+?)\s*(?:folder|path|directory)?$/i,
    /(.+?)\s*(?:폴더|경로|디렉터리)?\s*(?:열어줘|열어|보여줘|보여|이동해줘|이동해)$/i
  ];

  for (const pattern of patterns) {
    const match = stripped.match(pattern);

    if (match?.[1]) {
      return cleanupParsedText(match[1]);
    }
  }

  return "";
}

function parseFinderSkill(text = "") {
  const normalized = normalizePlanText(text);

  if (/(검색|search|find|찾아)/i.test(normalized)) {
    const query = cleanupParsedText(extractSearchQueryInApp(text));

    if (query) {
      return {
        intent: "search",
        query
      };
    }
  }

  if (/(새\s*창|new window)/i.test(normalized)) {
    return {
      intent: "new_window",
      location: extractFinderLocation(text)
    };
  }

  const location = extractFinderLocation(text);

  if (location) {
    return {
      intent: "open_path",
      location
    };
  }

  return null;
}

function extractNotesTitle(text = "") {
  const stripped = stripAppActionPrefix(text);
  const explicit = stripped.match(/(?:제목(?:은|:)?|title(?: is|:)?)(.+?)(?=(?:내용(?:은|:)?|본문(?:은|:)?|body(?: is|:)?|text(?: is|:)?|$))/i);

  if (explicit?.[1]) {
    return cleanupParsedText(explicit[1]);
  }

  if (/(새\s*(노트|메모)|new (note|memo))/i.test(text) && extractQuotedText(text) && !/(내용|body|본문|text)/i.test(text)) {
    return cleanupParsedText(extractQuotedText(text));
  }

  return "";
}

function extractNotesBody(text = "") {
  const stripped = stripAppActionPrefix(text);
  const explicit = stripped.match(/(?:내용(?:은|:)?|본문(?:은|:)?|body(?: is|:)?|text(?: is|:)?)(.+)$/i);

  if (explicit?.[1]) {
    return cleanupParsedText(explicit[1]);
  }

  if (/(새\s*(노트|메모)|new (note|memo))/i.test(text)) {
    return cleanupParsedText(extractTypeText(text));
  }

  return "";
}

function parseNotesSkill(text = "") {
  const normalized = normalizePlanText(text);

  if (/(검색|search|find|찾아)/i.test(normalized)) {
    const query = cleanupParsedText(extractSearchQueryInApp(text));

    if (query) {
      return {
        intent: "search",
        query
      };
    }
  }

  if (/(새\s*(노트|메모)|new (note|memo))/i.test(normalized)) {
    return {
      intent: "create",
      title: extractNotesTitle(text),
      body: extractNotesBody(text)
    };
  }

  return null;
}

function extractChromeSearchQuery(text = "") {
  const quoted = extractQuotedText(text);

  if (quoted && /(검색|search|find|look up|찾아)/i.test(text)) {
    return cleanupParsedText(quoted);
  }

  const stripped = stripAppActionPrefix(text)
    .replace(/^(?:새\s*탭(?:을)?\s*(?:열고|열어|만들고|만들어|띄우고)\s*)+/i, "")
    .replace(/^(?:new tab\s*(?:and\s*)?)+/i, "")
    .trim();
  const patterns = [
    /(?:search(?: for)?|find|look up)\s+(.+)$/i,
    /(.+?)\s*(?:검색해줘|검색해|검색|찾아줘|찾아)$/i
  ];

  for (const pattern of patterns) {
    const match = stripped.match(pattern);

    if (match?.[1]) {
      return cleanupParsedText(match[1]);
    }
  }

  return "";
}

function extractChromeTarget(text = "") {
  const explicitUrl = extractUrl(text);

  if (explicitUrl) {
    return explicitUrl.startsWith("http") ? explicitUrl : `https://${explicitUrl}`;
  }

  const searchQuery = extractChromeSearchQuery(text);

  if (searchQuery) {
    return searchQuery;
  }

  const stripped = stripAppActionPrefix(text)
    .replace(/^(?:새\s*탭(?:을)?\s*(?:열고|열어|만들고|만들어|띄우고)\s*)+/i, "")
    .replace(/^(?:new tab\s*(?:and\s*)?)+/i, "")
    .trim();
  const match =
    stripped.match(/(?:open|go to|visit)\s+(.+)$/i) ||
    stripped.match(/(.+?)\s*(?:열어줘|열어|들어가줘|이동해줘|이동해)$/i);
  const candidate = cleanupParsedText(match?.[1] || "");

  if (!candidate || /^(?:새\s*탭|new tab)$/i.test(candidate)) {
    return "";
  }

  return candidate;
}

function parseChromeSkill(text = "") {
  const normalized = normalizePlanText(text);
  const wantsNewTab = /(새\s*탭|new tab)/i.test(normalized);

  if (/(뒤로|go back|\bback\b)/i.test(normalized)) {
    return {
      intent: "back"
    };
  }

  if (/(앞으로|go forward|forward)/i.test(normalized)) {
    return {
      intent: "forward"
    };
  }

  if (/(새로고침|refresh|reload)/i.test(normalized)) {
    return {
      intent: "refresh"
    };
  }

  const target = extractChromeTarget(text);

  if (target) {
    return {
      intent: "navigate",
      target,
      newTab: wantsNewTab
    };
  }

  if (wantsNewTab) {
    return {
      intent: "new_tab"
    };
  }

  return null;
}

function cleanupWorkspaceTarget(value = "") {
  return cleanupParsedText(
    String(value)
      .replace(/^[@#]/, "")
      .replace(/\s*(?:에|에게|한테)\s*$/i, "")
      .replace(/\s*(?:채널|channel|dm|direct message|대화|conversation)\s*$/i, "")
  );
}

function isCurrentWorkspaceReference(value = "") {
  return /^(?:여기|거기|지금\s*(?:대화|채팅|방)?|현재\s*(?:대화|채팅|방)?|이\s*(?:대화|채팅|방)|current|current\s+(?:chat|conversation)|here|this\s+(?:chat|conversation))$/i.test(
    cleanupParsedText(value)
  );
}

function parseWorkspaceSkill(text = "") {
  const stripped = stripAppActionPrefix(text).trim();
  const withoutWorkspaceApp = stripped.replace(/^(?:discord|디스코드|slack|슬랙)\s*/i, "").trim();
  const quoted = extractQuotedText(stripped);

  if (/^(?:dm\s*)?(?:메시지\s*)?(?:보내줘|보내|send(?:\s+a)?(?:\s+message)?|message|reply|답장해줘|답장)$/i.test(withoutWorkspaceApp)) {
    return {
      intent: "compose_message",
      target: "",
      message: ""
    };
  }

  if (
    /(read|check|show|latest|recent|누가|누구|읽어|알려|확인|최근|새로\s*온|온)/i.test(withoutWorkspaceApp) &&
    /(dm|디엠|메시지|message|messages|대화|conversation)/i.test(stripped) &&
    !/(보내|send|reply|답장)/i.test(stripped)
  ) {
    return {
      intent: "read_messages"
    };
  }

  if (quoted && /(보내|send|message|reply|답장)/i.test(stripped)) {
    const withoutQuoted = stripped.replace(/["“'`](.+?)["”'`]/, " ").replace(/\s+/g, " ").trim();
    const targetMatch =
      withoutQuoted.match(/^(.+?)\s*(?:에|에게|한테)\s*(?:라고\s*)?(?:메시지\s*)?(?:보내줘|보내|답장해줘|답장)$/i) ||
      withoutQuoted.match(/^(.+?)\s*(?:에|에게|한테)\s*(?:라고\s*)?(?:send|message|reply)$/i) ||
      withoutQuoted.match(/(?:to)\s+(.+?)\s*(?:send|message|reply).*$/i);

    return {
      intent: "send_message",
      target: isCurrentWorkspaceReference(targetMatch?.[1] || "") ? "" : cleanupWorkspaceTarget(targetMatch?.[1] || ""),
      message: cleanupWorkspaceMessage(quoted)
    };
  }

  const koreanMessage = stripped.match(/^(.+?)\s*(?:에|에게|한테)\s+(.+?)\s*(?:메시지\s*)?(?:보내줘|보내|답장해줘|답장)$/i);

  if (koreanMessage?.[1] && koreanMessage?.[2]) {
    return {
      intent: "send_message",
      target: isCurrentWorkspaceReference(koreanMessage[1]) ? "" : cleanupWorkspaceTarget(koreanMessage[1]),
      message: cleanupWorkspaceMessage(koreanMessage[2])
    };
  }

  const englishMessage = stripped.match(/^(?:send(?: a message)?|message|reply)\s+(.+?)\s+to\s+(.+)$/i);

  if (englishMessage?.[1] && englishMessage?.[2]) {
    return {
      intent: "send_message",
      target: isCurrentWorkspaceReference(englishMessage[2]) ? "" : cleanupWorkspaceTarget(englishMessage[2]),
      message: cleanupWorkspaceMessage(englishMessage[1])
    };
  }

  const bareMessage = stripped.match(/^(.+?)\s*(?:메시지\s*)?(?:보내줘|보내|send|reply)$/i);
  const bareCandidate = cleanupParsedText(bareMessage?.[1] || "");

  if (
    bareMessage?.[1] &&
    !/^(message|메시지|discord|디스코드|slack|슬랙)$/i.test(bareCandidate) &&
    !/(채널|channel|dm|대화|conversation|open|열어|이동)/i.test(bareMessage[1])
  ) {
    return {
      intent: "send_message",
      target: "",
      message: cleanupWorkspaceMessage(bareCandidate)
    };
  }

  const openMatch =
    stripped.match(/(?:open|switch to|go to|focus)\s+(.+?)\s*(?:channel|dm|conversation)?$/i) ||
    stripped.match(/(.+?)\s*(?:채널|dm|대화)?\s*(?:열어줘|열어|이동해줘|이동해|전환해줘|전환해|포커스해줘|포커스해)$/i);

  if (openMatch?.[1]) {
    return {
      intent: "open_target",
      target: cleanupWorkspaceTarget(openMatch[1])
    };
  }

  return null;
}

function parseWorkspaceFollowUp(text = "") {
  const normalized = normalizePlanText(text);

  if (!normalized) {
    return null;
  }

  if (/^(취소|cancel|그만|멈춰|stop)$/i.test(normalized)) {
    return {
      cancel: true
    };
  }

  const quoted = extractQuotedText(normalized);

  if (quoted) {
    const withoutQuoted = normalized.replace(/["“'`](.+?)["”'`]/, " ").replace(/\s+/g, " ").trim();
    const targetMatch =
      withoutQuoted.match(/^(.+?)\s*(?:에|에게|한테|to)$/i) ||
      withoutQuoted.match(/^(?:to)\s+(.+)$/i);

    return {
      target: cleanupWorkspaceTarget(targetMatch?.[1] || ""),
      message: cleanupWorkspaceMessage(quoted)
    };
  }

  const koreanPair = normalized.match(/^(.+?)\s*(?:에|에게|한테)\s+(.+)$/i);

  if (koreanPair?.[1] && koreanPair?.[2]) {
    return {
      target: cleanupWorkspaceTarget(koreanPair[1]),
      message: cleanupWorkspaceMessage(koreanPair[2])
    };
  }

  const englishPair = normalized.match(/^(.+?)\s+to\s+(.+)$/i);

  if (englishPair?.[1] && englishPair?.[2]) {
    return {
      message: cleanupWorkspaceMessage(englishPair[1]),
      target: cleanupWorkspaceTarget(englishPair[2])
    };
  }

  return null;
}

function buildRouteFallback(input) {
  const lowered = normalizePlanText(input).toLowerCase();
  const writeParts = extractFileWriteParts(input);
  const readPath = extractFileReadPath(input);
  const workspaceApp = detectWorkspaceAppName(input);

  if (looksLikeAppListRequest(input)) {
    return {
      route: "app_list",
      language: detectReplyLanguage(input)
    };
  }

  if (
    hasAny(lowered, ["academic", "study", "explain", "solve", "tutor", "문법", "grammar", "proofread", "rewrite"]) &&
    hasAny(lowered, ["screen", "화면", "ocr", "스크린"])
  ) {
    return {
      route: "screen_academic",
      language: detectReplyLanguage(input)
    };
  }

  if (hasAny(lowered, ["screen", "화면", "ocr", "스크린", "summarize screen"])) {
    return {
      route: "screen_summary",
      language: detectReplyLanguage(input)
    };
  }

  if (hasAny(lowered, ["login", "log in", "로그인"])) {
    return {
      route: "browser_login",
      language: detectReplyLanguage(input),
      siteOrUrl: extractUrl(input) || stripCommandPrefix(input)
    };
  }

  if (looksLikeSpotifyPlayback(input)) {
    return {
      route: "spotify_play",
      language: detectReplyLanguage(input),
      query: extractSpotifyQuery(input)
    };
  }

  if (
    workspaceApp &&
    /(메시지|message|reply|답장|dm|대화|conversation|채널|channel|보내|send|열어|이동|switch|focus)/i.test(input)
  ) {
    return {
      route: "app_action",
      language: detectReplyLanguage(input),
      appName: workspaceApp
    };
  }

  if (
    looksLikeAppAction(input) &&
    (Boolean(extractAppActionTarget(input)) || /(거기|그 앱|that app|there|방금 연 앱|현재 앱)/i.test(input))
  ) {
    return {
      route: "app_action",
      language: detectReplyLanguage(input),
      appName: extractAppActionTarget(input)
    };
  }

  if (hasAny(lowered, ["obs", "scene", "stream status", "방송", "씬"])) {
    if (hasAny(lowered, ["connect", "연결"])) {
      return {
        route: "obs_connect",
        language: detectReplyLanguage(input)
      };
    }

    if (hasAny(lowered, ["start stream", "방송 시작"])) {
      return {
        route: "obs_start",
        language: detectReplyLanguage(input)
      };
    }

    if (hasAny(lowered, ["stop stream", "방송 종료"])) {
      return {
        route: "obs_stop",
        language: detectReplyLanguage(input)
      };
    }

    if (hasAny(lowered, ["switch scene", "scene ", "씬"])) {
      return {
        route: "obs_scene",
        language: detectReplyLanguage(input),
        sceneName: extractSceneName(input)
      };
    }

    return {
      route: "obs_status",
      language: detectReplyLanguage(input)
    };
  }

  if (writeParts) {
    return {
      route: "file_write",
      language: detectReplyLanguage(input),
      path: writeParts.path,
      content: writeParts.content
    };
  }

  if (readPath) {
    return {
      route: "file_read",
      language: detectReplyLanguage(input),
      path: readPath
    };
  }

  if (hasAny(lowered, ["list files", "show files", "directory", "dir", "파일 목록", "폴더"])) {
    return {
      route: "file_list",
      language: detectReplyLanguage(input),
      path: extractFileListPath(input)
    };
  }

  if (hasAny(lowered, ["browser", "search", "open website", "go to", "브라우저", "검색"]) || Boolean(extractUrl(input))) {
    return {
      route: "browser",
      language: detectReplyLanguage(input)
    };
  }

  if (looksLikeWebOpen(input)) {
    return {
      route: "browser",
      language: detectReplyLanguage(input)
    };
  }

  if (hasAny(lowered, ["stream", "스트리밍"])) {
    return {
      route: "stream_prep",
      language: detectReplyLanguage(input)
    };
  }

  if (looksLikeAppLaunch(input)) {
    return {
      route: "app_open",
      language: detectReplyLanguage(input),
      appName: extractAppName(input)
    };
  }

  return {
    route: "chat",
    language: detectReplyLanguage(input)
  };
}

class AssistantService {
  constructor({ automation, browser, credentials, files, obs, screen }) {
    this.automation = automation;
    this.browser = browser;
    this.credentials = credentials;
    this.files = files;
    this.obs = obs;
    this.screen = screen;
    this.history = [];
    this.lastActiveApp = "";
    this.pendingWorkspaceMessage = null;
  }

  makeAction(type, target, status = "executed", extra = {}) {
    return {
      type,
      target,
      status,
      ...extra
    };
  }

  async completeLocalCommand(input, actions, details, fallback) {
    const result = {
      actions,
      details
    };

    return {
      reply: shouldSkipCommandPolish(input, result)
        ? buildCommandFallback(detectReplyLanguage(input), fallback)
        : await this.polishCommandReply(input, result, fallback),
      actions,
      provider: "local",
      details
    };
  }

  rememberTurn(role, content) {
    const clean = normalizeWhitespace(content);

    if (!clean) {
      return;
    }

    this.history.push({
      role,
      content: clean
    });

    if (this.history.length > 12) {
      this.history = this.history.slice(-12);
    }
  }

  getRecentHistory(limit = 8) {
    return this.history.slice(-limit);
  }

  buildHistorySnippet(limit = 6) {
    const recent = this.getRecentHistory(limit);

    if (!recent.length) {
      return "No previous conversation.";
    }

    return recent
      .map((entry) => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.content}`)
      .join("\n");
  }

  rememberAppContext(appName = "") {
    if (!appName) {
      return;
    }

    this.lastActiveApp = appName;
  }

  buildWorkspacePrompt(language, pending = {}) {
    const appName = pending.appName || "Discord";

    if (!pending.target && !pending.message) {
      return language === "ko"
        ? `${appName}에서 누구에게 어떤 메시지를 보낼까요? 예: w한테 "하이" 보내줘`
        : `Who should I message in ${appName}, and what should I send? Example: send "hi" to w`;
    }

    if (!pending.target) {
      return language === "ko"
        ? `${appName}에서 누구에게 보낼까요?`
        : `Who should I send that to in ${appName}?`;
    }

    return language === "ko"
      ? `${appName}에서 ${pending.target}에게 보낼 내용을 말씀해 주세요.`
      : `What message should I send to ${pending.target} in ${appName}?`;
  }

  buildWorkspaceReadReply(language, data = {}) {
    const appName = data.appName || "Discord";
    const title = cleanupParsedText(String(data.conversationTitle || "").replace(/^@/, ""));
    const messages = Array.isArray(data.messages) ? data.messages.filter((entry) => entry?.author && entry?.text) : [];

    if (!data.isDirectMessage) {
      return language === "ko"
        ? `${appName} 현재 창이 1:1 DM이 아니라서 읽지 않았어요. Discord에서 개인 DM을 열어두면 그 내용은 읽어드릴 수 있어요.`
        : `The current ${appName} window is not a one-on-one DM, so I did not read it. If you open a direct message, I can read what is visible there.`;
    }

    if (!messages.length) {
      return language === "ko"
        ? `${appName} 현재 화면에서 읽을 만한 DM 내용을 찾지 못했어요. 개인 DM을 화면에 보이게 한 뒤 다시 요청해 주세요.`
        : `I could not find readable DM content on the current ${appName} screen. Open the direct message on screen and ask again.`;
    }

    const preview = messages
      .slice(-3)
      .map((entry) => `${entry.author}: ${entry.text}`)
      .join(" / ");

    return language === "ko"
      ? `${appName} 현재 1:1 DM은 ${title || messages[messages.length - 1]?.author || "상대"} 쪽으로 보여요. 최근 보이는 내용은 ${preview}`
      : `The current one-on-one ${appName} DM appears to be with ${title || messages[messages.length - 1]?.author || "that person"}. The recent visible messages are ${preview}`;
  }

  async continuePendingWorkspaceMessage(input) {
    if (!this.pendingWorkspaceMessage) {
      return null;
    }

    const inputLooksLikeSlotOnly = !/(보내|send|message|메시지|reply|답장|취소|cancel|열어|open|이동|switch)/i.test(
      normalizePlanText(input)
    );
    const language = inputLooksLikeSlotOnly
      ? this.pendingWorkspaceMessage.language || detectReplyLanguage(input)
      : detectReplyLanguage(input);
    const parsed = parseWorkspaceSkill(input);
    const followUp = parsed?.intent === "send_message"
      ? {
        target: parsed.target || "",
        message: parsed.message || ""
      }
      : parseWorkspaceFollowUp(input);

    if (followUp?.cancel) {
      const appName = this.pendingWorkspaceMessage.appName || "Discord";
      this.pendingWorkspaceMessage = null;

      return {
        reply: language === "ko"
          ? `${appName} 메시지 보내기를 취소했어요.`
          : `I cancelled the ${appName} message draft.`,
        actions: [],
        provider: "local"
      };
    }

    const appName = detectWorkspaceAppName(input) || this.pendingWorkspaceMessage.appName || "Discord";
    let target = cleanupWorkspaceTarget(this.pendingWorkspaceMessage.target || "");
    let message = cleanupParsedText(this.pendingWorkspaceMessage.message || "");

    if (followUp?.target) {
      target = cleanupWorkspaceTarget(followUp.target);
    }

    if (followUp?.message) {
      message = cleanupParsedText(followUp.message);
    }

    if (!followUp && !target && message) {
      target = cleanupWorkspaceTarget(input);
    } else if (!followUp && target && !message) {
      message = cleanupParsedText(input);
    } else if (!followUp && !target && !message) {
      message = cleanupParsedText(input);
    }

    if (!target || !message) {
      this.pendingWorkspaceMessage = {
        appName,
        target,
        message,
        language
      };

      return {
        reply: this.buildWorkspacePrompt(language, this.pendingWorkspaceMessage),
        actions: [],
        provider: "local"
      };
    }

    const data = await this.automation.execute({
      type: "workspace_send_message",
      targetApp: appName,
      destination: target,
      message
    });
    this.pendingWorkspaceMessage = null;
    this.rememberAppContext(appName);

    return this.completeLocalCommand(
      input,
      [this.makeAction("workspace_send_message", `${appName}:${target}:${message}`)],
      {
        appName,
        mode: "send_message",
        target,
        message,
        lastResult: data
      },
      language === "ko"
        ? `${appName}에서 ${target}에게 메시지를 보냈어요.`
        : `I sent the message to ${target} in ${appName}.`
    );
  }

  async resolveAppContext(input, route = {}, options = {}) {
    const allowDirect = options.allowDirect !== false;
    const candidates = [
      route.appName,
      detectWorkspaceAppName(input),
      refersToCurrentAppContext(input) && options.allowLastActive !== false ? this.lastActiveApp : "",
      extractAppActionTarget(input),
      extractAppName(input),
      options.allowLastActive === false ? "" : this.lastActiveApp
    ].filter(Boolean);
    const uniqueCandidates = [...new Set(candidates.map((item) => item.trim()).filter(Boolean))];

    for (const candidate of uniqueCandidates) {
      const resolved = await this.automation.resolveAppTarget(candidate, {
        allowDirect: false
      });

      if (resolved) {
        return resolved;
      }
    }

    if (uniqueCandidates[0] && allowDirect) {
      return this.automation.resolveAppTarget(uniqueCandidates[0], {
        allowDirect: true
      });
    }

    return null;
  }

  async tryHandleSpecializedAppAction(input, route, appName) {
    const skill = getSpecializedAppSkill(appName);

    if (skill === "spotify") {
      return this.handleSpotifySkill(input, route, appName);
    }

    if (skill === "finder") {
      return this.handleFinderSkill(input, appName);
    }

    if (skill === "notes") {
      return this.handleNotesSkill(input, appName);
    }

    if (skill === "chrome") {
      return this.handleChromeSkill(input, appName);
    }

    if (skill === "slack" || skill === "discord") {
      return this.handleWorkspaceSkill(input, appName);
    }

    return null;
  }

  async handleSpotifySkill(input, route = {}, appName = "Spotify") {
    const parsed = parseSpotifySkill(input, route);
    const actions = [];
    const opened = await this.automation.execute({
      type: "open_app",
      target: appName
    });
    const resolvedName = opened.resolvedTarget || opened.appName || appName;

    actions.push(this.makeAction("open_app", resolvedName));
    this.rememberAppContext(resolvedName);

    if (parsed.intent === "search" && parsed.query) {
      const spotifyTargets = buildSpotifyTargets(parsed.query);
      let mode = "search";

      try {
        await this.automation.execute({
          type: "open_url",
          target: spotifyTargets.uri
        });
        actions.push(this.makeAction("open_url", spotifyTargets.uri));
      } catch (_error) {
        await this.automation.execute({
          type: "open_url",
          target: spotifyTargets.webUrl
        });
        actions.push(this.makeAction("open_url", spotifyTargets.webUrl));
        mode = "web-search";
      }

      const fallback =
        detectReplyLanguage(input) === "ko"
          ? `${resolvedName}에서 ${parsed.query} 검색 결과를 열어뒀어요. 바로 재생할 대상을 고를 수 있어요.`
          : `I opened ${resolvedName} results for ${parsed.query}.`;

      return this.completeLocalCommand(
        input,
        actions,
        {
          appName: resolvedName,
          mode,
          query: parsed.query,
          spotifyTargets
        },
        fallback
      );
    }

    if (parsed.intent === "next" || parsed.intent === "previous" || parsed.intent === "pause" || parsed.intent === "resume") {
      const commandMap = {
        next: "next",
        previous: "previous",
        pause: "pause",
        resume: "resume"
      };

      const data = await this.automation.execute({
        type: "spotify_control",
        command: commandMap[parsed.intent]
      });
      actions.push(this.makeAction("spotify_control", `${resolvedName}:${commandMap[parsed.intent]}`));

      const fallback =
        detectReplyLanguage(input) === "ko"
          ? parsed.intent === "next"
            ? `${resolvedName}에서 다음 곡으로 넘겼어요.`
            : parsed.intent === "previous"
              ? `${resolvedName}에서 이전 곡으로 이동했어요.`
              : parsed.intent === "pause"
                ? `${resolvedName} 재생을 멈췄어요.`
                : `${resolvedName} 재생을 이어봤어요.`
          : parsed.intent === "next"
            ? `I skipped to the next track in ${resolvedName}.`
            : parsed.intent === "previous"
              ? `I moved to the previous track in ${resolvedName}.`
              : parsed.intent === "pause"
                ? `I paused ${resolvedName}.`
                : `I resumed playback in ${resolvedName}.`;

      return this.completeLocalCommand(
        input,
        actions,
        {
          appName: resolvedName,
          mode: parsed.intent,
          lastResult: data
        },
        fallback
      );
    }

    return this.completeLocalCommand(
      input,
      actions,
      {
        appName: resolvedName,
        mode: "opened"
      },
      detectReplyLanguage(input) === "ko"
        ? `${resolvedName}를 앞으로 가져왔어요. 곡 검색이나 재생 제어를 바로 이어서 할 수 있어요.`
        : `I brought ${resolvedName} to the front. I can search or control playback there next.`
    );
  }

  async handleFinderSkill(input, appName = "Finder") {
    const parsed = parseFinderSkill(input);

    if (!parsed) {
      return null;
    }

    let data;
    let actions;
    let fallback;

    if (parsed.intent === "search") {
      data = await this.automation.execute({
        type: "finder_search",
        query: parsed.query
      });
      actions = [this.makeAction("finder_search", parsed.query)];
      fallback =
        detectReplyLanguage(input) === "ko"
          ? `Finder에서 ${parsed.query} 검색을 시작했어요.`
          : `I started a Finder search for ${parsed.query}.`;
    } else if (parsed.intent === "new_window") {
      data = await this.automation.execute({
        type: "finder_new_window",
        target: parsed.location || ""
      });
      actions = [
        this.makeAction("finder_new_window", parsed.location || "default")
      ];
      fallback =
        detectReplyLanguage(input) === "ko"
          ? parsed.location
            ? `Finder에서 ${parsed.location} 위치를 새 창으로 열었어요.`
            : "Finder 새 창을 열었어요."
          : parsed.location
            ? `I opened ${parsed.location} in a new Finder window.`
            : "I opened a new Finder window.";
    } else {
      data = await this.automation.execute({
        type: "finder_open_path",
        target: parsed.location
      });
      actions = [this.makeAction("finder_open_path", parsed.location)];
      fallback =
        detectReplyLanguage(input) === "ko"
          ? `Finder에서 ${parsed.location} 위치를 열었어요.`
          : `I opened ${parsed.location} in Finder.`;
    }

    this.rememberAppContext(appName);
    return this.completeLocalCommand(
      input,
      actions,
      {
        appName,
        mode: parsed.intent,
        lastResult: data
      },
      fallback
    );
  }

  async handleNotesSkill(input, appName = "Notes") {
    const parsed = parseNotesSkill(input);

    if (!parsed) {
      return null;
    }

    if (parsed.intent === "search") {
      const data = await this.automation.execute({
        type: "notes_search",
        query: parsed.query
      });
      this.rememberAppContext(appName);
      return this.completeLocalCommand(
        input,
        [this.makeAction("notes_search", parsed.query)],
        {
          appName,
          mode: "search",
          lastResult: data
        },
        detectReplyLanguage(input) === "ko"
          ? `Notes에서 ${parsed.query} 검색을 열어뒀어요.`
          : `I opened a Notes search for ${parsed.query}.`
      );
    }

    const data = await this.automation.execute({
      type: "notes_create_note",
      title: parsed.title || "",
      body: parsed.body || ""
    });
    this.rememberAppContext(appName);

    return this.completeLocalCommand(
      input,
      [this.makeAction("notes_create_note", parsed.title || parsed.body || "untitled")],
      {
        appName,
        mode: "create",
        title: parsed.title || "",
        body: parsed.body || "",
        lastResult: data
      },
      detectReplyLanguage(input) === "ko"
        ? parsed.title
          ? `Notes에 ${parsed.title} 노트를 만들어뒀어요.`
          : "Notes에 새 노트를 만들어뒀어요."
        : parsed.title
          ? `I created the note ${parsed.title} in Notes.`
          : "I created a new note in Notes."
    );
  }

  async handleChromeSkill(input, appName = "Google Chrome") {
    const parsed = parseChromeSkill(input);

    if (!parsed) {
      return null;
    }

    if (parsed.intent === "navigate") {
      const data = await this.automation.execute({
        type: "chrome_navigate",
        target: parsed.target,
        newTab: Boolean(parsed.newTab)
      });
      this.rememberAppContext(appName);
      return this.completeLocalCommand(
        input,
        [this.makeAction("chrome_navigate", `${parsed.newTab ? "new-tab:" : ""}${parsed.target}`)],
        {
          appName,
          mode: "navigate",
          target: parsed.target,
          newTab: Boolean(parsed.newTab),
          lastResult: data
        },
        detectReplyLanguage(input) === "ko"
          ? `${appName}에서 ${parsed.target} 쪽으로 이동했어요.`
          : `I navigated ${appName} to ${parsed.target}.`
      );
    }

    const shortcutMap = {
      new_tab: {
        key: "t",
        modifiers: ["command"]
      },
      back: {
        key: "[",
        modifiers: ["command"]
      },
      forward: {
        key: "]",
        modifiers: ["command"]
      },
      refresh: {
        key: "r",
        modifiers: ["command"]
      }
    };
    const shortcut = shortcutMap[parsed.intent];

    if (!shortcut) {
      return null;
    }

    const data = await this.automation.execute({
      type: "app_shortcut",
      target: appName,
      key: shortcut.key,
      modifiers: shortcut.modifiers
    });
    this.rememberAppContext(appName);

    return this.completeLocalCommand(
      input,
      [this.makeAction("app_shortcut", `${appName}:${shortcut.modifiers.join("+")}+${shortcut.key}`)],
      {
        appName,
        mode: parsed.intent,
        lastResult: data
      },
      detectReplyLanguage(input) === "ko"
        ? parsed.intent === "new_tab"
          ? `${appName} 새 탭을 열었어요.`
          : parsed.intent === "back"
            ? `${appName}에서 뒤로 이동했어요.`
            : parsed.intent === "forward"
              ? `${appName}에서 앞으로 이동했어요.`
              : `${appName}를 새로고침했어요.`
        : parsed.intent === "new_tab"
          ? `I opened a new tab in ${appName}.`
          : parsed.intent === "back"
            ? `I went back in ${appName}.`
            : parsed.intent === "forward"
              ? `I went forward in ${appName}.`
              : `I refreshed ${appName}.`
    );
  }

  async handleWorkspaceSkill(input, appName) {
    const parsed = parseWorkspaceSkill(input);

    if (!parsed) {
      return null;
    }

    if (parsed.intent === "compose_message") {
      this.pendingWorkspaceMessage = {
        appName,
        target: "",
        message: "",
        language: detectReplyLanguage(input)
      };
      this.rememberAppContext(appName);

      return {
        reply: this.buildWorkspacePrompt(detectReplyLanguage(input), this.pendingWorkspaceMessage),
        actions: [],
        provider: "local"
      };
    }

    if (parsed.intent === "read_messages") {
      const data = await this.automation.execute({
        type: "workspace_read_messages",
        targetApp: appName
      });
      this.rememberAppContext(appName);

      return {
        reply: this.buildWorkspaceReadReply(detectReplyLanguage(input), data),
        actions: [this.makeAction("workspace_read_messages", appName)],
        provider: "local",
        details: data
      };
    }

    if (parsed.intent === "open_target") {
      const data = await this.automation.execute({
        type: "workspace_switch_target",
        targetApp: appName,
        destination: parsed.target
      });
      this.rememberAppContext(appName);

      return this.completeLocalCommand(
        input,
        [this.makeAction("workspace_switch_target", `${appName}:${parsed.target}`)],
        {
          appName,
          mode: "open_target",
          target: parsed.target,
          lastResult: data
        },
        detectReplyLanguage(input) === "ko"
          ? `${appName}에서 ${parsed.target} 대상으로 이동했어요.`
          : `I switched ${appName} to ${parsed.target}.`
      );
    }

    if (parsed.intent === "send_message" && parsed.message) {
      if (!parsed.target) {
        this.pendingWorkspaceMessage = {
          appName,
          target: "",
          message: parsed.message,
          language: detectReplyLanguage(input)
        };
        this.rememberAppContext(appName);

        return {
          reply: this.buildWorkspacePrompt(detectReplyLanguage(input), this.pendingWorkspaceMessage),
          actions: [],
          provider: "local"
        };
      }

      const data = await this.automation.execute({
        type: "workspace_send_message",
        targetApp: appName,
        destination: parsed.target || "",
        message: parsed.message
      });
      this.rememberAppContext(appName);

      return this.completeLocalCommand(
        input,
        [
          this.makeAction(
            "workspace_send_message",
            `${appName}:${parsed.target || "current"}:${parsed.message}`
          )
        ],
        {
          appName,
          mode: "send_message",
          target: parsed.target || "",
          message: parsed.message,
          lastResult: data
        },
        detectReplyLanguage(input) === "ko"
          ? parsed.target
            ? `${appName}에서 ${parsed.target} 대상으로 메시지를 보냈어요.`
            : `${appName} 현재 대화에 메시지를 보냈어요.`
          : parsed.target
            ? `I sent the message to ${parsed.target} in ${appName}.`
            : `I sent the message in the current ${appName} conversation.`
      );
    }

    return null;
  }

  async handleAppList(input) {
    const data = await this.automation.listInstalledApps({
      limit: 400
    });
    const preview = data.apps.slice(0, 18).map((app) => app.name).join(", ");
    const fallback = detectReplyLanguage(input) === "ko"
      ? `설치된 앱을 ${data.totalCount}개 읽어왔어요. 예를 들면 ${preview}${data.totalCount > data.apps.length ? " 등" : ""}이 있어요.`
      : `I found ${data.totalCount} installed apps. Examples include ${preview}${data.totalCount > data.apps.length ? ", and more." : "."}`;

    return {
      reply: fallback,
      actions: [this.makeAction("app_list", `count:${data.totalCount}`)],
      provider: "local",
      details: data
    };
  }

  async handleAppAction(input, route) {
    const resolved = await this.resolveAppContext(input, route, {
      allowDirect: false
    });

    if (!resolved?.resolvedTarget) {
      throw new Error(
        detectReplyLanguage(input) === "ko"
          ? "어떤 앱에서 작업해야 하는지 아직 확실하지 않아요. 앱 이름을 같이 말씀해 주세요."
          : "I am not sure which app you want me to control yet. Please include the app name."
      );
    }

    const appName = resolved.resolvedTarget;
    const specialized = await this.tryHandleSpecializedAppAction(input, route, appName);

    if (specialized) {
      return specialized;
    }

    const appPlan = await this.planAppTask(input, appName);
    const actions = [];
    let lastData = {
      appName
    };

    for (const step of appPlan.steps) {
      if (step.action === "open_url" && step.fallbackTarget) {
        try {
          lastData = await this.automation.execute({
            type: "open_url",
            target: step.target
          });
          actions.push(this.makeAction("open_url", step.target));
        } catch (_error) {
          lastData = await this.automation.execute({
            type: "open_url",
            target: step.fallbackTarget
          });
          actions.push(this.makeAction("open_url", step.fallbackTarget));
        }
        continue;
      }

      lastData = await this.automation.execute({
        type: step.action,
        target: step.target || appName,
        key: step.key,
        text: step.text,
        menuPath: step.menuPath,
        modifiers: step.modifiers
      });

      if (step.action === "open_app") {
        this.rememberAppContext(lastData.resolvedTarget || lastData.appName || appName);
      }

      const targetLabel =
        step.action === "app_menu_click"
          ? `${step.target || appName}:${(step.menuPath || []).join(" > ")}`
          : step.action === "app_shortcut"
            ? `${step.target || appName}:${(step.modifiers || []).join("+")}+${step.key}`
            : step.action === "app_type"
              ? `${step.target || appName}:${step.text || ""}`
              : step.action === "app_key"
                ? `${step.target || appName}:${step.key || ""}`
                : step.target || appName;

      actions.push(this.makeAction(step.action, targetLabel));
    }

    const fallback = detectReplyLanguage(input) === "ko"
      ? actions.length > 1
        ? `${appName}에서 요청한 동작을 실행했어요.`
        : `${appName}를 앞으로 가져왔어요.`
      : actions.length > 1
        ? `I carried out the action inside ${appName}.`
        : `I brought ${appName} to the front.`;

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions,
          details: {
            appName,
            plannedSteps: appPlan.steps,
            lastResult: lastData
          }
        },
        fallback
      ),
      actions,
      provider: "local",
      details: {
        appName,
        plannedSteps: appPlan.steps,
        lastResult: lastData
      }
    };
  }

  async replyWithModel(userPrompt, extraContext = "", options = {}) {
    const includeHistory = options.includeHistory !== false;

    return chat({
      systemPrompt: options.systemPrompt || buildBasePrompt(),
      history: includeHistory ? this.getRecentHistory() : [],
      userPrompt: extraContext ? `${extraContext}\n\nUser request:\n${userPrompt}` : userPrompt
    });
  }

  async routeInput(input) {
    const fallback = buildRouteFallback(input);
    if (shouldUseFallbackRouteDirectly(input, fallback)) {
      return fallback;
    }
    const routerPrompt = [
      "You are the intent router for a bilingual desktop assistant.",
      "Respond with valid JSON only.",
      'Schema: {"route":"chat|browser|browser_login|screen_summary|screen_academic|obs_connect|obs_status|obs_start|obs_stop|obs_scene|file_read|file_write|file_list|stream_prep|app_open|app_action|app_list|spotify_play","language":"ko|en","appName":"","siteOrUrl":"","path":"","content":"","sceneName":"","query":"","reason":""}',
      "Use chat for general conversation, recommendations, ideas, opinions, follow-up discussion, or questions that do not clearly require a desktop action.",
      "Use app_open for opening a local desktop app like Chrome, Finder, Terminal, Slack, Spotify, Notion, Steam, OBS, or VS Code.",
      "Use app_action when the user wants to do something inside a desktop app, such as typing, sending a message in Slack or Discord, pressing a key, running a shortcut, searching, opening a folder or tab, creating a new item, or using a menu.",
      "Use app_list when the user asks to list installed or available desktop apps.",
      "Use spotify_play when the user wants Spotify to play, pause, resume, skip, search, or open a playlist, song, or music request inside Spotify.",
      "Use browser for website navigation, URLs, searches, or reading web pages.",
      "Use browser_login only for explicit login requests.",
      "Use screen_summary for OCR or screen understanding.",
      "Use screen_academic for tutoring, explanation, grammar correction, or study help about the current screen.",
      "Use obs_* only for OBS connection, status, stream control, or scene switching.",
      "Use file_* only for local file tasks.",
      "If unsure, return chat.",
      "language must be ko if the user is mainly speaking Korean, otherwise en."
    ].join(" ");

    try {
      const raw = await chat({
        systemPrompt: routerPrompt,
        model: ROUTER_MODEL,
        userPrompt: [
          "Recent conversation:",
          this.buildHistorySnippet(),
          "",
          "Current user input:",
          input
        ].join("\n")
      });

      const parsed = safeJsonParse(raw);

      if (!parsed?.route) {
        return fallback;
      }

      if (fallback.route !== "chat" && parsed.route === "chat") {
        return fallback;
      }

      return {
        ...fallback,
        ...parsed,
        language: parsed.language === "ko" ? "ko" : fallback.language
      };
    } catch (_error) {
      return fallback;
    }
  }

  async planBrowserTask(input) {
    const heuristic = buildHeuristicBrowserPlan(input);

    if (!looksComplexChainedRequest(input) && isFastBrowserPlan(heuristic)) {
      return heuristic;
    }

    try {
      const plannerPrompt = [
        "You convert desktop browser requests into a short JSON execution plan.",
        "Respond with valid JSON only.",
        'Schema: {"reply":"short summary","steps":[{"action":"open_url","target":"https://example.com"}]}',
        "Allowed actions: open_url, search_google, search_youtube, click_text, click_search_result, read_page.",
        "For navigation requests like 'search then open', create multiple steps in order.",
        "For known site names like YouTube, GitHub, and Google, prefer click_text or open_url rather than raw search-result URLs."
      ].join(" ");

      const raw = await chat({
        systemPrompt: plannerPrompt,
        model: PLANNER_MODEL,
        userPrompt: normalizePlanText(input)
      });

      const parsed = safeJsonParse(raw);

      if (!parsed?.steps?.length) {
        return heuristic;
      }

      const plan = {
        reply: parsed.reply || "",
        steps: parsed.steps
      };

      if (heuristic.steps.length >= 2 && heuristic.steps[1]?.action === "open_url") {
        return heuristic;
      }

      return plan;
    } catch (_error) {
      return heuristic;
    }
  }

  async planAppTask(input, appName) {
    const fallback = buildFallbackAppPlan(input, appName);

    if (!looksComplexChainedRequest(input) && isFastAppPlan(fallback)) {
      return fallback;
    }

    try {
      const plannerPrompt = [
        "You convert desktop app control requests into a short JSON execution plan.",
        "Respond with valid JSON only.",
        'Schema: {"reply":"short summary","steps":[{"action":"open_app","target":"Notes"}]}',
        "Allowed actions: open_app, open_url, app_type, app_key, app_shortcut, app_menu_click.",
        "app_key fields: target, key, optional modifiers.",
        "app_shortcut fields: target, key, modifiers.",
        "app_type fields: target, text.",
        "app_menu_click fields: target, menuPath as an array of menu labels.",
        "Always start with open_app unless the request is impossible.",
        "Keep plans safe and realistic for desktop UI automation.",
        "Prefer command+n for new notes/documents/tabs/windows, command+f for in-app search, and enter to confirm searches when needed."
      ].join(" ");

      const raw = await chat({
        systemPrompt: plannerPrompt,
        model: PLANNER_MODEL,
        userPrompt: [
          `App name: ${appName}`,
          "",
          `User request: ${input}`
        ].join("\n")
      });

      const parsed = safeJsonParse(raw);

      if (!parsed?.steps?.length) {
        return fallback;
      }

      return {
        reply: parsed.reply || "",
        steps: parsed.steps.map((step) => ({
          ...step,
          target: step.target || appName
        }))
      };
    } catch (_error) {
      return fallback;
    }
  }

  async polishCommandReply(input, result, fallbackMessage = "") {
    const language = detectReplyLanguage(input);
    const summary = JSON.stringify(
      {
        actions: result.actions,
        details: result.details || {}
      },
      null,
      2
    );
    const fallback = buildCommandFallback(language, fallbackMessage || result.reply);

    if (shouldSkipCommandPolish(input, result)) {
      return fallback;
    }

    try {
      return await chat({
        systemPrompt: [
          "You write the final user-facing message for Jarvis after a desktop task has already been executed.",
          `Reply only in ${buildLanguageName(language)}.`,
          "Sound calm, polished, and competent with a subtle Jarvis flavor.",
          "Keep it to 1 or 2 short paragraphs.",
          "First say what was completed or what happened in plain language.",
          "If helpful, end with one short follow-up offer or one practical next step.",
          "Never mention internal tools, JSON, models, routes, or APIs."
        ].join(" "),
        userPrompt: [
          `User request: ${input}`,
          "",
          "Execution summary:",
          summary
        ].join("\n")
      });
    } catch (_error) {
      return fallback;
    }
  }

  async handleScreenAcademic(input) {
    const capture = await this.screen.captureAndOcr();
    const reply = await this.replyWithModel(
      input,
      [
        "The following text came from OCR on the user's current screen.",
        "Act as an academic and workplace advisor.",
        "If the OCR looks like a math, science, humanities, or writing task, explain the likely context and help the user move forward.",
        `OCR:\n${capture.text || "(No readable text was detected on screen.)"}`
      ].join("\n\n")
    );

    return {
      reply,
      actions: [
        this.makeAction("screen_capture", capture.imagePath),
        this.makeAction("screen_ocr", `chars:${capture.text.length}`),
        this.makeAction("academic_assist", "screen")
      ],
      provider: "ollama",
      details: {
        ocrText: capture.text,
        imagePath: capture.imagePath
      }
    };
  }

  async handleScreenSummary(input) {
    const capture = await this.screen.captureAndOcr();
    const reply = await this.replyWithModel(
      input,
      [
        "Summarize what is visible on the screen using the OCR below.",
        "If the OCR is noisy, say so and still extract the likely meaning.",
        `OCR:\n${capture.text || "(No readable text was detected on screen.)"}`
      ].join("\n\n")
    );

    return {
      reply,
      actions: [
        this.makeAction("screen_capture", capture.imagePath),
        this.makeAction("screen_ocr", `chars:${capture.text.length}`)
      ],
      provider: "ollama",
      details: {
        ocrText: capture.text,
        imagePath: capture.imagePath
      }
    };
  }

  async handleBrowser(input) {
    const plan = await this.planBrowserTask(input);
    const data = await this.browser.executePlan(plan.steps);
    const finalPage = data.final || {};
    const actionNames = data.steps.map((step) => step.action).join(" -> ");
    const fallback = buildCompactBrowserReply(input, data.steps, finalPage);

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions: data.steps.map((step) =>
            this.makeAction(
              `browser_${step.action}`,
              step.target || step.text || step.query || `result-${step.index || 1}`
            )
          ),
          details: {
            title: finalPage.title || "",
            url: finalPage.url || "",
            executedSteps: data.steps.map((step) => ({
              action: step.action,
              target: step.target || step.text || step.query || step.index || "",
              url: step.result?.url || ""
            })),
            actionNames
          }
        },
        fallback
      ),
      actions: data.steps.map((step) =>
        this.makeAction(
          `browser_${step.action}`,
          step.target || step.text || step.query || `result-${step.index || 1}`
        )
      ),
      provider: "local",
      details: {
        title: finalPage.title || "",
        url: finalPage.url || "",
        executedSteps: data.steps.map((step) => ({
          action: step.action,
          target: step.target || step.text || step.query || step.index || "",
          url: step.result?.url || ""
        }))
      }
    };
  }

  async handleBrowserLogin(input, route) {
    const siteOrUrl = route.siteOrUrl || extractUrl(input) || stripCommandPrefix(input);
    const data = await this.browser.loginWithStoredCredential(siteOrUrl);
    const fallback = detectReplyLanguage(input) === "ko"
      ? `${data.site} 로그인 정보를 입력했어요.`
      : `I filled in the saved login for ${data.site}.`;

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions: [this.makeAction("browser_login", data.site)],
          details: data
        },
        fallback
      ),
      actions: [this.makeAction("browser_login", data.site)],
      provider: "local",
      details: data
    };
  }

  async handleObsRoute(input, route) {
    let data;
    let action;

    if (route.route === "obs_connect") {
      data = await this.obs.connect();
      action = this.makeAction("obs_connect", data.address);
    } else if (route.route === "obs_start") {
      data = await this.obs.startStream();
      action = this.makeAction("obs_start_stream", data.currentScene);
    } else if (route.route === "obs_stop") {
      data = await this.obs.stopStream();
      action = this.makeAction("obs_stop_stream", data.currentScene);
    } else if (route.route === "obs_scene") {
      if (!route.sceneName) {
        throw new Error("A scene name is required.");
      }

      data = await this.obs.switchScene(route.sceneName);
      action = this.makeAction("obs_scene", route.sceneName);
    } else {
      data = await this.obs.status();
      action = this.makeAction("obs_status", data.currentScene);
    }

    const fallback = detectReplyLanguage(input) === "ko" ? "OBS 처리했어요." : "I handled OBS.";

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions: [action],
          details: data
        },
        fallback
      ),
      actions: [action],
      provider: "local",
      details: data
    };
  }

  async handleFileRoute(input, route) {
    if (route.route === "file_write") {
      if (!route.path) {
        throw new Error("A file path is required.");
      }

      const data = await this.files.writeFile(route.path, route.content || "");
      const fallback = detectReplyLanguage(input) === "ko"
        ? `${data.path}에 저장했어요.`
        : `I saved that to ${data.path}.`;

      return {
        reply: await this.polishCommandReply(
          input,
          {
            actions: [this.makeAction("file_write", data.path)],
            details: data
          },
          fallback
        ),
        actions: [this.makeAction("file_write", data.path)],
        provider: "local",
        details: data
      };
    }

    if (route.route === "file_read") {
      if (!route.path) {
        throw new Error("A file path is required.");
      }

      const data = await this.files.readFile(route.path);
      const reply = await this.replyWithModel(
        input,
        `The user asked about a file. Here is its content:\n\n${data.content.slice(0, 12000)}`
      ).catch(() =>
        detectReplyLanguage(input) === "ko"
          ? `${data.path} 파일 내용을 읽어왔어요. 필요한 부분을 설명하거나 수정안도 도와드릴게요.`
          : `I read ${data.path}. I can explain it or suggest edits if you want.`
      );

      return {
        reply,
        actions: [this.makeAction("file_read", data.path)],
        provider: "ollama",
        details: data
      };
    }

    const data = await this.files.listDirectory(route.path || ".");
    const fallback = detectReplyLanguage(input) === "ko"
      ? `${data.path} 목록을 읽었어요.`
      : `I listed ${data.path}.`;

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions: [this.makeAction("file_list", data.path)],
          details: data
        },
        fallback
      ),
      actions: [this.makeAction("file_list", data.path)],
      provider: "local",
      details: data
    };
  }

  async handleStreamPrep(input) {
    const actions = [];

    const obsOpen = await this.automation.execute({
      type: "open_app",
      target: "OBS"
    });
    actions.push(this.makeAction("open_app", obsOpen.resolvedTarget || obsOpen.appName || "OBS"));
    this.rememberAppContext(obsOpen.resolvedTarget || obsOpen.appName || "OBS");

    const steamOpen = await this.automation.execute({
      type: "open_app",
      target: "Steam"
    });
    actions.push(this.makeAction("open_app", steamOpen.resolvedTarget || steamOpen.appName || "Steam"));

    await this.automation.execute({
      type: "open_url",
      target: "https://www.twitch.tv/"
    });
    actions.push(this.makeAction("open_url", "https://www.twitch.tv/"));

    let obsStatus = null;

    try {
      obsStatus = await this.obs.status();
      actions.push(this.makeAction("obs_status", obsStatus.currentScene));
    } catch (_error) {
      actions.push(this.makeAction("obs_status", "not-connected", "skipped"));
    }

    const fallback = detectReplyLanguage(input) === "ko"
      ? "스트리밍 준비를 시작했어요."
      : "I started the stream setup.";

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions,
          details: {
            obsStatus
          }
        },
        fallback
      ),
      actions,
      provider: "local",
      details: {
        obsStatus
      }
    };
  }

  async handleSpotifyRoute(input, route) {
    return this.handleSpotifySkill(input, route, "Spotify");
  }

  async handleAppOpen(input, route) {
    const requestedApp = route.appName || extractAppName(input);

    if (!requestedApp) {
      throw new Error("I could not tell which app you wanted to open.");
    }

    const data = await this.automation.execute({
      type: "open_app",
      target: requestedApp
    });
    const openedName = data.resolvedTarget || data.appName || requestedApp;
    this.rememberAppContext(openedName);
    const fallback = detectReplyLanguage(input) === "ko"
      ? `${openedName} 열었어요.`
      : `I opened ${openedName}.`;

    return {
      reply: await this.polishCommandReply(
        input,
        {
          actions: [this.makeAction("open_app", openedName)],
          details: data
        },
        fallback
      ),
      actions: [this.makeAction("open_app", openedName)],
      provider: "local",
      details: data
    };
  }

  async handleGeneral(input) {
    const language = detectReplyLanguage(input);
    let reply = "";
    let provider = "local-chat";

    try {
      reply = await this.replyWithModel(
        input,
        [
          "Follow the conversation naturally.",
          `Reply only in ${buildLanguageName(language)}.`,
          "Sound like Jarvis as a modern everyday assistant: calm, polished, warm, and capable.",
          "Keep the Iron Man flavor subtle and workplace-friendly, not theatrical.",
          "If the user is chatting casually, answer like a strong general chatbot.",
          "If the user asks for recommendations, suggest two or three concrete options when useful.",
          "If the user greets you, greet them back naturally and invite the next request.",
          "Do not sound like a status banner or system message."
        ].join("\n")
      );
      provider = "ollama";
    } catch (_error) {
      reply = buildLocalChatReply(input, this.getRecentHistory());
    }

    return {
      reply,
      actions: [],
      provider
    };
  }

  async handleInput(input) {
    const cleanInput = normalizeWhitespace(input);

    if (!cleanInput) {
      return {
        reply:
          detectReplyLanguage(input) === "ko"
            ? "말씀해주시면 바로 도와드릴게요."
            : "Tell me what you want, and I will help right away.",
        actions: [],
        provider: "local",
        language: detectReplyLanguage(input)
      };
    }

    if (this.pendingWorkspaceMessage && looksLikeFreshWorkspaceCommand(cleanInput)) {
      this.pendingWorkspaceMessage = null;
    }

    const pendingWorkspaceResult = await this.continuePendingWorkspaceMessage(cleanInput);

    if (pendingWorkspaceResult) {
      pendingWorkspaceResult.language = detectReplyLanguage(cleanInput);
      this.rememberTurn("user", cleanInput);
      this.rememberTurn("assistant", pendingWorkspaceResult.reply);
      return pendingWorkspaceResult;
    }

    let route = await this.routeInput(cleanInput);

    if (
      route.route === "chat" &&
      looksLikeAppAction(cleanInput) &&
      this.lastActiveApp
    ) {
      route = {
        ...route,
        route: "app_action",
        appName: this.lastActiveApp
      };
    }

    let result;

    try {
      switch (route.route) {
        case "screen_academic":
          result = await this.handleScreenAcademic(cleanInput);
          break;
        case "screen_summary":
          result = await this.handleScreenSummary(cleanInput);
          break;
        case "browser_login":
          result = await this.handleBrowserLogin(cleanInput, route);
          break;
        case "browser":
          result = await this.handleBrowser(cleanInput, route);
          break;
        case "obs_connect":
        case "obs_status":
        case "obs_start":
        case "obs_stop":
        case "obs_scene":
          result = await this.handleObsRoute(cleanInput, route);
          break;
        case "file_read":
        case "file_write":
        case "file_list":
          result = await this.handleFileRoute(cleanInput, route);
          break;
        case "stream_prep":
          result = await this.handleStreamPrep(cleanInput);
          break;
        case "app_open":
          result = await this.handleAppOpen(cleanInput, route);
          break;
        case "app_list":
          result = await this.handleAppList(cleanInput);
          break;
        case "app_action":
          result = await this.handleAppAction(cleanInput, route);
          break;
        case "spotify_play":
          result = await this.handleSpotifyRoute(cleanInput, route);
          break;
        case "chat":
        default:
          result = await this.handleGeneral(cleanInput);
          break;
      }
    } catch (error) {
      result = {
        reply:
          detectReplyLanguage(cleanInput) === "ko"
            ? `처리 중에 문제가 있었어요: ${error.message}`
            : `I ran into a problem while handling that: ${error.message}`,
        actions: [],
        provider: "local-error"
      };
    }

    result.language = route.language || detectReplyLanguage(cleanInput);
    this.rememberTurn("user", cleanInput);
    this.rememberTurn("assistant", result.reply);
    return result;
  }
}

module.exports = {
  AssistantService,
  extractAppName,
  buildRouteFallback
};
