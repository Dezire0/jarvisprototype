import projectCommands from "../../../../src/main/assistant/project-commands.json";

export function isProjectCommand(input: string, hasAttachmentsOrQuote: boolean) {
  if (hasAttachmentsOrQuote || input.length > 100 || /[\r\n]/.test(input)) return false;
  const command = input.trim().replace(/\s+/g, " ").toLowerCase();
  return projectCommands.en.includes(command) || projectCommands.ko.includes(command);
}
