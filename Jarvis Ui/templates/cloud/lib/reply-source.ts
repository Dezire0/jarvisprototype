import { formatReplySource } from "../../../../src/main/assistant/reply-source.cjs";

export { normalizeReplySource, type ReplySource } from "../../../../src/main/assistant/reply-source.cjs";

export function replySourceLabel(source: unknown, legacyProvider: unknown, korean: boolean) {
  const label = formatReplySource(source, korean);
  if (label) return label;
  if (legacyProvider === "jarvis-cloud") return "Jarvis Cloud";
  const legacyModel = typeof legacyProvider === "string"
    ? /^jarvis-cloud-(gemini-[a-z0-9][a-z0-9.-]{0,99})$/.exec(legacyProvider)?.[1] : undefined;
  return legacyModel ? formatReplySource({ provider: "jarvis-cloud", model: legacyModel }, korean) : "";
}
