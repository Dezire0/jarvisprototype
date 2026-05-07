const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function createModule() {
  return import("../../src/main/v2/companion-service.mjs");
}

test("classifySiteType detects media/work/social/shopping contexts", async () => {
  const { classifySiteType } = await createModule();

  assert.equal(classifySiteType({ url: "https://www.youtube.com/watch?v=test" }), "media");
  assert.equal(classifySiteType({ url: "https://mail.google.com/mail/u/0/#inbox" }), "work");
  assert.equal(classifySiteType({ url: "https://x.com/home" }), "social");
  assert.equal(classifySiteType({ url: "https://www.amazon.com/dp/example" }), "shopping");
});

test("redactSensitiveText masks obvious password and token patterns", async () => {
  const { redactSensitiveText } = await createModule();
  const redacted = redactSensitiveText("password=hunter2 token=ghp_supersecrettokenvalue");

  assert.doesNotMatch(redacted, /hunter2/);
  assert.doesNotMatch(redacted, /ghp_supersecrettokenvalue/);
  assert.match(redacted, /\[REDACTED]/);
});

test("companion ingests buddy events into compact state", async () => {
  const { createCompanionServices } = await createModule();
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-companion-test-"));
  const companion = await createCompanionServices({
    storageDir,
    language: "ko"
  });

  const buddy = await companion.ingestBuddyEvent({
    kind: "selection",
    scope: "jarvis-ui",
    url: "https://mail.google.com/mail/u/0/#inbox",
    selectedTextPreview: "이 문장은 충분히 길어서 버디 트리거가 되어야 합니다.",
    timestamp: new Date().toISOString()
  });

  assert.equal(buddy.active, true);
  assert.equal(buddy.event.siteType, "work");
  assert.ok(Array.isArray(buddy.actions));
  assert.ok(buddy.actions.length >= 3);
});

test("companion account queue runs sequentially and records waiting_for_auth", async () => {
  const { createCompanionServices } = await createModule();
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-account-queue-test-"));
  const companion = await createCompanionServices({
    storageDir,
    language: "en",
    browser: {
      async createIsolatedSession() {
        return {
          async navigate() {
            return {
              url: "https://example.com",
              title: "Done",
              elements: []
            };
          }
        };
      }
    }
  });

  await companion.accountQueueAdd({
    accountId: "acct-a",
    provider: "google",
    type: "mail-review",
    priority: 90,
    url: "https://mail.google.com",
    estimatedMinutesSaved: 4
  });
  await companion.accountQueueAdd({
    accountId: "acct-b",
    provider: "google",
    type: "mail-review",
    priority: 20,
    authBlocked: true
  });

  await companion.processAccountQueue();
  const queue = await companion.accountQueueList();

  assert.equal(queue.queue.tasks[0].status, "completed");
  assert.equal(queue.queue.tasks[1].status, "waiting_for_auth");
});

test("companion media_get_og_info returns a card-safe payload", async () => {
  const { createCompanionServices } = await createModule();
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-media-card-test-"));
  const companion = await createCompanionServices({
    storageDir,
    language: "en"
  });

  const result = await companion.mediaGetOgInfo({
    url: "https://www.youtube.com/watch?v=test",
    title: "Artist - Track",
    thumbnailUrl: "https://img.youtube.com/vi/test/hqdefault.jpg"
  });

  assert.equal(result.ok, true);
  assert.equal(result.media.provider, "youtube");
  assert.equal(result.media.title, "Artist - Track");
  assert.equal(result.media.thumbnailUrl, "https://img.youtube.com/vi/test/hqdefault.jpg");
});
