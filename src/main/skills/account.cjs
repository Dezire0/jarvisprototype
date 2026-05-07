module.exports = [
  {
    name: "account_queue_add",
    aliases: ["account.queue_add"],
    inputKeys: ["accountId", "provider", "type", "priority", "url", "estimatedMinutesSaved", "authBlocked"],
    schema: '{"action":{"tool":"account_queue_add","input":{"accountId":"work-google","provider":"google","type":"mail-review","priority":80,"url":"https://mail.google.com"}},"expectedOutcome":"...","isFinal":false}',
    description: "단일 워커 계정 자동화 큐에 새 작업을 추가합니다.",
    execute: async (action, context = {}) => {
      if (!context.companion?.accountQueueAdd) {
        return {
          state: null,
          error: "account_queue_add is unavailable because the companion service is not attached."
        };
      }
      const result = await context.companion.accountQueueAdd(action.input || {});
      return {
        state: result.task || null,
        error: result.ok ? null : result.error || "Failed to add the account queue task."
      };
    }
  },
  {
    name: "account_queue_list",
    aliases: ["account.queue_list"],
    inputKeys: [],
    schema: '{"action":{"tool":"account_queue_list","input":{}},"expectedOutcome":"...","isFinal":false}',
    description: "현재 계정 자동화 큐 상태를 반환합니다.",
    execute: async (_action, context = {}) => {
      if (!context.companion?.accountQueueList) {
        return {
          state: null,
          error: "account_queue_list is unavailable because the companion service is not attached."
        };
      }
      const result = await context.companion.accountQueueList();
      return {
        state: result.queue || null,
        error: result.ok ? null : result.error || "Failed to read the account queue."
      };
    }
  },
  {
    name: "account_queue_cancel",
    aliases: ["account.queue_cancel"],
    inputKeys: ["taskId"],
    schema: '{"action":{"tool":"account_queue_cancel","input":{"taskId":"task-..."}},"expectedOutcome":"...","isFinal":false}',
    description: "기존 계정 자동화 큐 작업을 취소합니다.",
    execute: async (action, context = {}) => {
      if (!context.companion?.accountQueueCancel) {
        return {
          state: null,
          error: "account_queue_cancel is unavailable because the companion service is not attached."
        };
      }
      const result = await context.companion.accountQueueCancel(action.input || {});
      return {
        state: result.task || null,
        error: result.ok ? null : result.error || "Failed to cancel the account queue task."
      };
    }
  },
  {
    name: "account_switch",
    aliases: ["account.switch"],
    inputKeys: ["accountId", "provider"],
    schema: '{"action":{"tool":"account_switch","input":{"accountId":"work-google","provider":"google"}},"expectedOutcome":"...","isFinal":false}',
    description: "단일 워커가 다음 계정 문맥으로 안전하게 전환하도록 요청합니다.",
    execute: async (action, context = {}) => {
      if (!context.companion?.switchAccount) {
        return {
          state: null,
          error: "account_switch is unavailable because the companion service is not attached."
        };
      }
      const result = await context.companion.switchAccount(action.input || {});
      return {
        state: result.ok ? result : null,
        error: result.ok ? null : result.error || "Failed to switch accounts."
      };
    }
  }
];
