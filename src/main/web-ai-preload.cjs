const { contextBridge, ipcRenderer } = require("electron");

/**
 * This script is injected into the ChatGPT web session to act as a bridge
 * between the hidden browser window and the main Electron process.
 */

// We use IPC to listen for prompts from the main process
ipcRenderer.on("web-ai-prompt", async (event, prompt) => {
  try {
    // Note: These selectors are highly volatile and depend on ChatGPT's current UI
    const textAreaSelector = "textarea#prompt-textarea";
    const sendButtonSelector = "[data-testid='send-button']";

    const textArea = document.querySelector(textAreaSelector);
    if (!textArea) {
      throw new Error("Could not find prompt textarea");
    }

    // React needs a bit of coercing to accept programmatic input
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    nativeInputValueSetter.call(textArea, prompt);
    
    // Dispatch input event so React knows the value changed
    textArea.dispatchEvent(new Event('input', { bubbles: true }));

    // Wait a brief moment for the send button to become active
    await new Promise(r => setTimeout(r, 100));

    const sendBtn = document.querySelector(sendButtonSelector);
    if (!sendBtn) {
      throw new Error("Could not find send button");
    }

    sendBtn.click();

    // Now we need to wait for the response to finish generating.
    // ChatGPT usually shows a 'stop generating' button while working.
    // We poll until that button disappears or until a new response block is fully formed.
    waitForResponse();

  } catch (err) {
    console.error("Web AI Error:", err);
    ipcRenderer.send("web-ai-response", `[Error scraping response: ${err.message}]`);
  }
});

async function waitForResponse() {
  let attempts = 0;
  const maxAttempts = 120; // 60 seconds
  
  // Wait for the generation to start
  await new Promise(r => setTimeout(r, 1000));

  const checkInterval = setInterval(() => {
    attempts++;
    
    // Check if the "Stop generating" button is present
    const isGenerating = document.querySelector("button[aria-label='Stop generating']") !== null;
    
    if (!isGenerating || attempts > maxAttempts) {
      clearInterval(checkInterval);
      
      // Grab the last assistant message
      const messages = document.querySelectorAll("div[data-message-author-role='assistant']");
      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        // Extract text (simplified, might need to parse markdown/code blocks better)
        const responseText = lastMessage.innerText;
        ipcRenderer.send("web-ai-response", responseText);
      } else {
        ipcRenderer.send("web-ai-response", "[Error: No assistant message found]");
      }
    }
  }, 500);
}
