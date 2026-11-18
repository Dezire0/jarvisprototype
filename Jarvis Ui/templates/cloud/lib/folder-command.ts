import folderCommands from "../../../../src/main/assistant/folder-commands.json";

export function isFolderCommand(input: string, hasAttachmentsOrQuote: boolean) {
  if (hasAttachmentsOrQuote || input.length > 100 || /[\r\n]/.test(input)) return false;
  const command = input.trim().replace(/\s+/g, " ").toLowerCase();
  return folderCommands.en.includes(command) || folderCommands.ko.includes(command);
}
