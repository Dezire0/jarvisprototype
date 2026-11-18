const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;
const account = { id: "action-review", email: "record@example.invalid", plan: "free" };
const historyKey = "jarvis-chat-history:v1:" + account.id;

test("execution records keep bounded destinations locally and restore older actions", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const url = new URL(testUrl);
  assert.equal(url.hostname, "127.0.0.1");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 420, height: 560 }, locale: "en-US", reducedMotion: "reduce",
    });
    const expected = [
      { type: "open_url", status: "executed", host: "docs.example.invalid" },
      { type: "desktop_open_app", status: "executed", appName: "Preview" },
      { type: "open_app", status: "executed" },
      { type: "file_write", status: "needs-confirmation" },
      { type: "open_url", status: "failed" },
      { type: "other", status: "unknown" },
    ];
    const syncs = [];
    await page.route("**/*", (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if (target.origin !== url.origin) return route.abort();
      if (target.pathname === "/fixture/login") {
        return route.fulfill({ json: { token: "record-fixture-token", user: account } });
      }
      if (target.pathname === "/fixture/plan") return route.fulfill({ json: { success: true, plan: "free" } });
      if (target.pathname === "/fixture/sync") {
        syncs.push(request.postDataJSON());
        return route.fulfill({ json: { success: true } });
      }
      if (target.pathname !== "/api/chat") return route.continue();
      const { state } = request.postDataJSON();
      const createdAt = new Date().toISOString();
      const messages = [
        ...state.messages,
        { id: "current-question", role: "user", status: "complete", createdAt, text: "Show the execution record" },
        { id: "current-answer", role: "assistant", status: "complete", createdAt, text: "Action fixture", actions: [
          { type: "open_url", status: "executed", target: "https://private-user:private-key@docs.example.invalid:8443/private-folder?id=private-query#private-fragment" },
          { type: "desktop_open_app", status: "executed", appName: "Preview", target: "/Applications/private-app.app" },
          { type: "open_app", status: "executed", appName: "/Users/private-home/Local.app", target: "Unverified launch target" },
          { type: "file_write", status: "needs-confirmation", target: "/Users/private-home/private-file.txt" },
          { type: "open_url", status: "failed", target: "file:///private-folder/private-file.txt", host: "docs.example.invalid/private-folder" },
          { type: "private-tool-name", status: "private-result-data", target: "private-input" },
          { type: "open_url" }, [],
        ] },
      ];
      return route.fulfill({
        contentType: "text/plain",
        body: "aui-state:" + JSON.stringify([{ type: "set", path: [], value: { messages } }]) +
          '\nd:{"finishReason":"stop","usage":{"inputTokens":0,"outputTokens":0}}\n',
      });
    });
    await page.addInitScript((key) => {
      if (!localStorage.getItem(key)) {
        const createdAt = new Date().toISOString();
        localStorage.setItem(key, JSON.stringify({
          version: 1, cloudSync: true,
          threads: [{ remoteId: "legacy", title: "Earlier conversation", status: "regular", updatedAt: Date.now(), messages: [
            { id: "earlier-question", role: "user", text: "Earlier", createdAt },
            { id: "earlier-answer", role: "assistant", text: "Earlier answer", createdAt,
              actions: [{ type: "browser_search", status: "executed" }] },
          ] }],
          sidebar: { projects: [], threadMetaById: {}, selectedProjectId: null },
        }));
      }
      const fetchNetwork = window.fetch;
      window.fetch = (input, options) => {
        const target = new URL(typeof input === "string" ? input : input.url, location.href);
        if (target.hostname === "jarvis-auth-service.dexproject.workers.dev") {
          if (target.pathname.startsWith("/api/auth/")) return fetchNetwork(target.pathname.replace("/api/auth/", "/fixture/"), options);
          if (target.pathname === "/api/chat/sync") return fetchNetwork("/fixture/sync", options);
        }
        return fetchNetwork(input, options);
      };
    }, historyKey);
    await page.goto(url.href);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await page.getByRole("button", { name: "Continue with Free" }).click();

    const composer = page.getByRole("textbox", { name: "Message input" });
    const receipt = page.getByRole("region", { name: "Execution record" });
    const sync = page.waitForResponse((response) => new URL(response.url()).pathname === "/fixture/sync");
    await composer.fill("Show the execution record");
    await composer.press("Enter");
    await receipt.getByText("docs.example.invalid", { exact: true }).waitFor();
    assert.equal(await receipt.count(), 1);
    const live = await receipt.getByRole("listitem").allTextContents();
    assert.equal(live.length, 6);
    for (const text of ["Preview", "Approval required", "Failed", "Outcome unavailable"]) {
      assert.equal(await receipt.getByText(text, { exact: true }).count(), 1);
    }
    assert.doesNotMatch(live.join(" "), /private-|Unverified launch target|8443/);
    assert.equal(await receipt.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).threads.some(
      (thread) => thread.messages.at(-1)?.id === "current-answer",
    ), historyKey);
    const snapshot = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), historyKey);
    assert.deepEqual(snapshot.threads.find((thread) => thread.messages.at(-1)?.id === "current-answer").messages.at(-1).actions, expected);
    await sync;
    assert.equal(syncs.length, 1);
    assert.doesNotMatch(JSON.stringify(syncs[0]), /private-|docs\.example|Preview|"actions"|"appName"/);

    const sidebar = page.getByRole("button", { name: "Toggle sidebar" });
    await page.setViewportSize({ width: 1180, height: 772 });
    await page.reload();
    await sidebar.click();
    await page.getByRole("button", { name: "Show the execution record", exact: true }).click();
    await receipt.getByText("docs.example.invalid", { exact: true }).waitFor();
    assert.deepEqual(await receipt.getByRole("listitem").allTextContents(), live);
    await page.getByRole("button", { name: "Earlier conversation", exact: true }).click();
    await receipt.getByText("Search browser", { exact: true }).waitFor();
    assert.equal(await receipt.getByText("Executed", { exact: true }).count(), 1);

    await page.getByRole("button", { name: "Temporary Chat", exact: true }).click();
    await receipt.waitFor({ state: "hidden" });
    await composer.fill("Show the execution record");
    await composer.press("Enter");
    await receipt.getByText("docs.example.invalid", { exact: true }).waitFor();
    const afterTemporary = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), historyKey);
    assert.deepEqual(afterTemporary.threads.map(({ remoteId }) => remoteId).sort(),
      snapshot.threads.map(({ remoteId }) => remoteId).sort());
    assert.equal(syncs.length, 1);
  } finally {
    await browser.close();
  }
});
