const MAX_REVIEW_ADDRESS_LENGTH = 2048;

function normalizeReviewAddress(value) {
  if (typeof value !== "string") return null;
  const address = value.trim();
  if (address.length > MAX_REVIEW_ADDRESS_LENGTH || !/^https?:\/\/[^/]/i.test(address) ||
      /[\s\\\u0000-\u001f\u007f]/u.test(address)) return null;
  try {
    const url = new URL(address);
    return url.username || url.password || url.href.length > MAX_REVIEW_ADDRESS_LENGTH ? null : url.href;
  } catch {
    return null;
  }
}

function parseReviewAddressCommand(input) {
  if (typeof input !== "string" || /[\r\n]/.test(input)) return null;
  const command = /^(review url|웹 주소 검토)(?:\s+(.*))?$/iu.exec(input.trim());
  if (!command) return null;
  return { address: command[2] || "", language: command[1] === "웹 주소 검토" ? "ko" : "en" };
}

module.exports = { MAX_REVIEW_ADDRESS_LENGTH, normalizeReviewAddress, parseReviewAddressCommand };
