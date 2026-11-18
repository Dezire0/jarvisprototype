const assert = require("node:assert/strict");
const { test } = require("node:test");
const { browserHandoffTarget, MAX_BROWSER_SEARCH_LENGTH } = require("../../src/main/assistant/browser-handoff.cjs");
const { requiresComputerControl } = require("../../src/main/computer-control.cjs");

test("browser handoff accepts explicit HTTP and HTTPS addresses without credentials", () => {
  assert.equal(browserHandoffTarget({ mode: "address", input: " https://example.invalid/Guide?q=a#section " }),
    "https://example.invalid/Guide?q=a#section");
  assert.equal(browserHandoffTarget({ mode: "address", input: "http://127.0.0.1:4300/" }), "http://127.0.0.1:4300/");
  for (const input of ["https://user:secret@example.invalid/", "file:///tmp/test", "javascript:alert(1)",
    "https://example.invalid/with space", "https:///example.invalid", "example.invalid", null]) {
    assert.equal(browserHandoffTarget({ mode: "address", input }), null);
  }
  assert.equal(browserHandoffTarget({ mode: "open", input: "https://example.invalid" }), null);
  assert.equal(requiresComputerControl("browser:handoff"), true);
});

test("browser search treats the entire bounded query as a Google search parameter", () => {
  const query = "한글 & #? cafe + topic";
  const url = new URL(browserHandoffTarget({ mode: "search", input: " " + query + " " }));
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.pathname, "/search");
  assert.deepEqual([...url.searchParams], [["q", query]]);
  for (const input of ["", " ", "line\nsecond", "line\u2028second", "q".repeat(MAX_BROWSER_SEARCH_LENGTH + 1), {}]) {
    assert.equal(browserHandoffTarget({ mode: "search", input }), null);
  }
  assert.equal(browserHandoffTarget(), null);
});
