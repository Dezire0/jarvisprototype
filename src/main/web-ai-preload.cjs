const { contextBridge, ipcRenderer } = require("electron");
const { buildDomHelperSource } = require("./web-ai-dom-helpers.cjs");

/**
 * This script is injected into the ChatGPT web session to act as a bridge
 * between the hidden browser window and the main Electron process.
 */

// We use IPC to listen for prompts from the main process
ipcRenderer.on("web-ai-prompt", async (event, prompt) => {
  try {
    const helperSource = buildDomHelperSource();
    const runner = new Function(
      "promptValue",
      `
      ${helperSource}
      return (async () => {
        let composer = null;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          composer = jarvisFindChatInput();
          if (composer) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        if (!composer) {
          throw new Error("Could not find a chat input");
        }

        const baselineSnapshot = jarvisSnapshotConversation();
        jarvisSetComposerValue(composer, promptValue);
        await new Promise((resolve) => setTimeout(resolve, 250));
        jarvisSubmitPrompt(composer);
        return baselineSnapshot;
      })();
    `
    );

    const baselineSnapshot = await runner(prompt);
    waitForResponse(prompt, baselineSnapshot);

  } catch (err) {
    console.error("Web AI Error:", err);
    ipcRenderer.send("web-ai-response", `[Error scraping response: ${err.message}]`);
  }
});

async function waitForResponse(prompt, baselineSnapshot) {
  let attempts = 0;
  let generationStarted = false;
  let stableChecks = 0;
  let lastSnapshot = baselineSnapshot;
  const maxAttempts = 450;
  const helperSource = buildDomHelperSource();

  await new Promise((resolve) => setTimeout(resolve, 600));

  const checkInterval = setInterval(() => {
    attempts++;

    const stateReader = new Function(
      "baselineValue",
      "promptValue",
      `
      ${helperSource}
      const snapshot = jarvisSnapshotConversation();
      const sendButton = jarvisFindActionButton("send");
      const stopButton = jarvisFindActionButton("stop");
      const changed = snapshot !== baselineValue;
      return {
        snapshot,
        deltaText: jarvisExtractDeltaText(baselineValue, snapshot, promptValue),
        changed,
        sendDisabled: Boolean(sendButton && sendButton.disabled),
        stopVisible: Boolean(stopButton)
      };
    `
    );

    const state = stateReader(baselineSnapshot, prompt);

    if (state.changed || state.sendDisabled || state.stopVisible) {
      generationStarted = true;
    }

    if (state.snapshot === lastSnapshot) {
      stableChecks += 1;
    } else {
      stableChecks = 0;
      lastSnapshot = state.snapshot;
    }

    const isDone =
      generationStarted &&
      !state.stopVisible &&
      !state.sendDisabled &&
      stableChecks >= 2;

    if (isDone || attempts > maxAttempts) {
      clearInterval(checkInterval);

      const responseText = state.deltaText || state.snapshot || "[Error: No assistant response found]";
      ipcRenderer.send("web-ai-response", responseText);
    }
  }, 500);
}
