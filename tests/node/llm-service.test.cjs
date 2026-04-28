const test = require("node:test");
const assert = require("node:assert/strict");

const MODULE_PATH = require.resolve("../../src/main/ollama-service.cjs");
const MANAGED_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_LLM_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_LLM_MODEL",
  "CLAUDE_API_KEY",
  "CLAUDE_LLM_MODEL",
  "JARVIS_FAST_LLM_PROVIDER",
  "JARVIS_FAST_LLM_MODEL",
  "JARVIS_FAST_ROUTER_MODEL",
  "JARVIS_FAST_PLANNER_MODEL",
  "JARVIS_COMPLEX_LLM_PROVIDER",
  "JARVIS_COMPLEX_LLM_MODEL",
  "JARVIS_COMPLEX_LLM_URL",
  "JARVIS_COMPLEX_LLM_API_KEY",
  "JARVIS_MODEL",
  "JARVIS_CHAT_MODEL",
  "JARVIS_ROUTER_MODEL",
  "JARVIS_PLANNER_MODEL",
  "OLLAMA_URL"
];

function withFreshLlmModule(envPatch, callback) {
  const backup = new Map();

  for (const key of MANAGED_ENV_KEYS) {
    backup.set(key, process.env[key]);
    delete process.env[key];
  }

  Object.assign(process.env, envPatch);
  delete require.cache[MODULE_PATH];

  try {
    return callback(require(MODULE_PATH));
  } finally {
    delete require.cache[MODULE_PATH];

    for (const key of MANAGED_ENV_KEYS) {
      const original = backup.get(key);

      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  }
}

test("llm service auto mode prefers Gemini when a Gemini key is configured", () => {
  withFreshLlmModule(
    {
      JARVIS_FAST_LLM_PROVIDER: "auto",
      JARVIS_COMPLEX_LLM_PROVIDER: "auto",
      GEMINI_API_KEY: "gemini-test-key"
    },
    (service) => {
      assert.equal(service.resolveConfig({ tier: "fast" }).provider, "gemini");
      assert.equal(service.resolveConfig({ tier: "complex" }).provider, "gemini");
      assert.equal(service.getTierProviderLabel("complex"), "gemini:gemini-2.5-flash");
    }
  );
});

test("llm service auto mode uses OpenAI-compatible defaults when only OpenAI config is present", () => {
  withFreshLlmModule(
    {
      JARVIS_FAST_LLM_PROVIDER: "auto",
      JARVIS_COMPLEX_LLM_PROVIDER: "auto",
      OPENAI_API_KEY: "sk-test-key",
      OPENAI_BASE_URL: "http://127.0.0.1:1234/v1"
    },
    (service) => {
      const fast = service.resolveConfig({ tier: "fast" });
      const complex = service.resolveConfig({ tier: "complex" });

      assert.equal(fast.provider, "openai-compatible");
      assert.equal(complex.provider, "openai-compatible");
      assert.equal(complex.model, "gpt-4o-mini");
      assert.equal(complex.url, "http://127.0.0.1:1234/v1/chat/completions");
      assert.equal(complex.apiKey, "sk-test-key");
    }
  );
});

test("llm service auto mode falls back to Ollama when no remote provider is configured", () => {
  withFreshLlmModule(
    {
      JARVIS_FAST_LLM_PROVIDER: "auto",
      JARVIS_COMPLEX_LLM_PROVIDER: "auto",
      JARVIS_MODEL: "qwen3:14b",
      OLLAMA_URL: "http://127.0.0.1:11434/api/chat"
    },
    (service) => {
      const complex = service.resolveConfig({ tier: "complex" });

      assert.equal(complex.provider, "ollama");
      assert.equal(complex.model, "qwen3:14b");
      assert.equal(complex.url, "http://127.0.0.1:11434/api/chat");
      assert.equal(service.isUnconfiguredAutoFallback({ tier: "complex" }), true);
    }
  );
});

test("llm service does not treat explicitly selected Ollama as an unconfigured fallback", () => {
  withFreshLlmModule(
    {
      JARVIS_FAST_LLM_PROVIDER: "ollama",
      JARVIS_COMPLEX_LLM_PROVIDER: "ollama"
    },
    (service) => {
      assert.equal(service.resolveConfig({ tier: "complex" }).provider, "ollama");
      assert.equal(service.isUnconfiguredAutoFallback({ tier: "complex" }), false);
    }
  );
});

test("llm service uses saved Claude settings when selected", () => {
  withFreshLlmModule({}, (service) => {
    service.setExternalLlmSettingsProvider(() => ({
      provider: "anthropic",
      anthropic: {
        apiKey: "claude-test-key",
        model: "claude-test-model",
        baseUrl: "https://api.anthropic.com/v1/messages"
      }
    }));

    const config = service.resolveConfig({ tier: "complex" });

    assert.equal(config.provider, "anthropic");
    assert.equal(config.model, "claude-test-model");
    assert.equal(config.apiKey, "claude-test-key");
    assert.equal(config.url, "https://api.anthropic.com/v1/messages");
  });
});

test("llm service resolves Claude Code provider using the shared Claude model selection", () => {
  withFreshLlmModule({}, (service) => {
    service.setExternalLlmSettingsProvider(() => ({
      provider: "claude-code",
      anthropic: {
        model: "claude-sonnet-4-6"
      }
    }));

    const config = service.resolveConfig({ tier: "complex" });

    assert.equal(config.provider, "claude-code");
    assert.equal(config.model, "claude-sonnet-4-6");
    assert.equal(config.apiKey, "");
    assert.equal(config.url, "");
  });
});

test("llm service resolves OpenAI CLI provider without requiring an API key", () => {
  withFreshLlmModule({}, (service) => {
    service.setExternalLlmSettingsProvider(() => ({
      provider: "openai-cli",
      openai: {
        model: "gpt-4o-mini"
      }
    }));

    const config = service.resolveConfig({ tier: "complex" });

    assert.equal(config.provider, "openai-cli");
    assert.equal(config.model, "gpt-4o-mini");
    assert.equal(config.apiKey, "");
    assert.equal(config.url, "");
  });
});

test("llm service resolves Gemini CLI provider without requiring an API key", () => {
  withFreshLlmModule({}, (service) => {
    service.setExternalLlmSettingsProvider(() => ({
      provider: "gemini-cli",
      gemini: {
        model: "gemini-2.5-flash"
      }
    }));

    const config = service.resolveConfig({ tier: "complex" });

    assert.equal(config.provider, "gemini-cli");
    assert.equal(config.model, "gemini-2.5-flash");
    assert.equal(config.apiKey, "");
    assert.equal(config.url, "");
  });
});
