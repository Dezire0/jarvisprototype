const { execSync } = require("child_process");

/**
 * OSAutomation handles interacting with the host operating system
 * using native accessibility APIs (AppleScript on macOS).
 * 
 * WARNING: Requires 'Accessibility' permissions in macOS System Preferences.
 */
class OSAutomation {
  constructor() {
    this.isMac = process.platform === "darwin";
  }

  _runAppleScript(script) {
    if (!this.isMac) throw new Error("OSAutomation currently only supports macOS.");
    try {
      // Escape double quotes inside the script
      const escapedScript = script.replace(/"/g, '\\"');
      return execSync(`osascript -e "${escapedScript}"`).toString().trim();
    } catch (err) {
      throw new Error(`AppleScript execution failed: ${err.message}`);
    }
  }

  /**
   * Check if the app has accessibility permissions.
   */
  checkPermissions() {
    try {
      // A simple script that requires accessibility permissions
      this._runAppleScript(`
        tell application "System Events"
          return UI elements enabled
        end tell
      `);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Type text as if the user typed it on the keyboard.
   * @param {string} text 
   */
  typeText(text) {
    const script = `
      tell application "System Events"
        keystroke "${text}"
      end tell
    `;
    this._runAppleScript(script);
  }

  /**
   * Press a specific key (e.g., "return", "tab", "escape").
   * @param {number} keyCode (e.g., 36 for return)
   */
  pressKeycode(keyCode) {
    const script = `
      tell application "System Events"
        key code ${keyCode}
      end tell
    `;
    this._runAppleScript(script);
  }

  /**
   * Click at a specific screen coordinate.
   * Note: This requires clicking via a third-party tool like 'cliclick' 
   * or a more complex Python/Objective-C bridge since AppleScript natively 
   * doesn't easily click arbitrary x,y coords without UI element targeting.
   * For simplicity, we use UI element targeting if possible.
   * @param {number} x 
   * @param {number} y 
   */
  clickCoordinate(x, y) {
    // Requires cliclick to be installed: brew install cliclick
    try {
      execSync(`cliclick c:${x},${y}`);
    } catch (err) {
      throw new Error("cliclick is not installed. Please run 'brew install cliclick' for mouse automation.");
    }
  }

  /**
   * Open an application by name.
   * @param {string} appName (e.g., "Safari", "Notes")
   */
  openApplication(appName) {
    const script = `
      tell application "${appName}" to activate
    `;
    this._runAppleScript(script);
  }

  /**
   * Get the name of the currently active application.
   */
  getActiveApp() {
    const script = `
      tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
      end tell
      return frontApp
    `;
    return this._runAppleScript(script);
  }
}

module.exports = new OSAutomation();
