module.exports = [
  {
    name: "browser.open",
    aliases: ["navigate"],
    inputKeys: ["url"],
    schema: '{"action":{"tool":"browser.open","input":{"url":"https://..."}},"expectedOutcome":"...","isFinal":false}',
    description: "Playwright 브라우저를 특정 URL로 엽니다.",
    execute: async (action, { browser }) => {
      return { state: await browser.navigate(action.input.url), error: null };
    }
  },
  {
    name: "browser.click",
    aliases: ["click"],
    inputKeys: ["elementId", "element_id"],
    schema: '{"action":{"tool":"browser.click","input":{"elementId":"3"}},"expectedOutcome":"...","isFinal":false}',
    description: "관찰된 elementId를 기준으로 웹 요소를 클릭합니다.",
    execute: async (action, { browser }) => {
      return { state: await browser.clickElement(action.input.elementId), error: null };
    }
  },
  {
    name: "browser.type",
    aliases: ["type"],
    inputKeys: ["elementId", "element_id", "text"],
    schema: '{"action":{"tool":"browser.type","input":{"elementId":"5","text":"..."}},"expectedOutcome":"...","isFinal":false}',
    description: "관찰된 웹 요소에 텍스트를 입력합니다.",
    execute: async (action, { browser }) => {
      return { state: await browser.typeText(action.input.elementId, action.input.text), error: null };
    }
  },
  {
    name: "browser.keypress",
    aliases: ["press_key"],
    inputKeys: ["key"],
    schema: '{"action":{"tool":"browser.keypress","input":{"key":"Enter"}},"expectedOutcome":"...","isFinal":false}',
    description: "현재 브라우저 포커스에 키 입력을 보냅니다.",
    execute: async (action, { browser }) => {
      return { state: await browser.pressKey(action.input.key || "Enter"), error: null };
    }
  },
  {
    name: "browser.scroll",
    aliases: ["scroll"],
    inputKeys: ["direction"],
    schema: '{"action":{"tool":"browser.scroll","input":{"direction":"down"}},"expectedOutcome":"...","isFinal":false}',
    description: "현재 페이지를 위나 아래로 스크롤합니다.",
    execute: async (action, { browser }) => {
      return { state: await browser.scrollPage(action.input.direction || "down"), error: null };
    }
  },
  {
    name: "browser.wait_for",
    aliases: ["wait"],
    inputKeys: ["ms"],
    schema: '{"action":{"tool":"browser.wait_for","input":{"ms":2000}},"expectedOutcome":"...","isFinal":false}',
    description: "짧게 대기한 뒤 현재 페이지를 다시 관찰합니다.",
    execute: async (action, { browser }) => {
      const waitMs = Number.isFinite(Number(action.input.ms)) ? Number(action.input.ms) : 2000;
      return { state: await browser.waitAndObserve(waitMs), error: null };
    }
  },
  {
    name: "browser.observe",
    inputKeys: [],
    schema: '{"action":{"tool":"browser.observe","input":{}},"expectedOutcome":"...","isFinal":false}',
    description: "현재 브라우저 상태를 다시 관찰합니다.",
    execute: async (_action, { browser }) => {
      return { state: await browser.observe(), error: null };
    }
  },
  {
    name: "browser.extract",
    aliases: ["browser_extract"],
    inputKeys: ["target"],
    schema: '{"action":{"tool":"browser.extract","input":{"target":"..."}},"expectedOutcome":"...","isFinal":false}',
    description: "현재 화면의 관련 텍스트를 다시 관찰해 추출에 활용합니다.",
    execute: async (_action, { browser }) => {
      return { state: await browser.observe(), error: null, extracted: true };
    }
  }
];
