const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { MemoryStore, formatMemoryForPrompt } = require("../../src/main/memory-store.cjs");

async function createTempApp() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-memory-store-"));

  return {
    root,
    app: {
      getPath(name) {
        assert.equal(name, "userData");
        return root;
      }
    }
  };
}

test("MemoryStore loads an empty schema when nothing has been saved yet", async () => {
  const { app, root } = await createTempApp();
  const store = new MemoryStore({ app });

  const snapshot = await store.load();

  assert.deepEqual(Object.keys(snapshot), [
    "identity",
    "preferences",
    "projects",
    "relationships",
    "wishes",
    "notes"
  ]);
  assert.deepEqual(snapshot.identity, {});

  await fs.rm(root, {
    recursive: true,
    force: true
  });
});

test("MemoryStore persists merged long-term memory entries", async () => {
  const { app, root } = await createTempApp();
  const first = new MemoryStore({ app });
  await first.load();

  await first.merge({
    identity: {
      name: {
        value: "JYH"
      }
    },
    preferences: {
      favorite_music: {
        value: "lofi hip hop"
      }
    },
    projects: {
      jarvis_desktop: {
        value: "Building a desktop Jarvis assistant"
      }
    }
  });

  const second = new MemoryStore({ app });
  const snapshot = await second.load();

  assert.equal(snapshot.identity.name.value, "JYH");
  assert.equal(snapshot.preferences.favorite_music.value, "lofi hip hop");
  assert.equal(snapshot.projects.jarvis_desktop.value, "Building a desktop Jarvis assistant");

  await fs.rm(root, {
    recursive: true,
    force: true
  });
});

test("formatMemoryForPrompt creates a compact prompt-friendly summary", () => {
  const summary = formatMemoryForPrompt({
    identity: {
      name: {
        value: "JYH"
      }
    },
    preferences: {
      favorite_app: {
        value: "Spotify"
      }
    },
    projects: {
      jarvis: {
        value: "Shipping a Jarvis desktop app"
      }
    }
  });

  assert.match(summary, /Identity/);
  assert.match(summary, /Name: JYH/);
  assert.match(summary, /Preferences/);
  assert.match(summary, /Favorite App: Spotify/);
  assert.match(summary, /Projects/);
  assert.match(summary, /Jarvis: Shipping a Jarvis desktop app/);
});
