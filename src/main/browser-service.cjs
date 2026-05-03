const betaBrowser = require("./beta/browser-service-beta.cjs");

const USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[id*="email"]',
  'input[name="username"]',
  'input[id*="user"]',
  'input[name="login"]',
  'input[type="text"]'
];

const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  'input[id*="pass"]'
];

const VERIFICATION_CODE_SELECTORS = [
  'input[autocomplete="one-time-code"]',
  'input[name*="otp" i]',
  'input[id*="otp" i]',
  'input[name*="code" i]',
  'input[id*="code" i]',
  'input[placeholder*="code" i]',
  'input[placeholder*="인증" i]',
  'input[inputmode="numeric"]'
];

const CAPTCHA_CODE_SELECTORS = [
  'input[name*="captcha" i]',
  'input[id*="captcha" i]',
  'input[placeholder*="captcha" i]',
  'input[aria-label*="captcha" i]',
  'input[placeholder*="보안문자" i]',
  'input[aria-label*="보안문자" i]'
];

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button[name="login"]',
  'button[id*="login"]',
  'button[id*="sign"]'
];

const SEARCH_INPUT_SELECTORS = [
  'textarea[name="q"]',
  'input[name="q"]',
  'input[aria-label*="Search"]',
  'input[type="search"]'
];

const DETERMINISTIC_BROWSER_PLAN_ACTIONS = new Set([
  "open_url",
  "search_google",
  "search_youtube",
  "site_search",
  "login_saved",
  "click_text",
  "click_search_result",
  "read_page"
]);

class BrowserService extends betaBrowser.BaseBrowserService {
  supportsPlanStep(step = {}) {
    return DETERMINISTIC_BROWSER_PLAN_ACTIONS.has(String(step?.action || "").trim());
  }

  supportsPlanSteps(steps = []) {
    return Array.isArray(steps) && steps.every((step) => this.supportsPlanStep(step));
  }

  async snapshotPage(page) {
    return {
      url: page.url(),
      title: await page.title()
    };
  }

  async readPage(limit = 4000) {
    const page = await this.getPage();
    const text = await page.locator("body").innerText().catch(() => "");

    return {
      ...(await this.snapshotPage(page)),
      text: text.slice(0, limit)
    };
  }

  async fillFirst(page, selectors, value) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const count = await locator.count();

      if (count > 0) {
        await locator.fill(value);
        return selector;
      }
    }

    return null;
  }

  async clickFirst(page, selectors) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const count = await locator.count();

      if (count > 0) {
        await locator.click();
        return selector;
      }
    }

    return null;
  }

  async focusAndFillSearch(page, value) {
    for (const selector of SEARCH_INPUT_SELECTORS) {
      const locator = page.locator(selector).first();
      const count = await locator.count();

      if (count > 0) {
        await locator.click({ delay: 60 });
        await locator.fill("");
        await locator.type(value, { delay: 35 });
        return selector;
      }
    }

    return null;
  }

  async searchCurrentSite(query) {
    const page = await this.getPage();
    const selector = await this.focusAndFillSearch(page, query);

    if (!selector) {
      throw new Error("I could not find a visible search box on the current page.");
    }

    await page.keyboard.press("Enter");
    await Promise.race([
      page.waitForLoadState("networkidle", { timeout: 5000 }),
      page.waitForLoadState("domcontentloaded", { timeout: 5000 })
    ]).catch(() => {});

    return {
      ...(await this.snapshotPage(page)),
      searchEngine: "current-site",
      query
    };
  }

  async searchGoogle(query) {
    return this.navigate(`https://www.google.com/search?q=${encodeURIComponent(String(query || "").trim())}`);
  }

  async searchYouTube(query) {
    return this.navigate(`https://www.youtube.com/results?search_query=${encodeURIComponent(String(query || "").trim())}`);
  }

  async clickLinkText(text) {
    const page = await this.getPage();
    const locator = page.getByText(String(text || "").trim(), {
      exact: false
    }).first();
    await locator.click();
    await Promise.race([
      page.waitForLoadState("networkidle", { timeout: 5000 }),
      page.waitForLoadState("domcontentloaded", { timeout: 5000 })
    ]).catch(() => {});

    return this.observe();
  }

  async clickSearchResult(index = 1) {
    const page = await this.getPage();
    const resultIndex = Math.max(0, Number(index || 1) - 1);
    const links = page.locator("a[href]");
    const count = await links.count();

    if (count <= resultIndex) {
      throw new Error(`I could not find search result #${index}.`);
    }

    await links.nth(resultIndex).click();
    await Promise.race([
      page.waitForLoadState("networkidle", { timeout: 5000 }),
      page.waitForLoadState("domcontentloaded", { timeout: 5000 })
    ]).catch(() => {});

    return this.observe();
  }

  async executePlan(steps = []) {
    const executed = [];
    let lastSnapshot = null;

    for (const step of steps) {
      let data;

      if (step.action === "open_url") {
        data = await this.open(step.target);
      } else if (step.action === "search_google") {
        data = await this.searchGoogle(step.query);
      } else if (step.action === "search_youtube") {
        data = await this.searchYouTube(step.query);
      } else if (step.action === "site_search") {
        data = await this.searchCurrentSite(step.query);
      } else if (step.action === "login_saved") {
        data = await this.loginWithStoredCredential(step.target || step.siteOrUrl);
      } else if (step.action === "click_text") {
        data = await this.clickLinkText(step.text);
      } else if (step.action === "click_search_result") {
        data = await this.clickSearchResult(step.index);
      } else if (step.action === "read_page") {
        data = await this.readPage(step.limit || 4000);
      } else {
        throw new Error(`Unsupported browser step: ${step.action}`);
      }

      lastSnapshot = data;
      executed.push({
        ...step,
        result: data
      });
    }

    return {
      steps: executed,
      final: lastSnapshot
    };
  }

  async loginWithStoredCredential(siteOrUrl) {
    const credential = await this.credentialStore.getCredential(siteOrUrl);

    if (!credential) {
      throw new Error("No saved credential was found for that site.");
    }

    const page = await this.getPage();
    await page.goto(credential.loginUrl || betaBrowser.normalizeUrl(siteOrUrl), {
      waitUntil: "domcontentloaded"
    });

    const usernameSelector = await this.fillFirst(page, USERNAME_SELECTORS, credential.username);
    const passwordSelector = await this.fillFirst(page, PASSWORD_SELECTORS, credential.password);
    const submitSelector = await this.clickFirst(page, SUBMIT_SELECTORS);

    if (!usernameSelector || !passwordSelector) {
      throw new Error("The assistant opened the page, but it could not confidently find the login fields.");
    }

    return {
      ...(await this.snapshotPage(page)),
      site: credential.site,
      username: credential.username,
      usernameSelector,
      passwordSelector,
      submitSelector
    };
  }

  async fillCurrentLoginForm({
    siteOrUrl = "",
    loginUrl = "",
    username = "",
    password = "",
    submit = false
  } = {}) {
    if (!username || !password) {
      throw new Error("아이디와 비밀번호가 모두 필요해요.");
    }

    const page = await this.getPage();
    const currentUrl = page.url();
    const targetUrl = loginUrl || siteOrUrl || "";

    if ((!currentUrl || currentUrl === "about:blank") && targetUrl) {
      await page.goto(betaBrowser.normalizeUrl(targetUrl), {
        waitUntil: "domcontentloaded"
      });
    }

    const usernameSelector = await this.fillFirst(page, USERNAME_SELECTORS, username);
    const passwordSelector = await this.fillFirst(page, PASSWORD_SELECTORS, password);
    const submitSelector = submit ? await this.clickFirst(page, SUBMIT_SELECTORS) : null;

    if (!usernameSelector || !passwordSelector) {
      throw new Error("로그인 입력칸을 확실히 찾지 못했어요. 화면에서 로그인 칸을 한 번 눌러 둔 뒤 다시 시도해 주세요.");
    }

    await page.waitForTimeout(600);

    return {
      ...(await this.snapshotPage(page)),
      site: siteOrUrl || page.url(),
      username,
      usernameSelector,
      passwordSelector,
      submitSelector,
      submitted: Boolean(submitSelector)
    };
  }

  async fillVerificationCode({
    code = "",
    kind = "verification",
    submit = false
  } = {}) {
    const cleanCode = String(code || "").trim();
    if (!cleanCode) {
      throw new Error("입력할 인증 코드가 필요해요.");
    }

    const page = await this.getPage();
    const selectors = kind === "captcha"
      ? [...CAPTCHA_CODE_SELECTORS, ...VERIFICATION_CODE_SELECTORS]
      : [...VERIFICATION_CODE_SELECTORS, ...CAPTCHA_CODE_SELECTORS];
    const codeSelector = await this.fillFirst(page, selectors, cleanCode);
    const submitSelector = submit ? await this.clickFirst(page, SUBMIT_SELECTORS) : null;

    if (!codeSelector) {
      throw new Error("인증 코드 입력칸을 찾지 못했어요. 입력칸을 한 번 클릭한 뒤 다시 시도해 주세요.");
    }

    await page.waitForTimeout(600);

    return {
      ...(await this.snapshotPage(page)),
      kind,
      codeSelector,
      submitSelector,
      submitted: Boolean(submitSelector)
    };
  }
}

module.exports = {
  ...betaBrowser,
  BrowserService
};
