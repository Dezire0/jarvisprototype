const VALID_PLANS = new Set(["free", "pro"]);

function isKnownPlan(plan) {
  return VALID_PLANS.has(String(plan || "").trim());
}

function resolveFreshAuthStep(user) {
  return isKnownPlan(user?.plan) ? "setup" : "auth";
}

function resolveRestoredSessionStep(user) {
  if (!isKnownPlan(user?.plan)) {
    return "auth";
  }

  return user?.settings?.planConfirmed ? "ready" : "setup";
}

function selectInitialPlan(user) {
  return user?.plan === "pro" ? "pro" : "free";
}

function markPlanConfirmed(user, plan) {
  return {
    ...user,
    plan,
    settings: {
      ...(user?.settings || {}),
      planConfirmed: true
    }
  };
}

module.exports = {
  isKnownPlan,
  markPlanConfirmed,
  resolveFreshAuthStep,
  resolveRestoredSessionStep,
  selectInitialPlan
};
