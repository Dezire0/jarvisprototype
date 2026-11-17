const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { configureDesktopProfile } = require("../../src/main/desktop-profile.cjs");

function stubApp(appData, name) {
  const paths = new Map();
  return {
    paths,
    commandLine: {
      hasSwitch: () => name !== undefined,
      getSwitchValue: () => name
    },
    getPath: () => appData,
    setPath: (key, value) => paths.set(key, value)
  };
}

test("named desktop profiles scope application and Chromium storage before startup", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-profile-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const regular = stubApp(root);
  assert.equal(configureDesktopProfile(regular), null);
  assert.equal(regular.paths.size, 0);

  const app = stubApp(root, "Review-A");
  assert.equal(configureDesktopProfile(app), "review-a");
  const expected = path.join(root, "Jarvis Desktop Profiles", "review-a");
  assert.equal(app.paths.get("userData"), expected);
  assert.equal(app.paths.get("sessionData"), expected);
  assert.equal((await fs.stat(expected)).isDirectory(), true);
  assert.equal(configureDesktopProfile(app), "review-a");
  assert.throws(() => configureDesktopProfile(stubApp(root, "../ordinary")), /short name/);
  assert.throws(() => configureDesktopProfile(stubApp(root, "")), /short name/);

  if (process.platform !== "win32") {
    await fs.symlink(root, path.join(root, "Jarvis Desktop Profiles", "linked"), "dir");
    assert.throws(() => configureDesktopProfile(stubApp(root, "linked")), /must be a directory/);
  }
});
