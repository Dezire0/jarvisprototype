const fs = require("node:fs");
const path = require("node:path");

const PROFILE_SWITCH = "jarvis-profile";

function configureDesktopProfile(app) {
  if (!app.commandLine.hasSwitch(PROFILE_SWITCH)) return null;
  const name = app.commandLine.getSwitchValue(PROFILE_SWITCH).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) {
    throw new Error("Use --jarvis-profile with a short name containing letters, numbers or hyphens.");
  }

  const root = path.join(app.getPath("appData"), "Jarvis Desktop Profiles");
  const directory = path.join(root, name);
  for (const folder of [root, directory]) {
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(folder).isDirectory()) {
      throw new Error("The Jarvis profile path must be a directory.");
    }
  }
  app.setPath("userData", directory);
  app.setPath("sessionData", directory);
  return name;
}

module.exports = { configureDesktopProfile, PROFILE_SWITCH };
