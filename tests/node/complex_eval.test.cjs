const test = require("node:test");
const assert = require("node:assert/strict");
const { SkillRegistry } = require("../../src/main/skills/skill-registry.cjs");
// Note: SkillRegistry might be an instance, let's check
const registry = require("../../src/main/skills/skill-registry.cjs");
const { BrowserAgentRuntime, parseStructuredBrowserAgentDecision } = require("../../src/main/browser-agent-runtime.cjs");

test("Complex App Evaluation: Skill Registry and Runtime Prompt Integrity", async (t) => {
  await t.test("Prompt connectivity: Modular skills are included in system prompt", () => {
    const runtime = new BrowserAgentRuntime({
      skillRegistry: registry,
      toolProfile: "full_access"
    });
    
    const systemPrompt = runtime.systemPrompt;
    assert.ok(systemPrompt.includes("=== Modular Skills & Extra Capabilities ==="), "System prompt should include modular skills header");
    assert.ok(systemPrompt.includes("navigate"), "Should include navigate schema");
    assert.ok(systemPrompt.includes("os_type"), "Should include os_type schema");
  });

  await t.test("JSON Disruption Check: Action field handling", async () => {
    const runtime = new BrowserAgentRuntime({
      skillRegistry: registry,
      toolProfile: "full_access",
      // Mock chat client
      chatClient: async () => JSON.stringify({
        thought: "I need to open Google.",
        action: {
          tool: "browser.open",
          input: { url: "https://www.google.com" }
        },
        expectedOutcome: "Google is opened",
        isFinal: false,
        finalMessage: null
      })
    });

    // Test parsing
    const decision = parseStructuredBrowserAgentDecision(await runtime.chatClient());
    assert.equal(decision.action.tool, "browser.open");
    assert.equal(decision.action.input.url, "https://www.google.com");
  });

  await t.test("Orchestration: SkillRegistry execution via Runtime", async () => {
    let skillExecuted = false;
    // Mock SkillRegistry to track execution
    const mockRegistry = {
      getAllSchemas: () => ["mock_skill"],
      get: (name) => name === "navigate" ? {} : null,
      execute: async (action, context) => {
        if (action.action === "navigate") {
          skillExecuted = true;
          return { state: { url: action.url }, error: null };
        }
        return { state: null, error: "Unknown" };
      }
    };

    const runtime = new BrowserAgentRuntime({
      skillRegistry: mockRegistry,
      browser: {
        observe: async () => ({})
      }
    });

    const action = { tool: "browser.open", input: { url: "https://test.com" } };
    const result = await runtime.executeStructuredAction(action);
    
    assert.ok(skillExecuted, "Skill Registry should have been called for browser.open (mapped to navigate)");
    assert.equal(result.state.url, "https://test.com");
  });
});
