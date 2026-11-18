const { chat, resolveConfig, isDirectConversationConfigured } = require("./ollama-service.cjs");

function getSavedModelAvailability(computerControlEnabled) {
  const tiers = ["fast", "complex"].map((tier) => {
    const config = resolveConfig({ tier });
    if (config.provider.endsWith("-cli")) {
      return computerControlEnabled ? "configured" : "computer-control";
    }
    return isDirectConversationConfigured(config, tier) ? "configured" : "missing";
  });

  if (tiers.every((tier) => tier === "configured")) return "configured";
  if (tiers.includes("configured")) return "partial";
  return tiers.includes("computer-control") ? "computer-control" : "missing";
}

async function testSavedModelConnection({ signal = AbortSignal.timeout(12000) } = {}) {
  const config = resolveConfig();
  const { provider, model } = config;
  if (provider.endsWith("-cli") || provider === "claude-code") {
    return { status: "cli", provider, model };
  }
  if (!isDirectConversationConfigured(config)) {
    return { status: "missing", provider, model };
  }

  try {
    await chat({
      ...config,
      exactModel: true,
      systemPrompt: "This is a connection check. Reply with one word: Ready.",
      userPrompt: "Ready?",
      signal,
    });
    return { status: "responded", provider, model };
  } catch {
    return { status: signal.aborted ? "timeout" : "failed", provider, model };
  }
}

module.exports = { getSavedModelAvailability, testSavedModelConnection };
