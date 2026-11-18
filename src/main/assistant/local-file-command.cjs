const closingQuotes = new Map([
  ['"', '"'], ["'", "'"], ["“", "”"], ["‘", "’"],
]);

function parseLocalFileRead(input) {
  const text = String(input || "").trim();
  const english = text.match(/^(?:read|open)[ \t]+file[ \t]+([^\r\n]+)$/i);
  const match = english || text.match(/^파일[ \t]+([^\r\n]+)[ \t](?:읽어|열어|보여)(?:[ \t]*(?:줘|주세요))?[.!?]?$/);
  if (!match) return null;

  const path = match[1].trim();
  const closingQuote = closingQuotes.get(path[0]);
  const filePath = closingQuote ? (path.endsWith(closingQuote) ? path.slice(1, -1) : "") : path;
  return { path: filePath.includes("\0") ? "" : filePath, language: english ? "en" : "ko" };
}

module.exports = { parseLocalFileRead };
