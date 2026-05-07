function buildModelConnectionReply(text = "", detectLanguageCode) {
  return detectLanguageCode(text) === "ko"
    ? "대화 모델이 아직 연결되어 있지 않아요. 왼쪽 위의 AI 모델 관리에서 GPT/Gemini API 키를 저장하거나, GPT/Codex CLI 또는 Gemini CLI로 로그인하거나, Ollama 로컬 모델을 선택해 주세요."
    : "No conversation model is connected yet. Open AI Model Management in the upper-left and save a GPT/Gemini API key, sign in with GPT/Codex CLI or Gemini CLI, or choose an Ollama local model.";
}

function buildModelFailureReply(text = "", error, config = {}, detectLanguageCode) {
  const message = String(error?.message || error || "").trim();
  const isKo = detectLanguageCode(text) === "ko";
  const providerLabel = config.provider === "gemini"
    ? "Gemini"
    : config.provider === "gemini-cli"
      ? "Gemini CLI"
      : config.provider === "groq"
        ? "Groq"
        : config.provider === "openai-cli"
          ? "GPT/Codex CLI"
          : config.provider === "openai-compatible"
            ? "GPT/OpenAI"
            : "로컬 모델";
  const modelLabel = config.model ? ` ${config.model}` : "";

  if (config.provider === "gemini" && /high demand|try again later|overloaded|temporar/i.test(message)) {
    return isKo
      ? `Gemini${modelLabel} 모델이 지금 요청이 많아서 일시적으로 응답하지 못하고 있어요. API 키나 저장 설정 문제는 아니고, Google 쪽 모델 수요/용량 문제에 가깝습니다. 잠시 뒤 다시 시도하거나 AI 모델 관리에서 Gemini 3 Flash Preview, Gemini 2.5 Pro, 또는 다른 연결 모델로 바꿔 주세요.`
      : `Gemini${modelLabel} is temporarily unable to respond because the model is under high demand. This is not an API key or saved-settings issue. Please try again later or switch to Gemini 3 Flash Preview, Gemini 2.5 Pro, or another connected model in AI Model Management.`;
  }

  if (config.provider === "openai-cli" || config.provider === "gemini-cli") {
    const label = config.provider === "openai-cli" ? "GPT/Codex CLI" : "Gemini CLI";
    const loginHintKo = config.provider === "openai-cli"
      ? "`codex login` 또는 Codex 확장/CLI 로그인"
      : "`gemini` 실행 후 Google 로그인";
    const loginHintEn = config.provider === "openai-cli"
      ? "`codex login` or the Codex extension/CLI login"
      : "Google login after running `gemini`";
    return isKo
      ? `${label}${modelLabel} 연결 중 문제가 있었어요. 이 경로는 API 키가 아니라 로컬 CLI의 로그인 상태를 사용합니다. CLI가 설치되어 있고 ${loginHintKo}이 완료되어 있는지 확인해 주세요.\n\n${message}`
      : `${label}${modelLabel} ran into a connection problem. This path uses the local CLI login session instead of an API key. Check that the CLI is installed and signed in via ${loginHintEn}.\n\n${message}`;
  }

  return isKo
    ? `${providerLabel}${modelLabel} 연결 중 문제가 있었어요. AI 모델 관리에서 API 키와 모델 선택을 확인해 주세요.\n\n${message}`
    : `${providerLabel}${modelLabel} ran into a connection problem. Check the API key and selected model in AI Model Management.\n\n${message}`;
}

module.exports = {
  buildModelConnectionReply,
  buildModelFailureReply
};
