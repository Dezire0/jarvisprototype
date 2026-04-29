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

class BrowserService extends betaBrowser.BrowserService {
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
}

module.exports = {
  ...betaBrowser,
  BrowserService
};
