const test = require("node:test");
const assert = require("node:assert/strict");

const { BaseBrowserService, BrowserService } = require("../../src/main/browser-service.cjs");

test("BrowserService extends the shared base browser runtime", () => {
  assert.equal(Object.getPrototypeOf(BrowserService.prototype), BaseBrowserService.prototype);
});

test("isolated browser launch attempts stay within the selected app profile", async () => {
  const service = new BrowserService({
    userDataDir: "/tmp/jarvis-browser-review",
    credentialStore: {},
    allowSharedProfiles: false
  });
  const attempts = await service.resolvePreferredLaunchAttempts();
  assert.deepEqual(attempts.map(({ mode }) => mode), ["jarvis-profile", "testing-fallback"]);
  assert.ok(attempts.every(({ userDataDir }) => userDataDir.startsWith("/tmp/jarvis-browser-review/")));
});

test("BrowserService exposes deterministic browser plan support helpers", () => {
  const service = new BrowserService({
    userDataDir: "/tmp/jarvis-browser-service-support-test",
    credentialStore: {}
  });

  assert.equal(service.supportsPlanStep({ action: "search_youtube" }), true);
  assert.equal(service.supportsPlanStep({ action: "unsupported_step" }), false);
  assert.equal(
    service.supportsPlanSteps([
      { action: "open_url" },
      { action: "read_page" }
    ]),
    true
  );
  assert.equal(
    service.supportsPlanSteps([
      { action: "open_url" },
      { action: "invent_new_tool" }
    ]),
    false
  );
});

test("BrowserService loginWithStoredCredential uses the shared credential store entry", async () => {
  const service = new BrowserService({
    userDataDir: "/tmp/jarvis-browser-service-test",
    credentialStore: {
      async getCredential(siteOrUrl) {
        assert.equal(siteOrUrl, "example.com");
        return {
          site: "example.com",
          loginUrl: "https://example.com/login",
          username: "pepper",
          password: "mk42"
        };
      }
    }
  });

  const page = {
    async goto(url, options) {
      assert.equal(url, "https://example.com/login");
      assert.equal(options.waitUntil, "domcontentloaded");
    }
  };

  let fillCalls = 0;
  service.getPage = async () => page;
  service.ensureLoginFormVisible = async (_page, targetUrl) => {
    assert.equal(targetUrl, "https://example.com/login");
    return {
      found: true,
      method: "existing-form"
    };
  };
  service.fillFirst = async (_page, _selectors, value) => {
    fillCalls += 1;
    return fillCalls === 1 ? "input[name=email]" : "input[type=password]";
  };
  service.clickFirst = async () => "button[type=submit]";
  service.snapshotPage = async () => ({
    url: "https://example.com/login",
    title: "Example Login"
  });

  const result = await service.loginWithStoredCredential("example.com");

  assert.equal(result.site, "example.com");
  assert.equal(result.username, "pepper");
  assert.equal(result.usernameSelector, "input[name=email]");
  assert.equal(result.passwordSelector, "input[type=password]");
  assert.equal(result.submitSelector, "button[type=submit]");
});

test("BrowserService fillCurrentLoginForm navigates into the login form before filling", async () => {
  const service = new BrowserService({
    userDataDir: "/tmp/jarvis-browser-service-login-form-test",
    credentialStore: {}
  });
  const calls = [];
  const page = {
    url() {
      return "https://example.com/";
    },
    async waitForTimeout() {}
  };

  service.getPage = async () => page;
  service.ensureLoginFormVisible = async (_page, targetUrl) => {
    calls.push(["ensure-login-form", targetUrl]);
    return {
      found: true,
      method: "clicked-login-entrypoint",
      attempts: [
        {
          method: "click-login-entrypoint",
          label: "Sign in"
        }
      ]
    };
  };
  service.fillLoginCredentials = async (_page, payload) => {
    calls.push(["fill-credentials", payload.username, payload.password, payload.submit]);
    return {
      usernameSelector: "input[name=email]",
      passwordSelector: "input[type=password]",
      intermediateSelector: null,
      submitSelector: null
    };
  };
  service.snapshotPage = async () => ({
    url: "https://example.com/login",
    title: "Example Login"
  });

  const result = await service.fillCurrentLoginForm({
    siteOrUrl: "https://example.com/",
    username: "pepper",
    password: "mk42"
  });

  assert.deepEqual(calls, [
    ["ensure-login-form", "https://example.com/"],
    ["fill-credentials", "pepper", "mk42", false]
  ]);
  assert.equal(result.loginNavigation.method, "clicked-login-entrypoint");
  assert.equal(result.passwordSelector, "input[type=password]");
});

test("BrowserService waitForLoginInputs does not treat a generic text box as a login form", async () => {
  const service = new BrowserService({
    userDataDir: "/tmp/jarvis-browser-service-login-input-confidence-test",
    credentialStore: {}
  });
  const page = {
    locator(selector) {
      return {
        first() {
          return {
            async count() {
              return selector === 'input[type="text"]' ? 1 : 0;
            },
            async isVisible() {
              return true;
            }
          };
        }
      };
    },
    async waitForTimeout() {}
  };

  const result = await service.waitForLoginInputs(page, 0);

  assert.equal(result.hasUsername, true);
  assert.equal(result.hasStrongUsername, false);
  assert.equal(service.hasConfidentLoginInput(result), false);
});

test("BrowserService buildLoginUrlCandidates includes known provider login URLs", () => {
  const service = new BrowserService({
    userDataDir: "/tmp/jarvis-browser-service-login-candidates-test",
    credentialStore: {}
  });

  const githubCandidates = service.buildLoginUrlCandidates("https://github.com/", "https://github.com/");
  const amazonCandidates = service.buildLoginUrlCandidates("https://www.amazon.com/", "https://www.amazon.com/");

  assert.equal(githubCandidates.includes("https://github.com/login"), true);
  assert.equal(amazonCandidates.includes("https://www.amazon.com/ap/signin"), true);
});

test("BrowserService executePlan supports saved login and current-site search steps", async () => {
  const service = new BrowserService({
    userDataDir: "/tmp/jarvis-browser-service-plan-test",
    credentialStore: {}
  });
  const calls = [];

  service.open = async (target) => {
    calls.push(["open_url", target]);
    return {
      url: target,
      title: "Opened"
    };
  };
  service.loginWithStoredCredential = async (target) => {
    calls.push(["login_saved", target]);
    return {
      site: target,
      title: "Logged In"
    };
  };
  service.searchCurrentSite = async (query) => {
    calls.push(["site_search", query]);
    return {
      query,
      title: "Search Results"
    };
  };
  service.readPage = async () => {
    calls.push(["read_page", ""]);
    return {
      title: "Activity",
      text: "Recent activity"
    };
  };

  const result = await service.executePlan([
    { action: "open_url", target: "https://github.com/" },
    { action: "login_saved", target: "github.com" },
    { action: "site_search", query: "openai" },
    { action: "read_page", limit: 4000 }
  ]);

  assert.deepEqual(calls, [
    ["open_url", "https://github.com/"],
    ["login_saved", "github.com"],
    ["site_search", "openai"],
    ["read_page", ""]
  ]);
  assert.equal(result.final.title, "Activity");
});

test("BrowserService search helpers route through navigate", async () => {
  const service = new BrowserService({
    userDataDir: "/tmp/jarvis-browser-service-search-test",
    credentialStore: {}
  });
  const visited = [];

  service.navigate = async (target) => {
    visited.push(target);
    return {
      url: target,
      title: "Visited"
    };
  };

  await service.searchGoogle("openai");
  await service.searchYouTube("music mix");

  assert.deepEqual(visited, [
    "https://www.google.com/search?q=openai",
    "https://www.youtube.com/results?search_query=music%20mix"
  ]);
});

test("page review reads only the tracked, already-open web page and does not launch a browser", async () => {
  const service = new BrowserService({ userDataDir: "/tmp/jarvis-browser-review", credentialStore: {} });
  service.getPage = () => assert.fail("Page review must never create a tab");
  service.ensureContext = () => assert.fail("Page review must never launch a browser");
  assert.deepEqual(await service.readPageForReview(), { ok: false, reason: "BROWSER_NO_PAGE" });
  service.page = { url: () => "about:blank", isClosed: () => false };
  assert.deepEqual(await service.readPageForReview(), { ok: false, reason: "BROWSER_NO_PAGE" });
  service.page = { url: () => "https://example.invalid", isClosed: () => true };
  assert.deepEqual(await service.readPageForReview(), { ok: false, reason: "BROWSER_NO_PAGE" });
  service.page = { url: () => "file:///test.html", isClosed: () => false };
  assert.deepEqual(await service.readPageForReview(), { ok: false, reason: "BROWSER_UNSUPPORTED_PAGE" });
});

test("page review limits visible text and returns title and origin without the full URL", async () => {
  const { EventEmitter } = require("node:events");
  const { runInNewContext } = require("node:vm");
  const service = new BrowserService({ userDataDir: "/tmp/jarvis-browser-review", credentialStore: {} });
  const original = "a".repeat(11999) + "😀" + "Tail";
  const location = new URL("https://example.invalid/path?fixture=private#private");
  const body = { innerText: original, textContent: "Hidden sample text" };
  service.page = Object.assign(new EventEmitter(), {
    url: () => location.href,
    isClosed: () => false,
    mainFrame: () => null,
    locator(selector) {
      assert.equal(selector, "body");
      return {
        evaluate: async (read, limit) => JSON.parse(JSON.stringify(runInNewContext(
          "(" + read.toString() + ")(body, limit)", { location, document: { title: "Synthetic page" }, body, limit },
        )))
      };
    }
  });
  const result = await service.readPageForReview();
  assert.deepEqual(result, { ok: true, data: {
    title: "Synthetic page", origin: "https://example.invalid", text: "a".repeat(11999), truncated: true
  } });
  assert.equal(service.page.listenerCount("framenavigated"), 0);
  body.innerText = "  ";
  assert.deepEqual((await service.readPageForReview()).data, {
    title: "Synthetic page", origin: "https://example.invalid", text: "", truncated: false
  });
});

test("page review rejects navigation, closed or replaced pages, and handles read failure", async () => {
  const { EventEmitter } = require("node:events");
  const service = new BrowserService({ userDataDir: "/tmp/jarvis-browser-review", credentialStore: {} });
  const frame = {};
  let read;
  const page = Object.assign(new EventEmitter(), {
    url: () => "https://example.invalid",
    isClosed: () => false,
    mainFrame: () => frame,
    locator: () => ({ evaluate: () => new Promise((resolve, reject) => { read = { resolve, reject }; }) })
  });
  service.page = page;
  const navigated = service.readPageForReview();
  page.emit("framenavigated", frame);
  read.resolve({ text: "stale data" });
  assert.deepEqual(await navigated, { ok: false, reason: "BROWSER_PAGE_CHANGED" });
  const replaced = service.readPageForReview();
  service.page = null;
  read.resolve({ text: "stale data" });
  assert.deepEqual(await replaced, { ok: false, reason: "BROWSER_PAGE_CHANGED" });
  service.page = page;
  const failure = service.readPageForReview();
  read.reject(new Error("synthetic browser error"));
  assert.deepEqual(await failure, { ok: false, reason: "BROWSER_READ_FAILED" });
  assert.equal(page.listenerCount("framenavigated"), 0);
});

test("exact browser review commands in the assistant use local guidance", async () => {
  const { AssistantService } = require("../../src/main/assistant-service.cjs");
  const assistant = new AssistantService({ computerControl: { enabled: false } });
  assistant.handleModelConversation = () => assert.fail("Exact web page review commands stay local");
  const english = await assistant.handleInput("summarize the current page");
  assert.equal(english.provider, "local");
  assert.match(english.reply, /Read web page/);
  assert.deepEqual(english.actions, []);
  const korean = await assistant.handleInput("현재 페이지 읽어줘");
  assert.equal(korean.provider, "local");
  assert.match(korean.reply, /웹 페이지 읽기/);
});
