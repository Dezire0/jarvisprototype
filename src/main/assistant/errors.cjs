let electronNetFetch = null;

try {
  const electronModule = require("electron");
  if (
    electronModule &&
    typeof electronModule === "object" &&
    electronModule.net &&
    typeof electronModule.net.fetch === "function"
  ) {
    electronNetFetch = electronModule.net.fetch.bind(electronModule.net);
  }
} catch (_error) {
  electronNetFetch = null;
}

function formatFetchError(error, url = "") {
  const cause = error?.cause;
  const details = [
    cause?.code,
    cause?.errno,
    cause?.syscall,
    cause?.hostname,
    cause?.message,
    error?.message
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);

  const unique = [...new Set(details)];
  const host = (() => {
    try {
      return new URL(url).host;
    } catch (_error) {
      return "";
    }
  })();

  return unique.length
    ? `${host ? `${host} · ` : ""}${unique.join(" / ")}`
    : host || "unknown network error";
}

async function fetchWithRuntime(url, options = {}) {
  if (electronNetFetch) {
    try {
      return await electronNetFetch(url, options);
    } catch (_electronError) {
      try {
        return await fetch(url, options);
      } catch (fallbackError) {
        fallbackError.message = formatFetchError(fallbackError, url);
        throw fallbackError;
      }
    }
  }

  try {
    return await fetch(url, options);
  } catch (error) {
    error.message = formatFetchError(error, url);
    throw error;
  }
}

module.exports = {
  fetchWithRuntime,
  formatFetchError
};
