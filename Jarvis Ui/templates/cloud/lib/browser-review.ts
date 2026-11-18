import browserReviewCommands from "../../../../src/main/assistant/browser-review-commands.json";

type BrowserReviewMode = keyof typeof browserReviewCommands;
const modes = Object.keys(browserReviewCommands) as BrowserReviewMode[];

export function resolveBrowserReviewCommand(input: string, hasAttachmentsOrQuote: boolean): BrowserReviewMode | undefined {
  if (hasAttachmentsOrQuote || input.length > 100 || /[\r\n]/.test(input)) return undefined;
  const command = input.trim().replace(/\s+/g, " ").toLowerCase();
  return modes.find((mode) => browserReviewCommands[mode].en.includes(command) || browserReviewCommands[mode].ko.includes(command));
}
