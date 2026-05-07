const DEFAULT_LANGUAGE = "en";

const MESSAGES = {
  en: {
    transport: {
      executorLabel: "OpenClaw Computer Use",
      authTitle: "Jarvis Login Complete",
      authHeading: "Jarvis login complete",
      authBody: "The session has been handed off to Jarvis Desktop. You can close this window."
    },
    progress: {
      login: [
        "OpenClaw is checking the current site and login context",
        "Using Playwright to find the login entry point",
        "Locating the username and password fields",
        "Re-checking the page after the form step"
      ],
      mailbox: [
        "OpenClaw is checking the current mailbox context",
        "Finding the most relevant message",
        "Re-checking the opened mail view"
      ],
      browser: [
        "OpenClaw is checking the current browser context",
        "Planning the next web action",
        "Using Playwright to find the element to click or type into",
        "Re-checking the result after execution"
      ],
      generic: [
        "OpenClaw is checking the current task context",
        "Planning the next action",
        "Re-checking the result after execution"
      ]
    },
    runtime: {
      stoppedKilled: "The sub-agent session stopped after receiving a kill request.",
      aiResponseError: "There was a problem with the AI response during the browser task.",
      invalidJsonStop: "I stopped because the browser agent kept failing to return a valid JSON plan. {error}",
      invalidPlanStop: "I stopped because the browser agent kept producing invalid tool plans. {error}",
      repeatedActionStop: "I stopped because the same tool action kept repeating without progress.",
      sensitiveConfirmation: "This looks like a sensitive final action, so I need confirmation before I perform it.",
      pingPongStop: "I stopped because the agent was bouncing between the same actions without making progress.",
      noProgressStop: "I stopped because the same action kept producing the same outcome without progress.",
      taskFailureStop: "I stopped because the browser task kept failing. {error}",
      stepLimitStop: "I stopped because the browser task hit its step limit."
    }
  },
  ko: {
    transport: {
      executorLabel: "OpenClaw Computer Use",
      authTitle: "Jarvis 로그인 완료",
      authHeading: "Jarvis 로그인 완료",
      authBody: "세션을 Jarvis Desktop으로 전달했습니다. 이 창은 닫아도 됩니다."
    },
    progress: {
      login: [
        "OpenClaw 세션이 현재 사이트와 로그인 문맥을 확인하는 중",
        "Playwright로 로그인 진입점을 찾는 중",
        "아이디와 비밀번호 입력 칸을 찾는 중",
        "입력 후 화면 상태를 다시 확인하는 중"
      ],
      mailbox: [
        "OpenClaw 세션이 현재 메일함 문맥을 확인하는 중",
        "가장 관련 있는 메시지를 찾는 중",
        "열린 메일 화면을 다시 확인하는 중"
      ],
      browser: [
        "OpenClaw 세션이 현재 브라우저 문맥을 확인하는 중",
        "다음 웹 동작을 계획하는 중",
        "Playwright로 클릭하거나 입력할 요소를 찾는 중",
        "실행 결과를 다시 확인하는 중"
      ],
      generic: [
        "OpenClaw 세션이 현재 작업 문맥을 확인하는 중",
        "다음 동작을 계획하는 중",
        "실행 결과를 다시 확인하는 중"
      ]
    },
    runtime: {
      stoppedKilled: "하위 에이전트 세션이 중단 요청을 받아 안전하게 멈췄어요.",
      aiResponseError: "브라우저 작업 중 AI 응답에 문제가 있었어요.",
      invalidJsonStop: "브라우저 에이전트가 유효한 JSON 계획을 계속 만들지 못해서 중단했어요. {error}",
      invalidPlanStop: "브라우저 에이전트 계획을 검증하는 중 문제가 반복되어 중단했어요. {error}",
      repeatedActionStop: "같은 도구 행동이 반복되어 더 진행하지 않고 멈췄어요.",
      sensitiveConfirmation: "이 동작은 결제, 구매, 구독처럼 민감한 최종 행동으로 보여서 실행 직전에 확인이 필요해요.",
      pingPongStop: "두 가지 행동 사이를 오가며 같은 결과만 반복해서 여기서 멈췄어요.",
      noProgressStop: "같은 행동이 같은 결과만 반복되어 진행이 없어서 여기서 멈췄어요.",
      taskFailureStop: "브라우저 작업을 계속 진행하기 어려워서 멈췄어요. {error}",
      stepLimitStop: "브라우저 작업 단계 한도에 도달해서 여기서 멈췄어요."
    }
  }
};

function normalizeLanguage(language = DEFAULT_LANGUAGE) {
  return String(language || "").trim().toLowerCase().startsWith("ko") ? "ko" : DEFAULT_LANGUAGE;
}

function getPathValue(target, key = "") {
  return String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), target);
}

function interpolate(template, params = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? ""));
}

function message(language, key, params = {}) {
  const lang = normalizeLanguage(language);
  const localized = getPathValue(MESSAGES[lang], key);
  const fallback = getPathValue(MESSAGES[DEFAULT_LANGUAGE], key);
  const resolved = localized ?? fallback;

  if (Array.isArray(resolved)) {
    return resolved.map((entry) => interpolate(entry, params));
  }

  return interpolate(resolved ?? key, params);
}

module.exports = {
  DEFAULT_LANGUAGE,
  MESSAGES,
  message,
  normalizeLanguage
};
