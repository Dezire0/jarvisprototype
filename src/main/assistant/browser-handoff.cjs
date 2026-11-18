const { normalizeReviewAddress } = require("./browser-review-address.cjs");

const MAX_BROWSER_SEARCH_LENGTH = 200;

function browserHandoffTarget(request) {
  if (request?.mode === "address") return normalizeReviewAddress(request.input);
  if (request?.mode !== "search" || typeof request.input !== "string" ||
      request.input.length > MAX_BROWSER_SEARCH_LENGTH || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(request.input)) {
    return null;
  }
  const query = request.input.trim();
  if (!query) return null;
  const target = new URL("https://www.google.com/search");
  target.searchParams.set("q", query);
  return target.href;
}

module.exports = { MAX_BROWSER_SEARCH_LENGTH, browserHandoffTarget };
