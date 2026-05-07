async function runAssistantTurn(service, cleanInput, helpers = {}) {
  if (!cleanInput) {
    return {
      reply:
        helpers.detectReplyLanguage(cleanInput) === "ko"
          ? "말씀해주시면 바로 도와드릴게요."
          : "Tell me what you want, and I will help right away.",
      actions: [],
      provider: "local",
      language: helpers.detectReplyLanguage(cleanInput)
    };
  }

  if (helpers.looksLikeModelIdentityQuestion(cleanInput)) {
    const result = helpers.buildConfiguredModelIdentityResult(
      cleanInput,
      helpers.detectReplyLanguage(cleanInput),
      service.settings?.getConversationModelSettingsView?.() || {}
    );
    return service.finalizeResponse(cleanInput, result, {
      route: "chat"
    });
  }

  const pendingClarificationResult = await service.continuePendingClarification(cleanInput);
  if (pendingClarificationResult) {
    pendingClarificationResult.language = helpers.detectReplyLanguage(cleanInput);
    return service.finalizeResponse(cleanInput, pendingClarificationResult, {
      route: "pending_clarification"
    });
  }

  const pendingBrowserResult = await service.continuePendingBrowserContinuation(cleanInput);
  if (pendingBrowserResult) {
    pendingBrowserResult.language = helpers.detectReplyLanguage(cleanInput);
    return service.finalizeResponse(cleanInput, pendingBrowserResult, {
      route: "browser"
    });
  }

  const pendingSensitiveResult = await service.continuePendingSensitiveConfirmation(cleanInput);
  if (pendingSensitiveResult) {
    pendingSensitiveResult.language = helpers.detectReplyLanguage(cleanInput);
    return service.finalizeResponse(cleanInput, pendingSensitiveResult, {
      route: "browser_sensitive_confirmation"
    });
  }

  if (service.pendingWorkspaceMessage && helpers.looksLikeFreshWorkspaceCommand(cleanInput)) {
    service.pendingWorkspaceMessage = null;
  }

  const pendingWorkspaceResult = await service.continuePendingWorkspaceMessage(cleanInput);
  if (pendingWorkspaceResult) {
    pendingWorkspaceResult.language = helpers.detectReplyLanguage(cleanInput);
    return service.finalizeResponse(cleanInput, pendingWorkspaceResult, {
      route: "app_action"
    });
  }

  const extensionWebhookResult = await service.maybeHandleExtensionWebhook(cleanInput);
  if (extensionWebhookResult) {
    extensionWebhookResult.language = helpers.detectReplyLanguage(cleanInput);
    return service.finalizeResponse(cleanInput, extensionWebhookResult, {
      route: "extension_webhook"
    });
  }

  let route = await service.routeInput(cleanInput);
  route = helpers.promoteFollowUpRoute(route, cleanInput, {
    lastActiveApp: service.lastActiveApp,
    looksLikeAppAction: helpers.looksLikeAppAction,
    looksLikeBrowserContextFollowUp: service.looksLikeBrowserContextFollowUp.bind(service)
  });

  let result;

  try {
    result = await service.executeRoute(cleanInput, route);
  } catch (error) {
    result = {
      reply:
        helpers.detectReplyLanguage(cleanInput) === "ko"
          ? `처리 중에 문제가 있었어요: ${error.message}`
          : `I ran into a problem while handling that: ${error.message}`,
      actions: [],
      provider: "local-error"
    };
  }

  result.language = route.language || helpers.detectReplyLanguage(cleanInput);
  return service.finalizeResponse(cleanInput, result, {
    route: route.route || "chat"
  });
}

module.exports = {
  runAssistantTurn
};
