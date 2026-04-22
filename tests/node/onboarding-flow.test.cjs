const test = require("node:test");
const assert = require("node:assert/strict");

const {
  markPlanConfirmed,
  resolveFreshAuthStep,
  resolveRestoredSessionStep,
  selectInitialPlan,
} = require("../../Jarvis Ui/templates/cloud/lib/onboarding-flow.cjs");

test("fresh auth always moves known plans to setup first", () => {
  assert.equal(resolveFreshAuthStep({ plan: "free" }), "setup");
  assert.equal(resolveFreshAuthStep({ plan: "pro" }), "setup");
});

test("restored session only reaches ready after plan confirmation", () => {
  assert.equal(resolveRestoredSessionStep({ plan: "free" }), "setup");
  assert.equal(
    resolveRestoredSessionStep({
      plan: "free",
      settings: { planConfirmed: true },
    }),
    "ready",
  );
});

test("invalid restored sessions fall back to auth", () => {
  assert.equal(resolveRestoredSessionStep({}), "auth");
  assert.equal(resolveFreshAuthStep({}), "auth");
});

test("selectInitialPlan preserves paid users and defaults others to free", () => {
  assert.equal(selectInitialPlan({ plan: "pro" }), "pro");
  assert.equal(selectInitialPlan({ plan: "free" }), "free");
  assert.equal(selectInitialPlan({}), "free");
});

test("markPlanConfirmed stores the chosen plan and confirmation flag", () => {
  assert.deepEqual(
    markPlanConfirmed(
      {
        id: "user-1",
        email: "test@example.com",
        settings: {
          autoSync: true,
        },
      },
      "pro",
    ),
    {
      id: "user-1",
      email: "test@example.com",
      plan: "pro",
      settings: {
        autoSync: true,
        planConfirmed: true,
      },
    },
  );
});
