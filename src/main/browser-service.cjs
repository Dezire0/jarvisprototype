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

const LOGIN_ENTRYPOINT_PATTERN =
  /(sign\s*in|log\s*in|login|로그인|로그\s*인|사인인|계정\s*로그인|account\s*login|continue\s+with|use\s+another\s+account)/i;
const LOGIN_ENTRYPOINT_EXCLUDE_PATTERN =
  /(sign\s*out|log\s*out|logout|로그아웃|회원가입|sign\s*up|signup|register|create\s+account|join|가입|새\s*계정)/i;

const LOGIN_URL_PATHS = [
  "/login",
  "/signin",
  "/sign-in",
  "/log-in",
  "/session/new",
  "/users/sign_in",
  "/auth/login",
  "/account/login",
  "/accounts/login"
];

const LOGIN_CONTINUE_SELECTORS = [
  'button:has-text("Next")',
  'button:has-text("Continue")',
  'button:has-text("다음")',
  'button:has-text("계속")',
  'button:has-text("확인")',
  'input[type="submit"][value*="Next" i]',
  'input[type="submit"][value*="Continue" i]',
  'button[type="submit"]',
  'input[type="submit"]'
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
  'button[id*="sign"]',
  'button:has-text("Sign in")',
  'button:has-text("Log in")',
  'button:has-text("Login")',
  'button:has-text("로그인")',
  'button:has-text("계속")',
  'button:has-text("다음")',
  'input[type="submit"][value*="Sign in" i]',
  'input[type="submit"][value*="Log in" i]',
  'input[type="submit"][value*="Login" i]'
];

const SEARCH_INPUT_SELECTORS = [
  'textarea[name="q"]',
  'input[name="q"]',
  'input[aria-label*="Search"]',
  'input[type="search"]'
];

async function markBestMailboxItem(page) {
  return page.evaluate(() => {
    document.querySelectorAll("[data-jarvis-mail-target]").forEach((node) => {
      node.removeAttribute("data-jarvis-mail-target");
    });

    const selectors = [
      "[role='main'] [role='option']",
      "[role='main'] [role='link']",
      "[role='main'] tr",
      "[role='main'] article",
      "main [role='option']",
      "main a",
      "main tr",
      "main article",
      "main li"
    ];
    const ignorePattern = /(inbox|compose|drafts|sent|spam|trash|starred|archive|settings|메일함|받은편지함|보낸편지함|임시보관함|스팸|휴지통|설정)/i;
    const nodes = Array.from(document.querySelectorAll(selectors.join(",")));
    let bestNode = null;
    let bestScore = -Infinity;

    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();

      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        continue;
      }

      if (rect.width === 0 || rect.height === 0 || rect.bottom < 80 || rect.top > window.innerHeight) {
        continue;
      }

      if (text.length < 8 || ignorePattern.test(text)) {
        continue;
      }

      let score = 10000 - rect.top;

      if (node.matches("[role='option'], tr, article")) {
        score += 120;
      }

      if (node.matches("a[href]")) {
        score += 80;
      }

      if (text.length >= 18 && text.length <= 220) {
        score += 40;
      }

      if (/unread|읽지 않음|새 메일|new/i.test(text)) {
        score += 60;
      }

      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    if (!bestNode) {
      return null;
    }

    bestNode.setAttribute("data-jarvis-mail-target", "latest");
    return {
      text: (bestNode.innerText || bestNode.textContent || "").replace(/\s+/g, " ").trim()
    };
  });
}

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
    const match = await this.findFirst(page, selectors);

    if (match) {
      await match.locator.fill(value);
      return match.selector;
    }

    return null;
  }

  async clickFirst(page, selectors) {
    const match = await this.findFirst(page, selectors);

    if (match) {
      await match.locator.click();
      return match.selector;
    }

    return null;
  }

  async findFirst(page, selectors, { visible = true } = {}) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const count = await locator.count().catch(() => 0);

      if (count > 0) {
        if (visible && typeof locator.isVisible === "function") {
          const isVisible = await locator.isVisible().catch(() => false);

          if (!isVisible) {
            continue;
          }
        }

        return {
          selector,
          locator
        };
      }
    }

    return null;
  }

  async waitForLoginInputs(page, timeout = 2500) {
    const startedAt = Date.now();
    let lastState = {
      hasUsername: false,
      hasStrongUsername: false,
      hasPassword: false,
      usernameSelector: "",
      passwordSelector: ""
    };

    while (Date.now() - startedAt <= timeout) {
      const username = await this.findFirst(page, USERNAME_SELECTORS).catch(() => null);
      const password = await this.findFirst(page, PASSWORD_SELECTORS).catch(() => null);
      lastState = {
        hasUsername: Boolean(username),
        hasStrongUsername: Boolean(username && username.selector !== 'input[type="text"]'),
        hasPassword: Boolean(password),
        usernameSelector: username?.selector || "",
        passwordSelector: password?.selector || ""
      };

      if (this.hasConfidentLoginInput(lastState)) {
        return lastState;
      }

      await page.waitForTimeout?.(250).catch(() => {});
    }

    return lastState;
  }

  hasConfidentLoginInput(inputState = {}) {
    return Boolean(inputState.hasPassword || inputState.hasStrongUsername);
  }

  buildLoginUrlCandidates(currentUrl = "", targetUrl = "") {
    const urls = [];
    const push = (value) => {
      try {
        const url = new URL(value);
        if (!urls.includes(url.href)) {
          urls.push(url.href);
        }
      } catch (_error) {
        // Ignore malformed candidates.
      }
    };

    const sourceUrls = [targetUrl, currentUrl].filter(Boolean);

    for (const sourceUrl of sourceUrls) {
      let parsed;

      try {
        parsed = new URL(betaBrowser.normalizeUrl(sourceUrl));
      } catch (_error) {
        continue;
      }

      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      const origin = parsed.origin;

      if (/github\.com$/.test(host)) {
        push("https://github.com/login");
      } else if (/amazon\.[a-z.]+$/.test(host)) {
        push("https://www.amazon.com/ap/signin");
      } else if (/(google\.com|youtube\.com)$/.test(host)) {
        push("https://accounts.google.com/");
      } else if (/(x\.com|twitter\.com)$/.test(host)) {
        push("https://x.com/i/flow/login");
      } else if (/naver\.com$/.test(host)) {
        push("https://nid.naver.com/nidlogin.login");
      } else if (/kakao\.com$/.test(host)) {
        push("https://accounts.kakao.com/login");
      }

      for (const pathname of LOGIN_URL_PATHS) {
        push(`${origin}${pathname}`);
      }
    }

    return urls;
  }

  async tagLoginEntrypoints(page) {
    if (typeof page.evaluate !== "function") {
      return [];
    }

    return page.evaluate(
      ({ patternSource, patternFlags, excludeSource, excludeFlags }) => {
        const pattern = new RegExp(patternSource, patternFlags);
        const excludePattern = new RegExp(excludeSource, excludeFlags);
        const candidates = [];
        const elements = Array.from(
          document.querySelectorAll("a[href], button, input[type='button'], input[type='submit'], [role='button'], [onclick]")
        );

        for (const element of elements) {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);

          if (
            rect.width < 4 ||
            rect.height < 4 ||
            style.visibility === "hidden" ||
            style.display === "none" ||
            Number(style.opacity || 1) === 0
          ) {
            continue;
          }

          const href = element.getAttribute("href") || "";
          const label = [
            element.innerText,
            element.textContent,
            element.getAttribute("aria-label"),
            element.getAttribute("title"),
            element.getAttribute("name"),
            element.getAttribute("id"),
            element.getAttribute("value"),
            href
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

          if (!label || excludePattern.test(label) || !pattern.test(label)) {
            continue;
          }

          let score = 0;
          if (/(^|\b)(sign\s*in|log\s*in|login|로그인)(\b|$)/i.test(label)) score += 5;
          if (/\/(login|signin|sign-in|session\/new|users\/sign_in)(?:[/?#]|$)/i.test(href)) score += 4;
          if (/account|auth|session|계정/i.test(label)) score += 1;
          if (element.tagName.toLowerCase() === "a") score += 1;

          const id = `login-${candidates.length}`;
          element.setAttribute("data-jarvis-login-entrypoint", id);
          candidates.push({
            id,
            label: label.slice(0, 140),
            href,
            score
          });
        }

        return candidates.sort((left, right) => right.score - left.score).slice(0, 8);
      },
      {
        patternSource: LOGIN_ENTRYPOINT_PATTERN.source,
        patternFlags: LOGIN_ENTRYPOINT_PATTERN.flags,
        excludeSource: LOGIN_ENTRYPOINT_EXCLUDE_PATTERN.source,
        excludeFlags: LOGIN_ENTRYPOINT_EXCLUDE_PATTERN.flags
      }
    ).catch(() => []);
  }

  async clickBestLoginEntrypoint(page) {
    const candidates = await this.tagLoginEntrypoints(page);

    for (const candidate of candidates) {
      const locator = page.locator(`[data-jarvis-login-entrypoint="${candidate.id}"]`).first();
      const count = await locator.count().catch(() => 0);

      if (!count) {
        continue;
      }

      await locator.scrollIntoViewIfNeeded?.().catch(() => {});

      try {
        await locator.click({ timeout: 5000 });
      } catch (_error) {
        continue;
      }

      await Promise.race([
        page.waitForLoadState("networkidle", { timeout: 5000 }),
        page.waitForLoadState("domcontentloaded", { timeout: 5000 })
      ]).catch(() => {});
      await page.waitForTimeout?.(700).catch(() => {});
      return candidate;
    }

    return null;
  }

  async ensureLoginFormVisible(page, targetUrl = "") {
    const attempts = [];
    const currentUrl = page.url?.() || "";

    if ((!currentUrl || currentUrl === "about:blank") && targetUrl) {
      const normalizedTarget = betaBrowser.normalizeUrl(targetUrl);
      await page.goto(normalizedTarget, {
        waitUntil: "domcontentloaded"
      });
      attempts.push({
        method: "open-target",
        url: normalizedTarget
      });
    }

    let inputs = await this.waitForLoginInputs(page, 1500);

    if (this.hasConfidentLoginInput(inputs)) {
      return {
        found: true,
        method: "existing-form",
        attempts,
        ...inputs
      };
    }

    const clicked = await this.clickBestLoginEntrypoint(page);

    if (clicked) {
      attempts.push({
        method: "click-login-entrypoint",
        label: clicked.label,
        href: clicked.href || ""
      });
      inputs = await this.waitForLoginInputs(page, 5000);

      if (this.hasConfidentLoginInput(inputs)) {
        return {
          found: true,
          method: "clicked-login-entrypoint",
          attempts,
          ...inputs
        };
      }
    }

    const afterClickUrl = page.url?.() || "";
    const directUrls = this.buildLoginUrlCandidates(afterClickUrl, targetUrl);

    for (const loginUrl of directUrls) {
      if (loginUrl === afterClickUrl) {
        continue;
      }

      try {
        await page.goto(loginUrl, {
          waitUntil: "domcontentloaded",
          timeout: 10000
        });
        attempts.push({
          method: "login-url-candidate",
          url: loginUrl
        });
        inputs = await this.waitForLoginInputs(page, 3000);

        if (this.hasConfidentLoginInput(inputs)) {
          return {
            found: true,
            method: "login-url-candidate",
            loginUrl,
            attempts,
            ...inputs
          };
        }
      } catch (error) {
        attempts.push({
          method: "login-url-candidate",
          url: loginUrl,
          error: error.message
        });
      }
    }

    return {
      found: false,
      method: "",
      attempts,
      ...inputs
    };
  }

  async fillLoginCredentials(page, { username = "", password = "", submit = false } = {}) {
    let usernameSelector = username ? await this.fillFirst(page, USERNAME_SELECTORS, username) : null;
    let passwordSelector = password ? await this.fillFirst(page, PASSWORD_SELECTORS, password) : null;
    let intermediateSelector = null;

    if (usernameSelector && password && !passwordSelector) {
      intermediateSelector = await this.clickFirst(page, LOGIN_CONTINUE_SELECTORS);

      if (intermediateSelector) {
        await this.waitForLoginInputs(page, 5000);
        passwordSelector = await this.fillFirst(page, PASSWORD_SELECTORS, password);
      }
    }

    const submitSelector = submit && passwordSelector ? await this.clickFirst(page, SUBMIT_SELECTORS) : null;

    return {
      usernameSelector,
      passwordSelector,
      intermediateSelector,
      submitSelector
    };
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

  async openLatestMailboxMessage() {
    const page = await this.getPage();
    const marked = await markBestMailboxItem(page);

    if (!marked) {
      throw new Error("Could not find a visible latest message item in the current mailbox.");
    }

    const locator = page.locator("[data-jarvis-mail-target='latest']").first();
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click({ timeout: 5000 });
    await Promise.race([
      page.waitForLoadState("networkidle", { timeout: 5000 }),
      page.waitForLoadState("domcontentloaded", { timeout: 5000 })
    ]).catch(() => {});

    return {
      ...(await this.observe()),
      openedMailboxItem: marked.text
    };
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
    const targetUrl = credential.loginUrl || betaBrowser.normalizeUrl(siteOrUrl);
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded"
    });

    const loginForm = await this.ensureLoginFormVisible(page, targetUrl);
    const {
      usernameSelector,
      passwordSelector,
      intermediateSelector,
      submitSelector
    } = await this.fillLoginCredentials(page, {
      username: credential.username,
      password: credential.password,
      submit: true
    });

    if (!passwordSelector) {
      throw new Error("The assistant opened the login area, but it could not confidently find the password field.");
    }

    return {
      ...(await this.snapshotPage(page)),
      site: credential.site,
      username: credential.username,
      usernameSelector,
      passwordSelector,
      intermediateSelector,
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

    const loginForm = await this.ensureLoginFormVisible(page, targetUrl);
    const {
      usernameSelector,
      passwordSelector,
      intermediateSelector,
      submitSelector
    } = await this.fillLoginCredentials(page, {
      username,
      password,
      submit
    });

    if (!passwordSelector) {
      const tried = loginForm.attempts
        ?.map((attempt) => attempt.label || attempt.url || attempt.method)
        .filter(Boolean)
        .slice(0, 3)
        .join(", ");
      throw new Error(
        tried
          ? `로그인 화면으로 이동하려고 ${tried} 등을 시도했지만 비밀번호 입력칸을 확실히 찾지 못했어요.`
          : "로그인 화면으로 이동했지만 비밀번호 입력칸을 확실히 찾지 못했어요."
      );
    }

    await page.waitForTimeout(600);

    return {
      ...(await this.snapshotPage(page)),
      site: siteOrUrl || page.url(),
      username,
      usernameSelector,
      passwordSelector,
      intermediateSelector,
      submitSelector,
      loginNavigation: loginForm,
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
