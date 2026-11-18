import obsCommands from "../../../../src/main/assistant/obs-commands.json";

export function isObsCommand(input: string, hasAttachmentsOrQuote: boolean) {
  if (hasAttachmentsOrQuote || input.length > 100 || /[\r\n]/.test(input)) return false;
  return obsCommands.includes(input.trim().replace(/[ \t]+/g, " ").toLowerCase());
}
