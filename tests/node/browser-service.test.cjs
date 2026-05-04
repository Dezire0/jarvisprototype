const test = require("node:test");
const assert = require("node:assert/strict");

const { BrowserService } = require("../../src/main/browser-service.cjs");

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

  const candidates = service.buildLoginUrlCandidates("https://github.com/", "https://github.com/");

  assert.equal(candidates.includes("https://github.com/login"), true);
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
