function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const match = String(raw).match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (__error) {
      return null;
    }
  }
}

function buildRouterPrompt(installedAppNames = []) {
  return [
    "You are the intent router for a bilingual desktop assistant.",
    "Respond with valid JSON only.",
    'Schema: {"route":"chat|browser|browser_login|screen_summary|screen_academic|system_briefing|obs_connect|obs_status|obs_start|obs_stop|obs_scene|file_read|file_write|file_list|stream_prep|app_open|app_action|app_list|open_targets|spotify_play|game_install|game_update|game_list|code_project","language":"ko|en","appName":"","siteOrUrl":"","path":"","content":"","sceneName":"","query":"","platform":"steam|epic|both","targets":{"apps":[],"web":[]},"reason":"","confidence":0,"missing":[],"requires_automation":false}',
    "Use chat for general conversation, recommendations, ideas, opinions, follow-up discussion, or questions that do not clearly require a desktop action.",
    "Use app_open for opening a local desktop app like Chrome, Finder, Terminal, Slack, Spotify, Notion, Steam, OBS, or VS Code.",
    "For app_open, appName must contain only the app/product name. Never include request verbs, politeness endings, punctuation, or the full user sentence.",
    "Use app_action when the user wants to do something inside a desktop app, such as typing, sending a message in Slack or Discord, pressing a key, running a shortcut, searching, opening a folder or tab, creating a new item, using a menu, or performing a multi-step workflow inside that app.",
    "Use open_targets when the user asks to open multiple local apps or a local app plus one or more websites in the same request. Fill targets.apps with app names and targets.web with URLs or site names.",
    "Use app_list when the user asks to list installed or available desktop apps.",
    "Use spotify_play when the user wants Spotify to play, pause, resume, skip, search, or open a playlist, song, or music request inside Spotify.",
    "Use game_install, game_update, and game_list for Steam or Epic game management requests.",
    "Use code_project when the user asks you to create a coding project, generate an app, scaffold a prototype, or build something like a snake game or todo app.",
    "Use browser for website navigation, URLs, searches, web logins, reading web pages, or multi-step site workflows like open site, log in, search, and show activity.",
    "Use browser_login only for explicit login requests.",
    "Set requires_automation to true when the request requires screen reading, login handling, button clicks, summarizing page content, checking who/what is on a page, opening the latest mail/message, or any multi-step website workflow. Set it to false only for simple page opens or simple searches.",
    "When the user names a specific app or website, prioritize that named target over generic nouns like music, song, video, message, or search.",
    "Do not route recommendation-style questions into desktop actions unless the user clearly asks you to play, open, search, or control something.",
    "Use system_briefing when the user asks what is happening on this computer, the current machine status, frontmost app, browser state, or a direct system overview.",
    "Use screen_summary for OCR or screen understanding.",
    "Use screen_academic for tutoring, explanation, grammar correction, or study help about the current screen.",
    "Use obs_* only for OBS connection, status, stream control, or scene switching.",
    "Use file_* only for local file tasks.",
    "If unsure, return chat.",
    "language must be ko if the user is mainly speaking Korean, otherwise en.",
    installedAppNames.length
      ? `Installed app hints: ${installedAppNames.join(", ")}`
      : "Installed app hints are unavailable; infer common app names when the user clearly names one."
  ].join(" ");
}

module.exports = {
  buildRouterPrompt,
  safeJsonParse
};
