const closingQuotes = new Map([
  ['"', '"'], ["'", "'"], ["“", "”"], ["‘", "’"],
]);

function readPath(text) {
  const path = text.trim();
  const closingQuote = closingQuotes.get(path[0]);
  const result = closingQuote ? (path.endsWith(closingQuote) ? path.slice(1, -1) : "") : path;
  return result.includes("\0") ? "" : result;
}

function parseLocalFileRead(input) {
  const text = String(input || "").trim();
  const english = text.match(/^(?:read|open)[ \t]+file[ \t]+([^\r\n]+)$/i);
  const match = english || text.match(/^파일[ \t]+([^\r\n]+)[ \t](?:읽어|열어|보여)(?:[ \t]*(?:줘|주세요))?[.!?]?$/);
  if (!match) return null;

  return { path: readPath(match[1]), language: english ? "en" : "ko" };
}

function parseLocalFileWrite(input) {
  const text = String(input || "").trimStart();
  if (/^(?:write|edit|save)[ \t]+file[ \t]*$/i.test(text)) return { path: "", content: "", language: "en" };
  if (/^파일[ \t]+저장[ \t]*$/.test(text)) return { path: "", content: "", language: "ko" };
  const english = text.match(/^(?:write|edit|save)[ \t]+file[ \t]+([^\r\n]+?):::([\s\S]*)$/i);
  const match = english || text.match(/^파일[ \t]+저장[ \t]+([^\r\n]+?):::([\s\S]*)$/);
  if (!match) return null;
  return {
    path: readPath(match[1]),
    content: match[2].replace(/^(?:\r?\n|[ \t])/, ""),
    language: english ? "en" : "ko",
  };
}

module.exports = { parseLocalFileRead, parseLocalFileWrite };
