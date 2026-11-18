import gameCommands from "../../../../src/main/assistant/game-commands.json";

export type GameView = keyof typeof gameCommands;
const views = Object.keys(gameCommands) as GameView[];

export function resolveGameCommand(input: string, hasAttachmentsOrQuote: boolean) {
  if (hasAttachmentsOrQuote || input.length > 170 || /[\r\n]/.test(input)) return;
  const text = input.trim().replace(/\s+/g, " ");
  const command = text.toLowerCase();
  for (const view of views) {
    const phrases = gameCommands[view];
    if (phrases.en.includes(command) || phrases.ko.includes(command)) return { view, query: "" };
    if (!("withTitle" in phrases)) continue;
    const prefix = [...phrases.withTitle.en, ...phrases.withTitle.ko].find((phrase) => command.startsWith(phrase + " "));
    if (!prefix) continue;
    const query = text.slice(prefix.length + 1).trim();
    if (query.length > 0 && query.length <= 120) return { view, query };
  }
}
