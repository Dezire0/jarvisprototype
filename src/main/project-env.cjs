const fs = require("node:fs");
const path = require("node:path");

function decodeQuotedValue(value, quote) {
  const inner = value.slice(1, -1);

  if (quote !== "\"") {
    return inner;
  }

  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function parseEnvFile(content = "") {
  const values = {};
  const lines = String(content).split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const normalizedLine = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const match = normalizedLine.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const value = rawValue.trim();
    const quote = value[0];

    if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
      values[key] = decodeQuotedValue(value, quote);
      continue;
    }

    values[key] = value;
  }

  return values;
}

function loadEnvFile(filePath, { override = false, skipEmpty = false } = {}) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const parsed = parseEnvFile(fs.readFileSync(filePath, "utf8"));

  for (const [key, value] of Object.entries(parsed)) {
    if (skipEmpty && value === "") {
      continue;
    }

    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return parsed;
}

function loadProjectEnv({ rootDir = path.resolve(__dirname, "..", "..") } = {}) {
  const envPath = path.join(rootDir, ".env");
  const localEnvPath = path.join(rootDir, ".env.local");

  const loaded = {
    env: loadEnvFile(envPath, { skipEmpty: true }),
    envLocal: loadEnvFile(localEnvPath, { override: true, skipEmpty: true })
  };

  return loaded;
}

module.exports = {
  loadEnvFile,
  loadProjectEnv,
  parseEnvFile
};
