module.exports = [
  {
    name: "navigate",
    schema: '{"action":"navigate","url":"https://..."}',
    description: "특정 URL로 이동 (Headless)",
    execute: async (action, { browser }) => {
      return { state: await browser.navigate(action.url), error: null };
    }
  },
  {
    name: "click",
    schema: '{"action":"click","element_id":3,"reason":"..."}',
    description: "ID를 기반으로 웹 요소 클릭",
    execute: async (action, { browser }) => {
      return { state: await browser.clickElement(action.element_id), error: null };
    }
  },
  {
    name: "type",
    schema: '{"action":"type","element_id":5,"text":"...","reason":"..."}',
    description: "웹 요소에 텍스트 입력",
    execute: async (action, { browser }) => {
      return { state: await browser.typeText(action.element_id, action.text), error: null };
    }
  },
  {
    name: "press_key",
    schema: '{"action":"press_key","key":"Enter","reason":"..."}',
    description: "키보드 키 입력",
    execute: async (action, { browser }) => {
      return { state: await browser.pressKey(action.key || "Enter"), error: null };
    }
  },
  {
    name: "scroll",
    schema: '{"action":"scroll","direction":"down","reason":"..."}',
    description: "페이지 스크롤",
    execute: async (action, { browser }) => {
      return { state: await browser.scrollPage(action.direction || "down"), error: null };
    }
  },
  {
    name: "wait",
    schema: '{"action":"wait","reason":"..."}',
    description: "페이지 로딩 대기",
    execute: async (action, { browser }) => {
      return { state: await browser.waitAndObserve(2000), error: null };
    }
  },
  {
    name: "browser_extract",
    schema: '{"action":"browser_extract","target":"...","reason":"..."}',
    description: "[신규] 화면 내의 특정 정보를 표나 요약 형태로 추출",
    execute: async (action, { browser }) => {
      // For now, it just returns the state so the LLM can see the text.
      return { state: await browser.observe(), error: null, extracted: true };
    }
  }
];
