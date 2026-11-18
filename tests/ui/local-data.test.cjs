const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;
const key = "jarvis-local-workspace:v1";
const initial = {
  tasks: [{ id: "task-1", text: "Review report", done: false }],
  notes: [{ id: "note-1", text: "Keep this note" }],
  activity: [{ id: "activity-1", kind: "task", at: 1670000000000 }],
  timer: { seconds: 900, remaining: 800, endsAt: null },
  speakResults: true,
};

test("local data cleanup requires a current review and commits only the selected categories", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const url = new URL("/tools", testUrl);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: "en-US", reducedMotion: "reduce", viewport: { width: 420, height: 560 } });
    const externalRequests = [];
    await context.route("**/*", (route) => {
      const target = new URL(route.request().url());
      if (target.origin !== url.origin || target.pathname === "/api/chat") {
        externalRequests.push(target.pathname);
        return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript(({ key, initial }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (item, value) {
        if (item === key && window.failDeletion) {
          window.failDeletion = false;
          throw new DOMException("Fixture storage failure", "QuotaExceededError");
        }
        return write.call(this, item, value);
      };
    }, { key, initial });
    const page = await context.newPage();
    const other = await context.newPage();
    page.setDefaultTimeout(5000);
    await Promise.all([page.goto(url.href), other.goto(url.href)]);
    const data = page.getByRole("dialog", { name: "Local data", exact: true });
    const trigger = page.getByRole("button", { name: "Local data", exact: true });
    const tasks = data.getByRole("checkbox", { name: /^Tasks/ });
    const notes = data.getByRole("checkbox", { name: /^Notes/ });
    const activity = data.getByRole("checkbox", { name: /^Recent activity/ });
    const review = data.getByRole("button", { name: "Review deletion", exact: true });
    const remove = data.getByRole("button", { name: "Delete selected data", exact: true });
    const read = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    await trigger.press("Enter");
    await data.getByText("Tool data stored in this browser for this site.").waitFor();
    assert.equal(await review.isDisabled(), true);
    await tasks.check();
    await activity.check();
    await review.click();
    const cancel = data.getByRole("button", { name: "Cancel", exact: true });
    await cancel.waitFor();
    assert.equal(await cancel.evaluate((button) => button === document.activeElement), true);
    await cancel.press("Enter");
    assert.deepEqual(await read(), initial);
    assert.equal(await notes.isChecked(), false);

    await review.click();
    const extra = { id: "task-2", text: "Arrived during review", done: false };
    await other.evaluate(({ key, extra }) => {
      const current = JSON.parse(localStorage.getItem(key));
      current.tasks.push(extra);
      localStorage.setItem(key, JSON.stringify(current));
    }, { key, extra });
    await remove.click();
    await data.getByRole("alert").getByText("The data changed. Review your selection again.").waitFor();
    const expanded = { ...initial, tasks: [...initial.tasks, extra] };
    assert.deepEqual(await read(), expanded);

    await review.click();
    await page.evaluate(() => { window.failDeletion = true; });
    await remove.click();
    await data.getByRole("alert").getByText("Couldn’t save the deletion. Try again.").waitFor();
    assert.deepEqual(await read(), expanded);
    await remove.click();
    await data.getByRole("status").getByText("Deleted the selected data.").waitFor();
    assert.deepEqual(await read(), { ...initial, tasks: [], activity: [] });
    assert.equal(await tasks.isDisabled(), true);
    await page.keyboard.press("Escape");
    await data.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate((button) => button === document.activeElement), true);
    await page.reload();
    await page.getByText("Keep this note", { exact: true }).waitFor();
    assert.equal(await page.getByText("Review report", { exact: true }).count(), 0);
    assert.deepEqual(await read(), { ...initial, tasks: [], activity: [] });
    assert.deepEqual(externalRequests, []);
  } finally {
    await browser.close();
  }
});
