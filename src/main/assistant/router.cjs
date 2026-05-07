const { buildRouterPrompt, safeJsonParse } = require("./parser.cjs");

async function routeInputWithLlm(service, input, fallback, helpers = {}) {
  if (helpers.shouldUseFallbackRouteDirectly?.(input, fallback)) {
    return fallback;
  }

  const appCatalog = service.automation?.listInstalledApps
    ? await service.automation.listInstalledApps({ limit: 80 }).catch(() => ({ apps: [] }))
    : { apps: [] };
  const installedAppNames = Array.isArray(appCatalog?.apps)
    ? appCatalog.apps.map((app) => app.name).filter(Boolean).slice(0, 80)
    : [];
  const routerPrompt = buildRouterPrompt(installedAppNames);

  try {
    const routeTier = helpers.chooseAutomationReasoningTier(input, fallback);
    const raw = await helpers.chat({
      systemPrompt: routerPrompt,
      tier: routeTier,
      userPrompt: [
        "Recent conversation:",
        service.buildHistorySnippet(),
        "",
        "Weak local fallback route, for reference only. Prefer your own semantic judgment:",
        JSON.stringify(fallback),
        "",
        "Current user input:",
        input
      ].join("\n")
    });

    const parsed = safeJsonParse(raw);

    if (!parsed?.route) {
      return fallback;
    }

    if (fallback.route !== "chat" && parsed.route === "chat") {
      return fallback;
    }

    return {
      ...fallback,
      ...parsed,
      targets: parsed.targets || fallback.targets,
      appName: parsed.appName || fallback.appName || "",
      language: parsed.language === "ko" ? "ko" : fallback.language,
      requires_automation: parsed.requires_automation === true
    };
  } catch (_error) {
    return fallback;
  }
}

module.exports = {
  routeInputWithLlm
};
