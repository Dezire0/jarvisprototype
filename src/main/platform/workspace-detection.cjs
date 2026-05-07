const {
  normalizeAppToken,
  normalizeSingleLineText,
  splitSearchTokens
} = require("./app-registry.cjs");

function buildWorkspaceQuickSwitchQuery(appName, target = "") {
  const cleanTarget = normalizeSingleLineText(target).replace(/^[@#]+/, "");
  const normalizedApp = normalizeAppToken(appName);

  if (!cleanTarget) {
    return "";
  }

  if (normalizedApp === "discord") {
    return cleanTarget;
  }

  return cleanTarget;
}

function stripWorkspaceWindowTitleSuffix(title = "", appName = "") {
  const cleanTitle = normalizeSingleLineText(title);
  const cleanAppName = normalizeSingleLineText(appName);

  if (!cleanTitle) {
    return "";
  }

  if (cleanAppName) {
    return cleanTitle.replace(new RegExp(`\\s+-\\s+${cleanAppName}\\s*$`, "i"), "").trim();
  }

  return cleanTitle.replace(/\s+-\s+(Discord|Slack)\s*$/i, "").trim();
}

function normalizeWorkspaceConversationToken(value = "") {
  return normalizeSingleLineText(
    String(value)
      .replace(/^[@#]+/, "")
      .replace(/\s+-\s+(Discord|Slack)\s*$/i, "")
  )
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function splitWorkspaceMeaningfulTokens(value = "") {
  return [...new Set(
    normalizeSingleLineText(value)
      .toLowerCase()
      .split(/[^a-z0-9가-힣]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  )];
}

function workspaceConversationTitleMatchesTarget(appName, title = "", target = "") {
  const strippedTitle = stripWorkspaceWindowTitleSuffix(title, appName);
  const normalizedTitle = normalizeWorkspaceConversationToken(strippedTitle);
  const normalizedTarget = normalizeWorkspaceConversationToken(target);
  const titleTokens = splitWorkspaceMeaningfulTokens(strippedTitle);
  const targetTokens = splitWorkspaceMeaningfulTokens(target);

  if (!normalizedTitle || !normalizedTarget) {
    return false;
  }

  if (normalizedTitle === normalizedTarget) {
    return true;
  }

  if (normalizedTarget.length <= 1) {
    return false;
  }

  return (
    normalizedTitle.startsWith(normalizedTarget) ||
    normalizedTarget.startsWith(normalizedTitle) ||
    normalizedTitle.includes(normalizedTarget) ||
    (targetTokens.length >= 2 && targetTokens.every((token) => titleTokens.some((candidate) => candidate.includes(token))))
  );
}

function buildDiscordTargetStrategies(target = "") {
  const destination = normalizeSingleLineText(target).replace(/^[@#]+/, "");
  const tokenQueries = splitWorkspaceMeaningfulTokens(destination);
  const queries = [
    destination,
    destination.toLowerCase(),
    `@${destination}`,
    `*${destination}`,
    `#${destination}`,
    ...tokenQueries,
    ...tokenQueries.map((token) => `*${token}`),
    ...tokenQueries.map((token) => `#${token}`)
  ].filter(Boolean);
  const uniqueQueries = [...new Set(queries)];
  const shortcuts = ["k", "t"];
  const strategies = [];

  for (const query of uniqueQueries) {
    for (const shortcut of shortcuts) {
      strategies.push({
        label: `${shortcut === "k" ? "quick-switch" : "find-conversation"}:${query}`,
        shortcut,
        query
      });
    }
  }

  return strategies;
}

function normalizeDiscordOcrText(value = "") {
  return normalizeSingleLineText(
    String(value)
      .replace(/^[@#]+/, "")
      .replace(/\s+members?$/i, "")
  ).toLowerCase();
}

function getObservationCenter(observation = {}) {
  return {
    x: Number(observation.x || 0) + Number(observation.width || 0) / 2,
    y: Number(observation.y || 0) + Number(observation.height || 0) / 2
  };
}

function observationMatchesDiscordRegion(observation = {}, region = {}) {
  const center = getObservationCenter(observation);

  if (Number.isFinite(region.minX) && center.x < region.minX) {
    return false;
  }

  if (Number.isFinite(region.maxX) && center.x > region.maxX) {
    return false;
  }

  if (Number.isFinite(region.minY) && center.y < region.minY) {
    return false;
  }

  if (Number.isFinite(region.maxY) && center.y > region.maxY) {
    return false;
  }

  return true;
}

function scoreDiscordTargetObservation(observation = {}, target = "") {
  const sourceText = normalizeSingleLineText(observation.text || "");
  const normalizedText = normalizeDiscordOcrText(sourceText);
  const normalizedTarget = normalizeDiscordOcrText(target);
  const textTokens = splitSearchTokens(normalizedText);
  const targetTokens = splitSearchTokens(normalizedTarget);
  const center = getObservationCenter(observation);

  if (!normalizedText || !normalizedTarget) {
    return Number.NEGATIVE_INFINITY;
  }

  if (/^(friends|message requests|nitro home|shop|quests|direct messages|search in dms|find or start a conversation|members?|drafts|mentions|protip)/i.test(sourceText)) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (normalizedText === normalizedTarget) {
    score += 140;
  }

  if (normalizedText.startsWith(normalizedTarget)) {
    score += 110;
  }

  if (normalizedText.includes(normalizedTarget)) {
    score += 80;
  }

  if (normalizedTarget.length === 1 && textTokens[0] === normalizedTarget) {
    score += 120;
  }

  if (targetTokens.length && targetTokens.every((token) => textTokens.some((candidate) => candidate.includes(token) || token.includes(candidate)))) {
    score += 70;
  }

  if (sourceText.toLowerCase().includes("members")) {
    score -= 30;
  }

  if (center.x <= 0.25) {
    score += 18;
  }

  if (center.x >= 0.28 && center.x <= 0.68 && center.y >= 0.34 && center.y <= 0.64) {
    score += 22;
  }

  return score;
}

function findBestDiscordObservation(observations = [], target = "", region = {}) {
  const candidates = observations
    .filter((observation) => observationMatchesDiscordRegion(observation, region))
    .map((observation) => ({
      observation,
      score: scoreDiscordTargetObservation(observation, target)
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.observation || null;
}

function parseDiscordMessageHeader(line = "") {
  const trimmed = normalizeSingleLineText(line);

  if (!trimmed) {
    return null;
  }

  const koreanMatch = trimmed.match(/^(.+?)\s+(오전|오후)\s+(\d{1,2}:\d{2})$/i);

  if (koreanMatch?.[1]) {
    return {
      author: cleanupWorkspaceLabel(koreanMatch[1]),
      time: `${koreanMatch[2]} ${koreanMatch[3]}`
    };
  }

  const englishMatch = trimmed.match(/^(.+?)\s+(\d{1,2}:\d{2}\s*(?:AM|PM))$/i);

  if (englishMatch?.[1]) {
    return {
      author: cleanupWorkspaceLabel(englishMatch[1]),
      time: englishMatch[2]
    };
  }

  return null;
}

function cleanupWorkspaceLabel(value = "") {
  return normalizeSingleLineText(
    String(value)
      .replace(/^[@#]+/, "")
      .replace(/[|·•]+$/g, "")
  );
}

function looksLikeDiscordUiNoise(line = "") {
  return /^(friends|nitro|shop|message requests|discover|apps|threads|message @|gif|sticker|emoji|today|yesterday|edited|new messages)$/i.test(
    normalizeSingleLineText(line)
  );
}

function parseVisibleDiscordMessages(ocrText = "") {
  const lines = String(ocrText)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const messages = [];
  let current = null;

  for (const line of lines) {
    const header = parseDiscordMessageHeader(line);

    if (header?.author) {
      if (current?.author && current.lines.length) {
        messages.push({
          author: current.author,
          time: current.time,
          text: current.lines.join(" ")
        });
      }

      current = {
        author: header.author,
        time: header.time,
        lines: []
      };
      continue;
    }

    if (!current || looksLikeDiscordUiNoise(line)) {
      continue;
    }

    current.lines.push(line);
  }

  if (current?.author && current.lines.length) {
    messages.push({
      author: current.author,
      time: current.time,
      text: current.lines.join(" ")
    });
  }

  return messages.slice(-8);
}

function convertObservationToScreenPoint(window = {}, observation = {}) {
  const center = getObservationCenter(observation);
  const clickX = center.x <= 0.25 && Number(observation.width || 0) < 0.025 ? 0.125 : center.x;

  return {
    x: Number(window.x || 0) + clickX * Number(window.width || 0),
    y: Number(window.y || 0) + (1 - center.y) * Number(window.height || 0)
  };
}

function findDiscordSidebarConversationObservation(observations = [], target = "") {
  return findBestDiscordObservation(observations, target, {
    minX: 0.05,
    maxX: 0.24,
    minY: 0.14,
    maxY: 0.68
  });
}

function findDiscordQuickSwitcherResultObservation(observations = [], target = "") {
  const region = {
    minX: 0.28,
    maxX: 0.68,
    minY: 0.30,
    maxY: 0.62
  };
  const candidates = observations
    .filter((observation) => observationMatchesDiscordRegion(observation, region))
    .map((observation) => ({
      observation,
      score: scoreDiscordTargetObservation(observation, target),
      center: getObservationCenter(observation)
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > 0);

  if (normalizeDiscordOcrText(target).length <= 1) {
    candidates.sort((left, right) => (right.center.y - left.center.y) || (right.score - left.score));
    return candidates[0]?.observation || null;
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.observation || null;
}

function findDiscordSearchTriggerObservation(observations = []) {
  return observations.find((observation) => normalizeDiscordOcrText(observation.text).includes("find or start a conversation")) || null;
}

module.exports = {
  buildDiscordTargetStrategies,
  buildWorkspaceQuickSwitchQuery,
  cleanupWorkspaceLabel,
  convertObservationToScreenPoint,
  findDiscordQuickSwitcherResultObservation,
  findDiscordSearchTriggerObservation,
  findDiscordSidebarConversationObservation,
  getObservationCenter,
  normalizeDiscordOcrText,
  normalizeWorkspaceConversationToken,
  observationMatchesDiscordRegion,
  parseDiscordMessageHeader,
  parseVisibleDiscordMessages,
  scoreDiscordTargetObservation,
  splitWorkspaceMeaningfulTokens,
  stripWorkspaceWindowTitleSuffix,
  workspaceConversationTitleMatchesTarget
};
