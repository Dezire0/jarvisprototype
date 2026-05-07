const { MAX_AGENT_DEPTH } = require("../subagent-manager.cjs");

function normalizeText(value = "", limit = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeDepth(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.floor(numeric));
}

module.exports = [
  {
    name: "done",
    aliases: [],
    inputKeys: ["summary"],
    schema: '{"action":"done","summary":"..."}',
    description: "작업 완료 및 요약 제공",
    execute: async () => {
      return { state: null, error: null };
    }
  },
  {
    name: "sessions_spawn",
    aliases: ["session_spawn", "spawn_session"],
    inputKeys: ["task", "agentId", "depth"],
    schema: '{"action":{"tool":"sessions_spawn","input":{"task":"...","agentId":"researcher","depth":1}},"expectedOutcome":"...","isFinal":false}',
    description: `새 하위 에이전트 세션을 비동기로 생성합니다. depth는 0부터 시작하며 최대 ${MAX_AGENT_DEPTH}까지만 허용됩니다.`,
    execute: async (action, context = {}) => {
      const manager = context.subAgentManager;
      if (!manager || typeof manager.spawn !== "function") {
        return {
          state: null,
          error: "sessions_spawn is unavailable because no sub-agent manager is attached.",
          possible_fix: "Attach a SubAgentManager to BrowserAgentRuntime before attempting multi-agent orchestration."
        };
      }

      const task = normalizeText(action.input?.task || "", 1000);
      const agentId = normalizeText(action.input?.agentId || "subagent", 80) || "subagent";
      const nextDepth = normalizeDepth(
        action.input?.depth,
        normalizeDepth(context.runtimeDepth, 0) + 1
      );
      const language = context.language || "en";

      if (!task) {
        return {
          state: null,
          error: "sessions_spawn requires input.task.",
          possible_fix: "Provide a concrete delegated task for the sub-agent."
        };
      }

      return manager.spawn({
        task,
        agentId,
        depth: nextDepth,
        parentSessionId: context.currentSessionId || "",
        language
      });
    }
  },
  {
    name: "subagents",
    aliases: ["subagent_control"],
    inputKeys: ["action", "sessionId", "message"],
    schema: '{"action":{"tool":"subagents","input":{"action":"list","sessionId":"","message":""}},"expectedOutcome":"...","isFinal":false}',
    description: "실행 중인 하위 에이전트 상태를 조회하거나(list), steer 메시지를 보내거나, kill로 종료 요청을 보냅니다.",
    execute: async (action, context = {}) => {
      const manager = context.subAgentManager;
      if (!manager) {
        return {
          state: null,
          error: "subagents is unavailable because no sub-agent manager is attached.",
          possible_fix: "Attach a SubAgentManager to BrowserAgentRuntime before attempting subagent control."
        };
      }

      const operation = String(action.input?.action || "list").trim().toLowerCase();
      const sessionId = normalizeText(action.input?.sessionId || "", 120);
      const message = normalizeText(action.input?.message || "", 600);

      if (operation === "list") {
        return {
          state: {
            subagents: manager.list(sessionId)
          },
          error: null
        };
      }

      if (operation === "steer") {
        return manager.steer(sessionId, message);
      }

      if (operation === "kill") {
        return manager.kill(sessionId);
      }

      return {
        state: null,
        error: `Unsupported subagents action: ${operation || "(missing action)"}.`,
        possible_fix: "Use one of: list, steer, kill."
      };
    }
  }
];
