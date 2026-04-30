const piiManager = require("../pii-manager.cjs");

module.exports = [
  {
    name: "ask_pii",
    schema: '{"action":"ask_pii","field":"password","reason":"..."}',
    description: "비밀번호 등 민감한 정보는 추측하지 말고 사용자에게 요청",
    execute: async (action, { safeObserve }) => {
      const storedPii = piiManager.get(action.field);
      if (storedPii) {
        return { state: { ...(await safeObserve()), pii_retrieved: storedPii }, error: null };
      }
      return { state: await safeObserve(), error: `Missing PII for ${action.field}. Please ask user to set it.` };
    }
  }
];
