const { createHmac, randomBytes, timingSafeEqual } = require("node:crypto");

const SESSION_HEADER = "x-jarvis-desktop-session";

function createDesktopSessionToken() {
  return randomBytes(32).toString("hex");
}

function isDesktopSessionToken(token) {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

function matchesDesktopToken(expected, received) {
  return isDesktopSessionToken(expected) && isDesktopSessionToken(received) &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

function desktopUiProof(token, challenge) {
  return createHmac("sha256", token).update("jarvis-desktop-ui:" + challenge).digest("hex");
}

function attachDesktopChatHeader(contents, uiUrl, token, isCurrent = () => true) {
  const origin = new URL(uiUrl).origin;
  const chatUrl = origin + "/api/chat";

  contents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    for (const header of Object.keys(requestHeaders)) {
      if (header.toLowerCase() === SESSION_HEADER) delete requestHeaders[header];
    }

    if (
      isCurrent() && !contents.isDestroyed() &&
      details.webContentsId === contents.id &&
      details.frame && details.frame === contents.mainFrame &&
      details.url === chatUrl &&
      details.method === "POST" &&
      URL.canParse(details.frame.url) &&
      new URL(details.frame.url).origin === origin
    ) {
      requestHeaders[SESSION_HEADER] = token;
    }

    callback({ requestHeaders });
  });
}

module.exports = {
  SESSION_HEADER,
  createDesktopSessionToken,
  isDesktopSessionToken,
  matchesDesktopToken,
  desktopUiProof,
  attachDesktopChatHeader
};
