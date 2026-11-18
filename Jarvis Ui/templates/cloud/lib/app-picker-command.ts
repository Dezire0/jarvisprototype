import commands from "../../../../src/main/assistant/app-picker-commands.json";

export function resolveAppPickerCommand(input: string, hasAttachmentsOrQuote: boolean) {
  if (hasAttachmentsOrQuote || input.length > 160 || /[\r\n]/.test(input)) return;
  const clean = input.trim().replace(/\s+/g, " ");
  const command = clean.toLowerCase();
  if (commands.list.en.includes(command) || commands.list.ko.includes(command)) return { query: "" };
  for (const prefix of [...commands.find.en, ...commands.find.ko]) {
    if (command === prefix) return { query: "" };
    if (command.startsWith(prefix + " ")) {
      const query = clean.slice(prefix.length + 1).trim();
      if (query.length <= 120) return { query };
    }
  }
}
