const MACOS_AUTOMATION_PERMISSION_MESSAGE =
  "Jarvis needs Accessibility permission to control apps with the mouse and keyboard.";
const MACOS_AUTOMATION_PERMISSION_DIALOG_DETAIL =
  "Open System Settings > Privacy & Security > Accessibility, then enable Jarvis Desktop or Electron. After enabling it, restart Jarvis.";

function normalizeAutomationFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "");

  if (/not authorized|accessibility|permission|not permitted|osascript/i.test(message)) {
    return `${MACOS_AUTOMATION_PERMISSION_MESSAGE} ${MACOS_AUTOMATION_PERMISSION_DIALOG_DETAIL}`;
  }

  return message || "Automation failed.";
}

module.exports = {
  MACOS_AUTOMATION_PERMISSION_DIALOG_DETAIL,
  MACOS_AUTOMATION_PERMISSION_MESSAGE,
  normalizeAutomationFailureMessage
};
