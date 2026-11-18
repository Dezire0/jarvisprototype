import spotifyCommands from "../../../../src/main/assistant/spotify-commands.json";

export function resolveSpotifyCommand(input: string, hasAttachmentsOrQuote: boolean) {
  if (hasAttachmentsOrQuote || input.length > 550 || /[\r\n]/.test(input)) return;
  const text = input.trim();
  const command = text.toLowerCase();
  if (spotifyCommands.open.en.includes(command) || spotifyCommands.open.ko.includes(command)) return { query: "" };
  for (const prefix of [...spotifyCommands.search.en, ...spotifyCommands.search.ko]) {
    if (command === prefix) return { query: "" };
    if (command.startsWith(prefix + " ")) {
      const query = text.slice(prefix.length + 1).trim();
      if (query.length <= 512) return { query };
    }
  }
}
