const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { CredentialStore } = require("../src/main/credential-store.cjs");
const { BrowserService } = require("../src/main/browser-service.cjs");

const site = process.env.BROWSER_E2E_SITE || "the-internet.herokuapp.com";
const loginUrl = process.env.BROWSER_E2E_LOGIN_URL || "https://the-internet.herokuapp.com/login";
const username = process.env.BROWSER_E2E_USERNAME || "tomsmith";
const password = process.env.BROWSER_E2E_PASSWORD || "SuperSecretPassword!";

async function run() {
  process.env.JARVIS_HEADLESS = process.env.JARVIS_HEADLESS || "1";

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-browser-e2e-"));
  const userDataDir = path.join(tempRoot, "user-data");
  const sharedVaultDir = path.join(tempRoot, "shared-vault");

  const store = new CredentialStore({
    app: {
      getPath() {
        return userDataDir;
      }
    },
    sharedVaultDir
  });

  const browser = new BrowserService({
    userDataDir,
    credentialStore: store
  });

  try {
    await store.saveCredential({
      site,
      loginUrl,
      username,
      password
    });

    const initialResult = await browser.loginWithStoredCredential(site);
    const page = await browser.getPage();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1500);
    const finalUrl = page.url();
    const body = await page.locator("body").innerText().catch(() => "");

    console.log(
      JSON.stringify(
        {
          site,
          loginUrl,
          initialResult,
          finalUrl,
          loginSucceeded: finalUrl.includes("/secure") && /You logged into a secure area!/i.test(body),
          bodySnippet: body.slice(0, 220)
        },
        null,
        2
      )
    );
  } finally {
    try {
      await browser.context?.close();
    } catch (_error) {
      // Ignore cleanup failures.
    }
    try {
      await store.deleteCredential(site);
    } catch (_error) {
      // Ignore cleanup failures.
    }
    try {
      await fs.rm(tempRoot, {
        recursive: true,
        force: true
      });
    } catch (_error) {
      // Ignore cleanup failures.
    }
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
