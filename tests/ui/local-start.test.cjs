const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("signed-out Jarvis runs commands locally and preserves the draft around sign-in", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const url = new URL(testUrl);
  assert.equal(url.hostname, "127.0.0.1");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 420, height: 560 }, colorScheme: "dark", locale: "ko-KR", reducedMotion: "reduce",
    });
    const serviceRequests = [];
    function trackRequest(route) {
      const target = new URL(route.request().url());
      if (target.pathname.startsWith("/api/")) serviceRequests.push(target.pathname);
      return target.origin === url.origin ? route.continue() : route.abort();
    }
    await page.route("**/*", trackRequest);
    await page.goto(url.href);

    const input = page.getByRole("textbox", { name: "로컬 명령 입력" });
    const signIn = page.getByRole("button", { name: "로그인", exact: true });
    for (const element of [input, signIn]) {
      const bounds = await element.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 420);
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 560);
    }
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "로컬 명령 입력");
    assert.equal(await page.getByLabel("이메일", { exact: true }).count(), 0);

    await page.getByRole("button", { name: "3분 타이머", exact: true }).click();
    assert.equal(await input.inputValue(), "3분 타이머 맞춰줘");
    assert.equal(await page.getByRole("timer").count(), 0);
    await input.press("Enter");
    await page.getByRole("status").getByText("타이머 시작", { exact: true }).waitFor();
    assert.match(await page.getByRole("timer").innerText(), /^(03:00|02:5[0-9])$/);
    await page.getByRole("button", { name: "일시 정지", exact: true }).click();
    await page.getByRole("button", { name: "재개", exact: true }).click();
    await page.getByRole("status").getByText("타이머 시작", { exact: true }).waitFor();

    await input.fill("메모 저장할 내용");
    await page.getByRole("button", { name: "할 일 추가", exact: true }).click();
    assert.equal(await input.inputValue(), "메모 저장할 내용");
    await signIn.click();
    await page.getByRole("button", { name: "Google 계정으로 로그인", exact: true }).waitFor();
    await page.getByRole("button", { name: "명령 화면", exact: true }).click();
    assert.equal(await input.inputValue(), "메모 저장할 내용");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "로컬 명령 입력");

    await page.evaluate(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "jarvis-local-workspace:v1") throw new Error("Fixture storage failure");
        return write.call(this, key, value);
      };
      window.restoreWorkspaceWrite = () => { Storage.prototype.setItem = write; };
    });
    await input.press("Enter");
    await page.getByRole("alert").getByText("기기에 저장하지 못했습니다", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "메모 저장할 내용");
    await page.evaluate(() => window.restoreWorkspaceWrite());

    await input.press("Enter");
    await page.getByRole("status").getByText("메모 저장", { exact: true }).waitFor();
    await page.getByRole("link", { name: "로컬 도구", exact: true }).click();
    await page.getByText("저장할 내용", { exact: true }).waitFor();
    await page.goto(url.href);
    await page.getByRole("timer").waitFor();
    assert.deepEqual(serviceRequests, []);

    const english = await browser.newPage({ locale: "en-US", reducedMotion: "reduce" });
    await english.route("**/*", trackRequest);
    await english.goto(url.href);
    await english.getByRole("button", { name: "Add task", exact: true }).click();
    const englishInput = english.getByRole("textbox", { name: "Local command" });
    assert.equal(await englishInput.inputValue(), "Add task ");
    await englishInput.fill("Add task Review launch");
    await englishInput.press("Enter");
    await english.getByRole("status").getByText("Task added", { exact: true }).waitFor();
    await english.getByRole("link", { name: "Local tools", exact: true }).click();
    await english.getByText("Review launch", { exact: true }).waitFor();
    await english.getByRole("link", { name: "Workspace", exact: true }).click();
    await englishInput.waitFor();
    assert.deepEqual(serviceRequests, []);
  } finally {
    await browser.close();
  }
});
