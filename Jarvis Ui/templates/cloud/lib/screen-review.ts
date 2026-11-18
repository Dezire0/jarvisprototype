import screenReviewCommands from "../../../../src/main/assistant/screen-review-commands.json";

export type ScreenReviewMode = keyof typeof screenReviewCommands;
const screenReviewModes = Object.keys(screenReviewCommands) as ScreenReviewMode[];

export function resolveScreenReviewCommand(input: string, hasAttachmentsOrQuote: boolean): ScreenReviewMode | undefined {
  if (hasAttachmentsOrQuote || input.length > 100 || /[\r\n]/.test(input)) return undefined;
  const command = input.trim().replace(/\s+/g, " ").toLowerCase();
  return screenReviewModes.find((mode) =>
    screenReviewCommands[mode].en.includes(command) || screenReviewCommands[mode].ko.includes(command),
  );
}
