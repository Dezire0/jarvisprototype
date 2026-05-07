const piiManager = require("../pii-manager.cjs");

module.exports = [
  {
    name: "pii.get",
    aliases: ["ask_pii"],
    inputKeys: ["field"],
    schema: '{"action":{"tool":"pii.get","input":{"field":"password"}},"expectedOutcome":"...","isFinal":false}',
    description: "민감한 정보는 추측하지 않고 보안 저장소에서 조회합니다.",
    execute: async (action, { safeObserve }) => {
      const storedPii = piiManager.get(action.input.field);
      if (storedPii) {
        return { state: { ...(await safeObserve()), pii_retrieved: storedPii }, error: null };
      }
      return { state: await safeObserve(), error: `Missing PII for ${action.input.field}. Please ask user to set it.` };
    }
  }
];
