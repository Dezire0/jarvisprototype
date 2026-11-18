import browserReviewCommands from "../../../../src/main/assistant/browser-review-commands.json";
import { parseReviewAddressCommand } from "../../../../src/main/assistant/browser-review-address.cjs";
export { MAX_REVIEW_ADDRESS_LENGTH, normalizeReviewAddress } from "../../../../src/main/assistant/browser-review-address.cjs";

type BrowserReviewMode = keyof typeof browserReviewCommands;
const modes = Object.keys(browserReviewCommands) as BrowserReviewMode[];

export function resolveBrowserReviewCommand(input: string, hasAttachmentsOrQuote: boolean):
  { mode: BrowserReviewMode; address?: string } | undefined {
  if (hasAttachmentsOrQuote) return undefined;
  const addressCommand = parseReviewAddressCommand(input);
  if (addressCommand) return { mode: "read", address: addressCommand.address };
  if (input.length > 100 || /[\r\n]/.test(input)) return undefined;
  const command = input.trim().replace(/\s+/g, " ").toLowerCase();
  const mode = modes.find((mode) => browserReviewCommands[mode].en.includes(command) || browserReviewCommands[mode].ko.includes(command));
  return mode ? { mode } : undefined;
}
