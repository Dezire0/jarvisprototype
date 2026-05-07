function promoteFollowUpRoute(route, input, helpers = {}) {
  let nextRoute = route;

  if (route.route === "chat" && helpers.looksLikeBrowserContextFollowUp?.(input)) {
    nextRoute = {
      ...nextRoute,
      route: "browser",
      requires_automation: true
    };
  }

  if (
    nextRoute.route === "chat" &&
    helpers.looksLikeAppAction?.(input) &&
    helpers.lastActiveApp
  ) {
    nextRoute = {
      ...nextRoute,
      route: "app_action",
      appName: helpers.lastActiveApp
    };
  }

  return nextRoute;
}

module.exports = {
  promoteFollowUpRoute
};
