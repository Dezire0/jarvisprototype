const path = require("node:path");
const { pathToFileURL } = require("node:url");

let cachedModulePromise = null;

function loadCompanionModule() {
  if (!cachedModulePromise) {
    const modulePath = path.join(__dirname, "v2", "companion-service.mjs");
    cachedModulePromise = import(pathToFileURL(modulePath).href);
  }

  return cachedModulePromise;
}

async function createCompanionServices(options = {}) {
  const module = await loadCompanionModule();
  return module.createCompanionServices(options);
}

module.exports = {
  createCompanionServices
};
