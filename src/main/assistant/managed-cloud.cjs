const { normalizeReplySource } = require("./reply-source.cjs");
const DEFAULT_CLOUD_BASE = "https://jarvis-auth-service.dexproject.workers.dev";

function cloudEndpoint(baseUrl) {
  const url = new URL(baseUrl);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid Jarvis Cloud address.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") + "/api/ai/chat";
  return url;
}

function createManagedCloudChat({
  enabled = process.env.JARVIS_ENABLE_CLOUD_AI_FALLBACK?.trim() === "1",
  baseUrl = process.env.JARVIS_CLOUD_API_BASE?.trim() || DEFAULT_CLOUD_BASE
} = {}) {
  return async ({ token, input, history, language, memoryMode }) => {
    if (!enabled || !token || memoryMode === "temporary") return null;

    const ko = language === "ko";
    const result = (reply, provider) => ({ reply, provider, actions: [], language });
    const failure = (korean, english) => result(ko ? korean : english, "jarvis-cloud-error");
    const unavailable = () => failure(
      "클라우드에서 답변을 받지 못했습니다. 잠시 후 다시 시도하거나 모델 설정에서 연결을 확인하세요.",
      "Jarvis Cloud did not respond. Try again or check the connection in Model settings."
    );

    const messages = history
      .filter(({ role, content }) => (role === "user" || role === "assistant") &&
        typeof content === "string" && content.trim())
      .slice(-10)
      .map(({ role, content }) => ({ role, content }));
    messages.push({ role: "user", content: input });

    try {
      // Use a single POST even on network failures.
      const response = await fetch(cloudEndpoint(baseUrl), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(35_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          messages,
          language,
          systemPrompt: ko
            ? "간결한 대화 비서 Jarvis로서 한국어로 답변하세요. 컴퓨터나 도구를 제어할 수 없으며 동작을 실행했다고 말하지 마세요."
            : "Answer in English as Jarvis, a concise conversation assistant. You cannot use tools or control the computer. Only describe actions you can explain; never claim to have performed them."
        })
      });
      if (response.status === 401) {
        return failure(
          "클라우드 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.",
          "Your Jarvis Cloud session expired. Sign in again."
        );
      }
      if (response.status === 429) {
        const data = await response.json().catch(() => null);
        if (data?.code === "plan_limit") {
          return failure(
            "클라우드 사용량 한도에 도달했습니다. 한도는 UTC 자정에 초기화됩니다.",
            "You reached your Jarvis Cloud daily limit. It resets at midnight UTC."
          );
        }
        return failure(
          "클라우드가 혼잡합니다. 잠시 후 다시 시도해 주세요.",
          "Jarvis Cloud is busy. Try again in a moment."
        );
      }
      if (!response.ok) return unavailable();

      const data = await response.json();
      const reply = typeof data?.reply === "string" ? data.reply.trim() : "";
      if (data?.success !== true || !reply) return unavailable();
      const model = typeof data.model === "string" && /^gemini-[a-z0-9][a-z0-9.-]{0,99}$/.test(data.model)
        ? data.model
        : "";
      return {
        ...result(reply, model ? `jarvis-cloud-${model}` : "jarvis-cloud"),
        responseSource: normalizeReplySource({ provider: "jarvis-cloud", model })
      };
    } catch {
      return unavailable();
    }
  };
}

module.exports = { createManagedCloudChat };
