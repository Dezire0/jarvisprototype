const fs = require("node:fs/promises");
const path = require("node:path");
const { homedir, platform } = require("node:os");
const { chromium } = require("playwright");

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

function normalizeUrl(input = "") {
  const value = String(input).trim();

  if (!value) {
    throw new Error("A URL or search query is required.");
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (/^[\w.-]+\.[a-z]{2,}/i.test(value)) {
    return `https://${value}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function resolveHomePath(targetPath = "") {
  return String(targetPath).replace(/^~(?=$|\/)/, homedir());
}

function looksLikeChromeProfileDirectory(targetPath = "") {
  return /^(Default|Profile \d+|Guest Profile|Person \d+)$/i.test(path.basename(targetPath));
}

async function readJson(targetPath) {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

async function getMtimeMs(targetPath) {
  try {
    const stats = await fs.stat(targetPath);
    return stats.mtimeMs;
  } catch (_error) {
    return 0;
  }
}

function shouldCopyChromeProfileEntry(sourcePath = "") {
  const blockedNames = new Set([
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnCache",
    "GrShaderCache",
    "ShaderCache",
    "Crashpad",
    "Crash Reports",
    "Sessions",
    "Session Storage",
    "Current Session",
    "Current Tabs",
    "Last Session",
    "Last Tabs",
    "SingletonCookie",
    "SingletonLock",
    "SingletonSocket"
  ]);

  return !blockedNames.has(path.basename(sourcePath));
}

async function writeJson(targetPath, value) {
  await fs.writeFile(targetPath, JSON.stringify(value, null, 2), "utf8");
}

async function sanitizeChromeLocalState(targetPath) {
  const data = await readJson(targetPath);

  if (!data || typeof data !== "object") {
    return;
  }

  if (data.browser && typeof data.browser === "object") {
    delete data.browser.window_placement;
    delete data.browser.last_redirect_origin;
  }

  await writeJson(targetPath, data);
}

async function sanitizeChromeProfilePreferences(targetPath) {
  const data = await readJson(targetPath);

  if (!data || typeof data !== "object") {
    return;
  }

  if (data.browser && typeof data.browser === "object") {
    delete data.browser.window_placement;
  }

  if (data.profile && typeof data.profile === "object") {
    data.profile.exited_cleanly = true;
    data.profile.exit_type = "Normal";
  }

  delete data.session;

  await writeJson(targetPath, data);
}

async function syncChromeProfileCopy(sourceRoot, profileDirectory, destRoot) {
  if (!profileDirectory) {
    return null;
  }

  const sourceProfileDir = path.join(sourceRoot, profileDirectory);
  const destProfileDir = path.join(destRoot, profileDirectory);

  if (!(await pathExists(sourceProfileDir))) {
    return null;
  }

  const sourceLocalState = path.join(sourceRoot, "Local State");
  const destLocalState = path.join(destRoot, "Local State");
  const sourceCookies = path.join(sourceProfileDir, "Cookies");
  const destCookies = path.join(destProfileDir, "Cookies");
  const needsSync =
    !(await pathExists(destProfileDir)) ||
    (await getMtimeMs(sourceLocalState)) > (await getMtimeMs(destLocalState)) ||
    (await getMtimeMs(sourceCookies)) > (await getMtimeMs(destCookies));

  if (needsSync) {
    await fs.mkdir(destRoot, {
      recursive: true
    });

    if (await pathExists(sourceLocalState)) {
      await fs.copyFile(sourceLocalState, destLocalState);
      await sanitizeChromeLocalState(destLocalState).catch(() => {});
    }

    await fs.rm(destProfileDir, {
      recursive: true,
      force: true
    });

    await fs.cp(sourceProfileDir, destProfileDir, {
      recursive: true,
      force: true,
      filter(sourcePath) {
        return shouldCopyChromeProfileEntry(sourcePath);
      }
    });

    await sanitizeChromeProfilePreferences(path.join(destProfileDir, "Preferences")).catch(() => {});
    await sanitizeChromeProfilePreferences(path.join(destProfileDir, "Secure Preferences")).catch(() => {});
  }

  return {
    userDataDir: destRoot,
    profileDirectory
  };
}

async function resolveChromeProfileDirectory(userDataDir) {
  const configuredProfile = String(process.env.JARVIS_BROWSER_PROFILE_NAME || "").trim();

  if (configuredProfile) {
    return configuredProfile;
  }

  const localState = await readJson(path.join(userDataDir, "Local State"));
  const lastUsed = String(localState?.profile?.last_used || "").trim();

  if (lastUsed && (await pathExists(path.join(userDataDir, lastUsed)))) {
    return lastUsed;
  }

  const defaultCandidates = ["Default", "Profile 1", "Profile 2"];

  for (const candidate of defaultCandidates) {
    if (await pathExists(path.join(userDataDir, candidate))) {
      return candidate;
    }
  }

  return "";
}

class BrowserService {
  constructor({ userDataDir, credentialStore }) {
    this.savedProfileDir = path.join(userDataDir, "browser-profile");
    this.testingProfileDir = path.join(userDataDir, "playwright-profile");
    this.credentialStore = credentialStore;
    this.context = null;
    this.page = null;
    this.launchProfile = {
      label: "playwright fallback",
      mode: "testing-fallback"
    };
  }

  getCommonLaunchOptions() {
    const headless = process.env.JARVIS_HEADLESS === "1";

    return {
      headless,
      viewport: headless ? { width: 1440, height: 960 } : null,
      ignoreHTTPSErrors: true
    };
  }

  buildLaunchAttempt({
    label,
    mode,
    userDataDir,
    channel = "",
    executablePath = "",
    profileDirectory = "",
    prepare = null
  }) {
    const options = {
      ...this.getCommonLaunchOptions()
    };
    const args = [
      "--new-window",
      "--window-position=96,96",
      "--window-size=1280,900",
      "--disable-session-crashed-bubble"
    ];

    if (channel) {
      options.channel = channel;
    }

    if (executablePath) {
      options.executablePath = executablePath;
    }

    if (profileDirectory) {
      args.push(`--profile-directory=${profileDirectory}`);
    }

    options.args = args;

    return {
      label,
      mode,
      userDataDir,
      profileDirectory,
      prepare,
      launchOptions: options
    };
  }

  async resolvePreferredLaunchAttempts() {
    const attempts = [];
    const configuredProfilePath = resolveHomePath(process.env.JARVIS_BROWSER_PROFILE_DIR || "");
    const systemChromeRoot =
      platform() === "darwin"
        ? path.join(homedir(), "Library/Application Support/Google/Chrome")
        : "";

    if (configuredProfilePath && (await pathExists(configuredProfilePath))) {
      const userDataDir = looksLikeChromeProfileDirectory(configuredProfilePath)
        ? path.dirname(configuredProfilePath)
        : configuredProfilePath;
      const profileDirectory = looksLikeChromeProfileDirectory(configuredProfilePath)
        ? path.basename(configuredProfilePath)
        : await resolveChromeProfileDirectory(configuredProfilePath);

      attempts.push(
        this.buildLaunchAttempt({
          label: "configured Chrome profile",
          mode: "configured-profile",
          userDataDir,
          channel: "chrome",
          profileDirectory
        })
      );
    }

    if (systemChromeRoot && (await pathExists(systemChromeRoot))) {
      const profileDirectory = await resolveChromeProfileDirectory(systemChromeRoot);

      attempts.push(
        this.buildLaunchAttempt({
          label: "mirrored Google Chrome profile",
          mode: "mirrored-system-profile",
          userDataDir: this.savedProfileDir,
          channel: "chrome",
          profileDirectory,
          prepare: async () => syncChromeProfileCopy(systemChromeRoot, profileDirectory, this.savedProfileDir)
        })
      );

      attempts.push(
        this.buildLaunchAttempt({
          label: "saved Google Chrome profile",
          mode: "system-profile",
          userDataDir: systemChromeRoot,
          channel: "chrome",
          profileDirectory
        })
      );
    }

    attempts.push(
      this.buildLaunchAttempt({
        label: "saved Jarvis browser profile",
        mode: "jarvis-profile",
        userDataDir: this.savedProfileDir,
        channel: "chrome"
      })
    );

    attempts.push(
      this.buildLaunchAttempt({
        label: "Playwright bundled browser",
        mode: "testing-fallback",
        userDataDir: this.testingProfileDir
      })
    );

    return attempts;
  }

  async ensureContext() {
    if (this.context) {
      return this.context;
    }

    const attempts = await this.resolvePreferredLaunchAttempts();
    const errors = [];

    for (const attempt of attempts) {
      try {
        const prepared = attempt.prepare ? await attempt.prepare() : null;
        const launchOptions = {
          ...attempt.launchOptions
        };
        const userDataDir = prepared?.userDataDir || attempt.userDataDir;
        const profileDirectory = prepared?.profileDirectory || attempt.profileDirectory;

        if (profileDirectory) {
          const existingArgs = Array.isArray(launchOptions.args) ? launchOptions.args.filter((arg) => !/^--profile-directory=/.test(arg)) : [];
          launchOptions.args = [...existingArgs, `--profile-directory=${profileDirectory}`];
        }

        this.context = await chromium.launchPersistentContext(
          userDataDir,
          launchOptions
        );
        this.launchProfile = {
          label: attempt.label,
          mode: attempt.mode,
          userDataDir,
          profileDirectory: profileDirectory || ""
        };

        this.context.on("close", () => {
          this.context = null;
          this.page = null;
        });

        return this.context;
      } catch (error) {
        errors.push(`${attempt.label}: ${String(error.message || error).trim()}`);
      }
    }

    throw new Error(
      `Could not start browser automation with any available profile. ${errors.join(" | ")}`
    );
  }

  async getPage() {
    const context = await this.ensureContext();

    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    const existingPages = context.pages();

    for (const existingPage of existingPages) {
      await existingPage.close().catch(() => {});
    }

    this.page = await context.newPage();
    return this.page;
  }

  getProviderLabel() {
    if (
      this.launchProfile.mode === "system-profile" ||
      this.launchProfile.mode === "configured-profile" ||
      this.launchProfile.mode === "mirrored-system-profile"
    ) {
      return "google-chrome saved profile";
    }

    if (this.launchProfile.mode === "jarvis-profile") {
      return "google-chrome jarvis profile";
    }

    return "playwright bundled browser";
  }

  async status() {
    await this.ensureContext().catch(() => {});

    return {
      provider: this.getProviderLabel(),
      ...this.launchProfile
    };
  }

  async peekStatus() {
    const pageActive = Boolean(this.page && !this.page.isClosed());
    let currentPage = null;

    if (pageActive) {
      currentPage = {
        url: this.page.url(),
        title: await this.page.title().catch(() => "")
      };
    }

    return {
      provider: this.getProviderLabel(),
      contextActive: Boolean(this.context),
      pageActive,
      currentPage,
      ...this.launchProfile
    };
  }

  async snapshotPage(page) {
    return {
      url: page.url(),
      title: await page.title()
    };
  }

  async open(target) {
    const page = await this.getPage();
    await page.goto(normalizeUrl(target), {
      waitUntil: "domcontentloaded"
    });
    return this.snapshotPage(page);
  }

  async search(query) {
    return this.searchGoogle(query);
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
        await locator.click({
          delay: 60
        });
        await locator.fill("");
        await locator.type(value, {
          delay: 35
        });
        return selector;
      }
    }

    return null;
  }

  async searchGoogle(query) {
    const page = await this.getPage();
    await page.goto("https://www.google.com/", {
      waitUntil: "domcontentloaded"
    });

    const selector = await this.focusAndFillSearch(page, query);

    if (!selector) {
      throw new Error("Google search box was not found.");
    }

    await page.keyboard.press("Enter");
    await Promise.race([
      page.waitForURL(/google\.[^/]+\/search/i, { timeout: 5000 }),
      page.waitForLoadState("networkidle", { timeout: 5000 })
    ]).catch(() => {});

    return {
      ...(await this.snapshotPage(page)),
      searchEngine: "google",
      query
    };
  }

  async searchYouTube(query) {
    const page = await this.getPage();
    await page.goto("https://www.youtube.com/", {
      waitUntil: "domcontentloaded"
    });

    const selector = await this.focusAndFillSearch(page, query);

    if (!selector) {
      const fallback = page.locator('input[name="search_query"]').first();
      const count = await fallback.count();

      if (!count) {
        throw new Error("YouTube search box was not found.");
      }

      await fallback.click();
      await fallback.fill("");
      await fallback.type(query, {
        delay: 35
      });
    }

    await page.keyboard.press("Enter");
    await Promise.race([
      page.waitForURL(/youtube\.com\/results/i, { timeout: 5000 }),
      page.waitForLoadState("networkidle", { timeout: 5000 })
    ]).catch(() => {});

    return {
      ...(await this.snapshotPage(page)),
      searchEngine: "youtube",
      query
    };
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

  async clickLinkText(text) {
    const page = await this.getPage();
    const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matchers = [
      page.getByRole("link", { name: new RegExp(escapedText, "i") }).first(),
      page.getByText(new RegExp(escapedText, "i")).first()
    ];

    for (const locator of matchers) {
      const count = await locator.count().catch(() => 0);

      if (count > 0) {
        await locator.waitFor({
          state: "visible",
          timeout: 5000
        }).catch(() => {});
        await locator.click();
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        return {
          ...(await this.snapshotPage(page)),
          clickedText: text
        };
      }
    }

    throw new Error(`Could not find a link or visible text matching "${text}".`);
  }

  async clickSearchResult(index = 1) {
    const page = await this.getPage();
    const resultIndex = Math.max(1, Number(index) || 1) - 1;
    const googleResults = page.locator("a").filter({
      has: page.locator("h3")
    });
    const googleCount = await googleResults.count();

    if (googleCount > resultIndex) {
      const link = googleResults.nth(resultIndex);
      const title = await link.innerText().catch(() => "");
      await link.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return {
        ...(await this.snapshotPage(page)),
        clickedText: title || `search-result-${index}`,
        resultIndex: index
      };
    }

    const anyLinks = page.locator("a[href]");
    const linkCount = await anyLinks.count();

    if (linkCount > resultIndex) {
      const link = anyLinks.nth(resultIndex);
      const title = await link.innerText().catch(() => "");
      await link.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return {
        ...(await this.snapshotPage(page)),
        clickedText: title || `link-${index}`,
        resultIndex: index
      };
    }

    throw new Error("No clickable search result was found.");
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
    await page.goto(credential.loginUrl || normalizeUrl(siteOrUrl), {
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

  async clickText(text) {
    return this.clickLinkText(text);
  }
}

module.exports = {
  BrowserService,
  normalizeUrl
};
