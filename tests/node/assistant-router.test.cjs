const test = require("node:test");
const assert = require("node:assert/strict");

const { routeInputWithLlm } = require("../../src/main/assistant/router.cjs");

test("routeInputWithLlm falls back when the model output is not valid JSON", async () => {
  const service = {
    automation: {
      async listInstalledApps() {
        return { apps: [{ name: "Google Chrome" }] };
      }
    },
    buildHistorySnippet() {
      return "recent history";
    }
  };
  const fallback = {
    route: "browser",
    language: "ko"
  };

  const result = await routeInputWithLlm(service, "구글 열어줘", fallback, {
    async chat() {
      return "not-json";
    },
    chooseAutomationReasoningTier() {
      return "fast";
    },
    shouldUseFallbackRouteDirectly() {
      return false;
    }
  });

  assert.deepEqual(result, fallback);
});

test("routeInputWithLlm merges structured parser output over fallback safely", async () => {
  const service = {
    automation: {
      async listInstalledApps() {
        return { apps: [] };
      }
    },
    buildHistorySnippet() {
      return "";
    }
  };
  const fallback = {
    route: "browser",
    language: "en",
    requires_automation: false
  };

  const result = await routeInputWithLlm(service, "open amazon and login", fallback, {
    async chat() {
      return JSON.stringify({
        route: "browser_login",
        language: "en",
        siteOrUrl: "amazon.com",
        requires_automation: true
      });
    },
    chooseAutomationReasoningTier() {
      return "complex";
    },
    shouldUseFallbackRouteDirectly() {
      return false;
    }
  });

  assert.equal(result.route, "browser_login");
  assert.equal(result.language, "en");
  assert.equal(result.requires_automation, true);
});
