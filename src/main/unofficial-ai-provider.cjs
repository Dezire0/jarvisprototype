const { BrowserWindow, session, net } = require("electron");
const crypto = require("crypto");
const { safeJsonParse } = require("./utils.cjs");

/**
 * UnofficialAIProvider는 로그인된 ChatGPT 웹 세션에서 세션 토큰을 추출하여
 * 내부 `backend-api`를 호출함으로써 공식 API 비용을 절감하는 기능을 제공합니다.
 * 
 * 주의: 이는 공식적인 방법이 아니며, OpenAI의 인증 방식이나 API 구조 변경 시
 * 언제든지 작동이 중단될 수 있습니다.
 */
class UnofficialAIProvider {
  constructor() {
    this.accessToken = null;
    this.loginWindow = null;
    this.deviceId = crypto.randomUUID();
  }

  /**
   * Check if we have a valid session, otherwise prompt login.
   */
  async getAccessToken() {
    if (this.accessToken) return this.accessToken;

    // Plan-based extraction: check for the session token cookie directly
    const cookies = await session.defaultSession.cookies.get({ name: "__Secure-next-auth.session-token" });
    if (cookies.length > 0) {
      console.log("Extracted session token from cookie.");
      // Note: The cookie itself isn't the accessToken used in headers, 
      // but api/auth/session uses it to return the accessToken.
      // If we wanted to use the cookie directly for auth, we'd need a different API approach.
      // But let's follow the request to use api/auth/session while ensuring we have the cookie.
    }

    return new Promise((resolve, reject) => {
      const request = net.request("https://chatgpt.com/api/auth/session");
      
      request.on("response", (response) => {
        let data = "";
        response.on("data", (chunk) => { data += chunk; });
        response.on("end", () => {
          const json = safeJsonParse(data);
          if (json && json.accessToken) {
            this.accessToken = json.accessToken;
            resolve(this.accessToken);
          } else {
            resolve(null);
          }
        });
      });

      request.on("error", (error) => reject(error));
      request.setHeader("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      request.end();
    });
  }

  /**
   * Opens a window for the user to log in manually.
   */
  async requireLogin() {
    return new Promise((resolve) => {
      if (this.loginWindow) {
        this.loginWindow.focus();
        return;
      }

      this.loginWindow = new BrowserWindow({
        width: 800,
        height: 800,
        title: "Login to ChatGPT",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          partition: "persist:chatgpt" // Must match default session if we want to share cookies
        }
      });

      // Clear cookies to force a fresh login if needed? No, let's keep it persistent.
      this.loginWindow.loadURL("https://chatgpt.com");

      // Monitor navigations to see when they hit the main chat interface
      this.loginWindow.webContents.on("did-navigate", async (event, url) => {
        if (url === "https://chatgpt.com/" || url.startsWith("https://chatgpt.com/c/")) {
          // They logged in!
          const token = await this.getAccessToken();
          if (token) {
            this.loginWindow.close();
            this.loginWindow = null;
            resolve(token);
          }
        }
      });

      this.loginWindow.on("closed", () => {
        this.loginWindow = null;
        resolve(this.accessToken); // might be null if they closed without logging in
      });
    });
  }

  /**
   * Send a message to ChatGPT's unofficial backend API.
   * @param {string} prompt 
   */
  async chat(prompt) {
    let token = await this.getAccessToken();
    if (!token) {
      console.log("No valid session. Prompting login...");
      token = await this.requireLogin();
      if (!token) throw new Error("User did not log in to ChatGPT.");
    }

    // Prepare the payload (this matches the typical payload as of mid-2024)
    // Note: This changes frequently.
    const payload = {
      action: "next",
      messages: [
        {
          id: crypto.randomUUID(),
          author: { role: "user" },
          content: { content_type: "text", parts: [prompt] },
          metadata: {}
        }
      ],
      parent_message_id: crypto.randomUUID(), // For a new chat
      model: "auto",
      timezone_offset_min: -540,
      history_and_training_disabled: false,
      conversation_mode: { kind: "primary_assistant" },
      force_paragen: false,
      force_paragen_model_slug: "",
      force_nulligen: false,
      force_rate_limit: false,
      websocket_request_id: crypto.randomUUID()
    };

    return new Promise((resolve, reject) => {
      const request = net.request({
        method: "POST",
        url: "https://chatgpt.com/backend-api/conversation",
      });

      const timeout = setTimeout(() => {
        request.abort();
        reject(new Error("ChatGPT API response timed out."));
      }, 45000);

      request.setHeader("Authorization", `Bearer ${token}`);
      request.setHeader("Content-Type", "application/json");
      request.setHeader("Accept", "text/event-stream");
      request.setHeader("Oai-Device-Id", this.deviceId);
      request.setHeader("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      request.setHeader("Origin", "https://chatgpt.com");
      request.setHeader("Referer", "https://chatgpt.com/");

      let fullResponse = "";

      request.on("response", (response) => {
        if (response.statusCode === 401 || response.statusCode === 403) {
          clearTimeout(timeout);
          this.accessToken = null;
          reject(new Error(`API Error: ${response.statusCode} (Token might be expired or blocked)`));
          return;
        }

        response.on("data", (chunk) => {
          const text = chunk.toString();
          const lines = text.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.message?.author?.role === "assistant" && data.message?.content?.parts) {
                  fullResponse = data.message.content.parts[0];
                }
              } catch (e) {
                // Ignore incomplete JSON
              }
            }
          }
        });

        response.on("end", () => {
          clearTimeout(timeout);
          if (!fullResponse) {
            reject(new Error("Received empty response from ChatGPT."));
          } else {
            resolve(fullResponse);
          }
        });
      });

      request.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      request.write(JSON.stringify(payload));
      request.end();
    });
  }
}

module.exports = new UnofficialAIProvider();
