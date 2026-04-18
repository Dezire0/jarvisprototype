const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { loadProjectEnv, parseEnvFile } = require("../../src/main/project-env.cjs");

test("parseEnvFile supports comments, exports, and quoted values", () => {
  const parsed = parseEnvFile(`
# comment
FOO=bar
export HELLO="jarvis"
NAME='Friday'
EMPTY=
`);

  assert.deepEqual(parsed, {
    FOO: "bar",
    HELLO: "jarvis",
    NAME: "Friday",
    EMPTY: ""
  });
});

test("loadProjectEnv lets .env.local override .env", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-env-test-"));
  const baseKey = "JARVIS_ENV_TEST_BASE";
  const sharedKey = "JARVIS_ENV_TEST_SHARED";

  delete process.env[baseKey];
  delete process.env[sharedKey];

  await fs.writeFile(
    path.join(rootDir, ".env"),
    `${baseKey}=from-env\n${sharedKey}=base-value\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(rootDir, ".env.local"),
    `${sharedKey}=local-value\n`,
    "utf8"
  );

  loadProjectEnv({ rootDir });

  assert.equal(process.env[baseKey], "from-env");
  assert.equal(process.env[sharedKey], "local-value");

  delete process.env[baseKey];
  delete process.env[sharedKey];
  await fs.rm(rootDir, { recursive: true, force: true });
});

test("loadProjectEnv skips empty environment values so optional blanks do not leak into process.env", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-env-empty-test-"));
  const emptyKey = "JARVIS_ENV_TEST_EMPTY";

  delete process.env[emptyKey];

  await fs.writeFile(
    path.join(rootDir, ".env.local"),
    `${emptyKey}=\n`,
    "utf8"
  );

  loadProjectEnv({ rootDir });

  assert.equal(process.env[emptyKey], undefined);

  delete process.env[emptyKey];
  await fs.rm(rootDir, { recursive: true, force: true });
});
