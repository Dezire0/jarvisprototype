const fs = require("node:fs/promises");
const path = require("node:path");
const { homedir, platform } = require("node:os");
const { chromium } = require("playwright");

// ─── URL Utilities ───────────────────────────────────────────────────────────

function normalizeUrl(input = "") {
  const value = String(input).trim();
  if (!value) throw new Error("A URL or search query is required.");
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

// ─── Chrome Profile Utilities (preserved from v1) ────────────────────────────

async function pathExists(targetPath) {
  try { await fs.access(targetPath); return true; } catch { return false; }
}

function resolveHomePath(targetPath = "") {
  return String(targetPath).replace(/^~(?=$|\/)/, homedir());
}

function looksLikeChromeProfileDirectory(targetPath = "") {
  return /^(Default|Profile \d+|Guest Profile|Person \d+)$/i.test(path.basename(targetPath));
}

async function readJson(targetPath) {
  try { return JSON.parse(await fs.readFile(targetPath, "utf8")); } catch { return null; }
}

async function getMtimeMs(targetPath) {
  try { return (await fs.stat(targetPath)).mtimeMs; } catch { return 0; }
}

function shouldCopyChromeProfileEntry(sourcePath = "") {
  const blocked = new Set([
    "Cache","Code Cache","GPUCache","DawnCache","GrShaderCache","ShaderCache",
    "Crashpad","Crash Reports","Sessions","Session Storage","Current Session",
    "Current Tabs","Last Session","Last Tabs","SingletonCookie","SingletonLock","SingletonSocket"
  ]);
  return !blocked.has(path.basename(sourcePath));
}

async function writeJson(targetPath, value) {
  await fs.writeFile(targetPath, JSON.stringify(value, null, 2), "utf8");
}

async function sanitizeChromeLocalState(targetPath) {
  const data = await readJson(targetPath);
  if (!data || typeof data !== "object") return;
  if (data.browser && typeof data.browser === "object") {
    delete data.browser.window_placement;
    delete data.browser.last_redirect_origin;
  }
  await writeJson(targetPath, data);
}

async function sanitizeChromeProfilePreferences(targetPath) {
  const data = await readJson(targetPath);
  if (!data || typeof data !== "object") return;
  if (data.browser && typeof data.browser === "object") delete data.browser.window_placement;
  if (data.profile && typeof data.profile === "object") {
    data.profile.exited_cleanly = true;
    data.profile.exit_type = "Normal";
  }
  delete data.session;
  await writeJson(targetPath, data);
}

async function syncChromeProfileCopy(sourceRoot, profileDirectory, destRoot) {
  if (!profileDirectory) return null;
  const sourceProfileDir = path.join(sourceRoot, profileDirectory);
  const destProfileDir = path.join(destRoot, profileDirectory);
  if (!(await pathExists(sourceProfileDir))) return null;

  const sourceLocalState = path.join(sourceRoot, "Local State");
  const destLocalState = path.join(destRoot, "Local State");
  const sourceCookies = path.join(sourceProfileDir, "Cookies");
  const destCookies = path.join(destProfileDir, "Cookies");
  const needsSync =
    !(await pathExists(destProfileDir)) ||
    (await getMtimeMs(sourceLocalState)) > (await getMtimeMs(destLocalState)) ||
    (await getMtimeMs(sourceCookies)) > (await getMtimeMs(destCookies));

  if (needsSync) {
    await fs.mkdir(destRoot, { recursive: true });
    if (await pathExists(sourceLocalState)) {
      await fs.copyFile(sourceLocalState, destLocalState);
      await sanitizeChromeLocalState(destLocalState).catch(() => {});
    }
    await fs.rm(destProfileDir, { recursive: true, force: true });
    await fs.cp(sourceProfileDir, destProfileDir, {
      recursive: true, force: true,
      filter(sourcePath) { return shouldCopyChromeProfileEntry(sourcePath); }
    });
    await sanitizeChromeProfilePreferences(path.join(destProfileDir, "Preferences")).catch(() => {});
    await sanitizeChromeProfilePreferences(path.join(destProfileDir, "Secure Preferences")).catch(() => {});
  }
  return { userDataDir: destRoot, profileDirectory };
}

async function resolveChromeProfileDirectory(userDataDir) {
  const configured = String(process.env.JARVIS_BROWSER_PROFILE_NAME || "").trim();
  if (configured) return configured;
  const localState = await readJson(path.join(userDataDir, "Local State"));
  const lastUsed = String(localState?.profile?.last_used || "").trim();
  if (lastUsed && (await pathExists(path.join(userDataDir, lastUsed)))) return lastUsed;
  for (const c of ["Default", "Profile 1", "Profile 2"]) {
    if (await pathExists(path.join(userDataDir, c))) return c;
  }
  return "";
}

// ─── DOM Tagging ─────────────────────────────────────────────────────────────

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='combobox']",
  "[role='searchbox']",
  "[role='textbox']",
  "[onclick]",
  "[contenteditable='true']"
].join(", ");

/**
 * Inject numbered labels onto every interactive element and return a mapping table.
 * Returns: { elements: [{id, tag, type, role, text, placeholder, href, ariaLabel, value}], totalCount }
 */
async function tagInteractiveElements(page) {
  // Remove previous tags if any
  await page.evaluate(() => {
    document.querySelectorAll("[data-jarvis-tag-overlay]").forEach(el => el.remove());
    document.querySelectorAll("[data-jarvis-id]").forEach(el => el.removeAttribute("data-jarvis-id"));
  });

  const elements = await page.evaluate((selector) => {
    const nodes = Array.from(document.querySelectorAll(selector));
    const results = [];
    let idCounter = 1;

    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      // Skip invisible elements
      if (rect.width === 0 && rect.height === 0) continue;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      // Skip if off-screen
      if (rect.bottom < 0 || rect.top > window.innerHeight + 200) continue;

      const id = idCounter++;
      node.setAttribute("data-jarvis-id", String(id));

      // Create visual overlay label
      const overlay = document.createElement("span");
      overlay.setAttribute("data-jarvis-tag-overlay", "true");
      overlay.textContent = `[${id}]`;
      overlay.style.cssText = [
        "position:fixed", `top:${Math.max(0, rect.top - 14)}px`, `left:${Math.max(0, rect.left)}px`,
        "background:#ff6600", "color:#fff", "font-size:10px", "font-weight:bold",
        "padding:1px 3px", "border-radius:3px", "z-index:999999", "pointer-events:none",
        "line-height:12px", "font-family:monospace"
      ].join(";");
      document.body.appendChild(overlay);

      const text = (node.innerText || node.textContent || "").trim().slice(0, 80);
      results.push({
        id,
        tag: node.tagName.toLowerCase(),
        type: node.getAttribute("type") || "",
        role: node.getAttribute("role") || "",
        text,
        placeholder: node.getAttribute("placeholder") || "",
        href: node.getAttribute("href") || "",
        ariaLabel: node.getAttribute("aria-label") || "",
        value: (node.value || "").slice(0, 40),
        name: node.getAttribute("name") || ""
      });

      if (idCounter > 120) break; // Cap to avoid overwhelming the AI
    }
    return results;
  }, INTERACTIVE_SELECTOR);

  return { elements, totalCount: elements.length };
}

/**
 * Remove all tag overlays from the page.
 */
async function clearTags(page) {
  await page.evaluate(() => {
    document.querySelectorAll("[data-jarvis-tag-overlay]").forEach(el => el.remove());
  });
}

// ─── State Observation ───────────────────────────────────────────────────────

/**
 * Capture current page state: URL, title, DOM tags, visible text snippet, and anomalies.
 */
async function observeState(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");

  // Tag interactive elements
  const tags = await tagInteractiveElements(page);

  // Get visible text (truncated)
  const visibleText = await page.evaluate(() => {
    const body = document.body;
    if (!body) return "";
    // Get text content, collapse whitespace
    return body.innerText.replace(/\s+/g, " ").trim();
  }).catch(() => "");

  // Detect anomalies
  const anomalies = detectPageAnomalies(url, title, visibleText);

  return {
    url,
    title,
    elements: tags.elements,
    elementCount: tags.totalCount,
    visibleText: visibleText.slice(0, 3000),
    anomalies
  };
}

function detectPageAnomalies(url, title, text) {
  const haystack = `${title}\n${url}\n${text}`.toLowerCase();
  const found = [];
  if (/(captcha|not a robot|human verification|verify you.?re human|robot check|보안문자)/i.test(haystack))
    found.push("captcha");
  if (/(two[- ]?factor|2fa|otp|verification code|authenticator|인증 코드|2단계 인증)/i.test(haystack))
    found.push("2fa_required");
  if (/(access denied|forbidden|blocked|접근 거부|차단)/i.test(haystack))
    found.push("access_denied");
  if (/(cookie|consent|accept all|모두 동의|쿠키)/i.test(haystack) && /(accept|agree|동의|수락)/i.test(haystack))
    found.push("cookie_popup");
  if (/(sign in|log in|login|로그인)/i.test(haystack) && /(password|비밀번호)/i.test(haystack))
    found.push("login_required");
  if (/(404|page not found|찾을 수 없습니다)/i.test(haystack))
    found.push("not_found");
  return found;
}

// ─── BrowserService v2 ──────────────────────────────────────────────────────

class BrowserService {
  constructor({ userDataDir, credentialStore }) {
    this.savedProfileDir = path.join(userDataDir, "browser-profile");
    this.testingProfileDir = path.join(userDataDir, "playwright-profile");
    this.credentialStore = credentialStore;
    this.context = null;
    this.page = null;
    this.launchProfile = { label: "playwright fallback", mode: "testing-fallback" };
  }

  // ── Browser Lifecycle (preserved from v1) ──

  getCommonLaunchOptions() {
    const headless = process.env.JARVIS_HEADLESS !== "0";
    return {
      headless,
      viewport: headless ? { width: 1440, height: 960 } : null,
      ignoreHTTPSErrors: true
    };
  }

  buildLaunchAttempt({ label, mode, userDataDir, channel = "", executablePath = "", profileDirectory = "", prepare = null }) {
    const options = { ...this.getCommonLaunchOptions() };
    const args = ["--new-window", "--window-position=96,96", "--window-size=1280,900", "--disable-session-crashed-bubble"];
    if (channel) options.channel = channel;
    if (executablePath) options.executablePath = executablePath;
    if (profileDirectory) args.push(`--profile-directory=${profileDirectory}`);
    options.args = args;
    return { label, mode, userDataDir, profileDirectory, prepare, launchOptions: options };
  }

  async resolvePreferredLaunchAttempts() {
    const attempts = [];
    const configuredProfilePath = resolveHomePath(process.env.JARVIS_BROWSER_PROFILE_DIR || "");
    const systemChromeRoot = platform() === "darwin"
      ? path.join(homedir(), "Library/Application Support/Google/Chrome") : "";

    if (configuredProfilePath && (await pathExists(configuredProfilePath))) {
      const userDataDir = looksLikeChromeProfileDirectory(configuredProfilePath)
        ? path.dirname(configuredProfilePath) : configuredProfilePath;
      const profileDirectory = looksLikeChromeProfileDirectory(configuredProfilePath)
        ? path.basename(configuredProfilePath) : await resolveChromeProfileDirectory(configuredProfilePath);
      attempts.push(this.buildLaunchAttempt({ label: "configured Chrome profile", mode: "configured-profile", userDataDir, channel: "chrome", profileDirectory }));
    }

    if (systemChromeRoot && (await pathExists(systemChromeRoot))) {
      const profileDirectory = await resolveChromeProfileDirectory(systemChromeRoot);
      attempts.push(this.buildLaunchAttempt({
        label: "mirrored Google Chrome profile", mode: "mirrored-system-profile",
        userDataDir: this.savedProfileDir, channel: "chrome", profileDirectory,
        prepare: async () => syncChromeProfileCopy(systemChromeRoot, profileDirectory, this.savedProfileDir)
      }));
      attempts.push(this.buildLaunchAttempt({ label: "saved Google Chrome profile", mode: "system-profile", userDataDir: systemChromeRoot, channel: "chrome", profileDirectory }));
    }

    attempts.push(this.buildLaunchAttempt({ label: "saved Jarvis browser profile", mode: "jarvis-profile", userDataDir: this.savedProfileDir, channel: "chrome" }));
    attempts.push(this.buildLaunchAttempt({ label: "Playwright bundled browser", mode: "testing-fallback", userDataDir: this.testingProfileDir }));
    return attempts;
  }

  async ensureContext() {
    if (this.context) return this.context;
    const attempts = await this.resolvePreferredLaunchAttempts();
    const errors = [];
    for (const attempt of attempts) {
      try {
        const prepared = attempt.prepare ? await attempt.prepare() : null;
        const launchOptions = { ...attempt.launchOptions };
        const userDataDir = prepared?.userDataDir || attempt.userDataDir;
        const profileDirectory = prepared?.profileDirectory || attempt.profileDirectory;
        if (profileDirectory) {
          const existingArgs = Array.isArray(launchOptions.args) ? launchOptions.args.filter(a => !/^--profile-directory=/.test(a)) : [];
          launchOptions.args = [...existingArgs, `--profile-directory=${profileDirectory}`];
        }
        this.context = await chromium.launchPersistentContext(userDataDir, launchOptions);
        this.launchProfile = { label: attempt.label, mode: attempt.mode, userDataDir, profileDirectory: profileDirectory || "" };
        this.context.on("close", () => { this.context = null; this.page = null; });
        return this.context;
      } catch (error) {
        errors.push(`${attempt.label}: ${String(error.message || error).trim()}`);
      }
    }
    throw new Error(`Could not start browser: ${errors.join(" | ")}`);
  }

  async getPage() {
    const context = await this.ensureContext();
    if (this.page && !this.page.isClosed()) return this.page;
    for (const p of context.pages()) await p.close().catch(() => {});
    this.page = await context.newPage();
    return this.page;
  }

  getProviderLabel() {
    if (["system-profile", "configured-profile", "mirrored-system-profile"].includes(this.launchProfile.mode))
      return "google-chrome saved profile";
    if (this.launchProfile.mode === "jarvis-profile") return "google-chrome jarvis profile";
    return "playwright bundled browser";
  }

  async status() {
    await this.ensureContext().catch(() => {});
    return { provider: this.getProviderLabel(), ...this.launchProfile };
  }

  async peekStatus() {
    const pageActive = Boolean(this.page && !this.page.isClosed());
    let currentPage = null;
    if (pageActive) {
      currentPage = { url: this.page.url(), title: await this.page.title().catch(() => "") };
    }
    return { provider: this.getProviderLabel(), contextActive: Boolean(this.context), pageActive, currentPage, ...this.launchProfile };
  }

  // ── Generic Actions (v2 core) ──

  /**
   * Navigate to a URL. Returns observed state after navigation.
   */
  async navigate(target) {
    const page = await this.getPage();
    await page.goto(normalizeUrl(target), { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(500);
    return observeState(page);
  }

  /**
   * Click an element by its DOM tag ID. Returns observed state after click.
   */
  async clickElement(elementId) {
    const page = await this.getPage();
    const locator = page.locator(`[data-jarvis-id="${elementId}"]`);
    const count = await locator.count();
    if (count === 0) throw new Error(`Element [${elementId}] not found on page.`);
    await locator.first().scrollIntoViewIfNeeded().catch(() => {});
    await locator.first().click({ timeout: 5000 });
    await page.waitForTimeout(800);
    return observeState(page);
  }

  /**
   * Type text into an element by its DOM tag ID. Clears existing value first.
   */
  async typeText(elementId, text) {
    const page = await this.getPage();
    const locator = page.locator(`[data-jarvis-id="${elementId}"]`);
    const count = await locator.count();
    if (count === 0) throw new Error(`Element [${elementId}] not found on page.`);
    await locator.first().click({ delay: 50 });
    await locator.first().fill("");
    await locator.first().fill(text);
    return observeState(page);
  }

  /**
   * Press a key (e.g. "Enter", "Escape", "Tab") on the currently focused element.
   */
  async pressKey(key) {
    const page = await this.getPage();
    await page.keyboard.press(key);
    await page.waitForTimeout(600);
    return observeState(page);
  }

  /**
   * Scroll the page. direction: "down" | "up"
   */
  async scrollPage(direction = "down") {
    const page = await this.getPage();
    const delta = direction === "up" ? -600 : 600;
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(400);
    return observeState(page);
  }

  /**
   * Wait for a short period then re-observe. Useful when page is loading.
   */
  async waitAndObserve(ms = 2000) {
    const page = await this.getPage();
    await page.waitForTimeout(ms);
    return observeState(page);
  }

  /**
   * Get current state without performing any action.
   */
  async observe() {
    const page = await this.getPage();
    return observeState(page);
  }

  /**
   * Take a screenshot (for debugging or vision model).
   */
  async screenshot() {
    const page = await this.getPage();
    const buffer = await page.screenshot({ type: "png", fullPage: false });
    return buffer;
  }
}

module.exports = { BrowserService, normalizeUrl };
