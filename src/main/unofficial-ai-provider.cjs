const { BrowserWindow, session, net } = require("electron");
const crypto = require("crypto");

const CHATGPT_URL = "https://chatgpt.com";
const CHATGPT_PARTITION = "persist:chatgpt";
const CHATGPT_SESSION_ENDPOINT = `${CHATGPT_URL}/api/auth/session`;
const CHATGPT_CONVERSATION_ENDPOINT = `${CHATGPT_URL}/backend-api/conversation`;
const GEMINI_URL = "https://gemini.google.com/app";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (_error) {
    return null;
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function uniqueTextParts(parts = []) {
  const seen = new Set();
  return parts.filter((part) => {
    const normalized = String(part || "").trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function extractAssistantText(payload) {
  const candidates = [];

  const pushValue = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(pushValue);
      return;
    }
    if (typeof value === "string") {
      candidates.push(value);
      return;
    }
    if (typeof value === "object") {
      if (typeof value.text === "string") {
        candidates.push(value.text);
      }
      if (Array.isArray(value.parts)) {
        value.parts.forEach(pushValue);
      }
      if (Array.isArray(value.content)) {
        value.content.forEach(pushValue);
      }
    }
  };

  const message = payload?.message || payload?.data?.message || payload?.data;
  if (message?.author?.role !== "assistant") {
    return "";
  }

  pushValue(message?.content?.parts);
  pushValue(message?.content?.text);
  pushValue(message?.metadata?.aggregate_result?.messages);

  return uniqueTextParts(candidates).join("\n\n").trim();
}

class UnofficialAIProvider {
  constructor() {
    this.accessToken = null;
    this.loginWindow = null;
    this.chatWindow = null;
    this.deviceId = crypto.randomUUID();
    this.isLoggingIn = false;
    this.lastConnectionState = {
      connected: false,
      provider: null,
      reason: "unknown",
      checkedAt: 0
    };
  }

  async logout() {
    this.accessToken = null;
    await this.chatgptSession.clearStorageData({
      storages: ["cookies", "localstorage"]
    });
    this.lastConnectionState = {
      connected: false,
      provider: null,
      reason: "disconnected",
      checkedAt: 0
    };
  }

  get chatgptSession() {
    return session.fromPartition(CHATGPT_PARTITION);
  }

  async request({
    url,
    method = "GET",
    headers = {},
    body = null,
    targetSession = this.chatgptSession
  }) {
    return new Promise((resolve, reject) => {
      const request = net.request({
        method,
        url,
        session: targetSession,
        useSessionCookies: true
      });

      request.setHeader("User-Agent", USER_AGENT);
      Object.entries(headers || {}).forEach(([key, value]) => {
        if (value != null && value !== "") {
          request.setHeader(key, value);
        }
      });

      request.on("response", (response) => {
        let text = "";

        response.on("data", (chunk) => {
          text += chunk.toString();
        });

        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            text,
            json: safeJsonParse(text)
          });
        });
      });

      request.on("error", reject);
      
      // 타임아웃 처리 (10초)
      request.on("timeout", () => {
        request.abort();
        reject(new Error("Request timeout"));
      });

      if (body) {
        request.write(body);
      }

      request.end();
    });
  }

  async getChatgptCookie(name) {
    const cookies = await this.chatgptSession.cookies.get({
      url: CHATGPT_URL
    });

    // name으로 시작하는 첫 번째 쿠키 반환 (다중 계정 대응: .0, .1 등)
    return cookies.find(c => c.name.startsWith(name)) || null;
  }

  async getGeminiCookie() {
    const cookies = await this.chatgptSession.cookies.get({
      url: "https://gemini.google.com",
      name: "__Secure-1PSID"
    });

    return cookies[0] || null;
  }

  async getAccessToken({ forceRefresh = false } = {}) {
    if (this.accessToken && !forceRefresh) {
      return this.accessToken;
    }

    try {
      const response = await this.request({
        url: CHATGPT_SESSION_ENDPOINT,
        headers: {
          Accept: "application/json",
          Referer: `${CHATGPT_URL}/`,
          Origin: CHATGPT_URL
        }
      }).catch(() => ({ statusCode: 0 }));

      // 200 OK이면서 accessToken이 문자열로 존재해야 실제 연결된 것으로 간주
      const token = response.statusCode === 200 && typeof response.json?.accessToken === "string"
        ? response.json.accessToken
        : null;

      this.accessToken = token;
      return token;
    } catch (_error) {
      this.accessToken = null;
      return null;
    }
  }

  async getConnectionState({ forceRefresh = false, provider = null } = {}) {
    const now = Date.now();
    if (!forceRefresh && now - this.lastConnectionState.checkedAt < 10000) {
      return this.lastConnectionState;
    }

    let nextState = {
      connected: false,
      provider: null,
      reason: "disconnected",
      checkedAt: now
    };

    try {
      // 로그인 중이면 검증 건너뜀 (창 충돌 방지)
      if (this.isLoggingIn && !forceRefresh) {
        return this.lastConnectionState;
      }

      const sessionCookie = await this.getChatgptCookie("__Secure-next-auth.session-token");
      const geminiCookie = await this.getGeminiCookie();

      // ChatGPT 검증
      let chatgptConnected = false;
      let chatgptReason = "disconnected";

      if (sessionCookie) {
        // 쿠키가 존재하면 연결된 것으로 간주
        chatgptConnected = true;
        chatgptReason = "ok";
      }

      // Gemini 검증
      const geminiConnected = !!geminiCookie;

      // 상태 결정 로직
      // 요청된 provider가 있다면 그 결과를 최우선으로 반영
      if (provider === "chatgpt") {
        nextState = {
          connected: chatgptConnected,
          provider: "chatgpt",
          reason: chatgptReason,
          checkedAt: now
        };
      } else if (provider === "gemini") {
        nextState = {
          connected: geminiConnected,
          provider: "gemini",
          reason: geminiConnected ? "ok" : "disconnected",
          checkedAt: now
        };
      } else {
        // provider가 명시되지 않은 경우, 현재 활성화된 것을 우선 (ChatGPT 우선)
        if (chatgptConnected) {
          nextState = {
            connected: true,
            provider: "chatgpt",
            reason: "ok",
            checkedAt: now
          };
        } else if (geminiConnected) {
          nextState = {
            connected: true,
            provider: "gemini",
            reason: "ok",
            checkedAt: now
          };
        } else if (sessionCookie) {
          // 쿠키는 있지만 토큰이 없는 ChatGPT 상태
          nextState = {
            connected: false,
            provider: "chatgpt",
            reason: "token_fetch_failed",
            checkedAt: now
          };
        }
      }
    } catch (error) {
      nextState = {
        connected: false,
        provider: null,
        reason: error.message || "status_check_failed",
        checkedAt: now
      };
    }

    this.lastConnectionState = nextState;
    return nextState;
  }

  async isConnected() {
    const state = await this.getConnectionState();
    return state.connected ? state.provider : null;
  }

  async requireLogin(provider = "chatgpt") {
    return new Promise((resolve) => {
      if (this.loginWindow) {
        this.loginWindow.focus();
        return;
      }

      this.isLoggingIn = true;
      const isGemini = provider === "gemini";
      const targetUrl = isGemini ? GEMINI_URL : CHATGPT_URL;
      const title = isGemini
        ? "Jarvis 연동을 위한 Gemini 로그인 (완료 시 창이 자동으로 닫힙니다)"
        : "Jarvis 연동을 위한 ChatGPT 로그인 (완료 시 창이 자동으로 닫힙니다)";

      this.loginWindow = new BrowserWindow({
        width: 900,
        height: 860,
        title,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          partition: CHATGPT_PARTITION
        }
      });

      this.loginWindow.loadURL(targetUrl);

      const finish = async () => {
        const state = await this.getConnectionState({
          forceRefresh: true,
          provider
        });
        if (!state.connected || state.provider !== provider) {
          return false;
        }

        this.loginWindow?.close();
        resolve(provider === "chatgpt" ? this.accessToken : true);
        return true;
      };

      const checkLogin = async (_event, url = "") => {
        if (isGemini) {
          if (url.startsWith(GEMINI_URL)) {
            await finish();
          }
          return;
        }

        if (url === `${CHATGPT_URL}/` || url.startsWith(`${CHATGPT_URL}/c/`)) {
          await finish();
        }
      };

      this.loginWindow.webContents.on("did-navigate", checkLogin);
      this.loginWindow.webContents.on("did-navigate-in-page", checkLogin);

      const pollInterval = setInterval(async () => {
        if (!this.loginWindow) {
          clearInterval(pollInterval);
          return;
        }

        await finish();
      }, 2500);

      this.loginWindow.on("closed", () => {
        clearInterval(pollInterval);
        this.loginWindow = null;
        this.isLoggingIn = false;
        resolve(provider === "chatgpt" ? this.accessToken : false);
      });
    });
  }

  buildConversationPayload(prompt) {
    return {
      action: "next",
      messages: [
        {
          id: crypto.randomUUID(),
          author: {
            role: "user"
          },
          content: {
            content_type: "text",
            parts: [String(prompt || "")]
          }
        }
      ],
      parent_message_id: crypto.randomUUID(),
      model: "auto",
      timezone_offset_min: -new Date().getTimezoneOffset(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto",
      suggestions: [],
      history_and_training_disabled: false,
      conversation_mode: {
        kind: "primary_assistant"
      },
      websocket_request_id: crypto.randomUUID()
    };
  }

  parseConversationEvents(rawText = "") {
    const events = [];
    let buffer = "";

    for (const line of String(rawText).split(/\r?\n/)) {
      if (!line.startsWith("data:")) {
        continue;
      }

      const payload = line.slice(5).trim();
      if (!payload) {
        continue;
      }

      if (payload === "[DONE]") {
        break;
      }

      buffer += payload;
      const parsed = safeJsonParse(buffer);
      if (parsed) {
        events.push(parsed);
        buffer = "";
      }
    }

    return events;
  }

  async chat(prompt, provider = "chatgpt") {
    if (provider !== "chatgpt") {
      return this._chatViaDOM_Gemini(prompt);
    }

    console.log("[WebAI] Attempting to fetch ChatGPT token...");
    let token = await this.getAccessToken();
    let state = await this.getConnectionState({ provider: "chatgpt" });
    
    if (!state.connected) {
      console.log("[WebAI] Not connected. Requiring login...");
      await this.requireLogin("chatgpt");
      state = await this.getConnectionState({ provider: "chatgpt" });
      if (!state.connected) {
        throw new Error("User did not log in to ChatGPT.");
      }
      token = this.accessToken;
    }

    if (token) {
      try {
        console.log("[WebAI] Token found. Sending direct API request...");
        return await this._chatViaBackendApi(prompt, token);
      } catch (error) {
        console.warn("[WebAI] Direct API failed. Falling back to DOM automation:", error.message);
        this.accessToken = null;
        return this._chatViaDOM_ChatGPT(prompt);
      }
    } else {
      console.warn("[WebAI] Token fetch returned null (likely Cloudflare block). Using DOM automation fallback.");
      return this._chatViaDOM_ChatGPT(prompt);
    }
  }

  async _chatViaBackendApi(prompt, token) {
    const response = await this.request({
      method: "POST",
      url: CHATGPT_CONVERSATION_ENDPOINT,
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: CHATGPT_URL,
        Referer: `${CHATGPT_URL}/`,
        "OAI-Device-Id": this.deviceId
      },
      body: JSON.stringify(this.buildConversationPayload(prompt))
    });

    if (response.statusCode >= 400) {
      throw new Error(`ChatGPT backend returned ${response.statusCode}: ${response.text.slice(0, 300)}`);
    }

    const events = this.parseConversationEvents(response.text);
    const parts = uniqueTextParts(events.map(extractAssistantText).filter(Boolean));
    const text = parts.join("\n\n").trim();

    if (!text) {
      throw new Error("Direct ChatGPT backend response did not include assistant text.");
    }

    return text;
  }

  async ensureChatWindow(targetUrl) {
    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      return this.chatWindow;
    }

    this.chatWindow = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      webPreferences: {
        partition: CHATGPT_PARTITION,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    await this.chatWindow.loadURL(targetUrl);
    await wait(2500);
    return this.chatWindow;
  }

  async _chatViaDOM_ChatGPT(prompt) {
    const chatWindow = await this.ensureChatWindow(`${CHATGPT_URL}/`);
    const escapedPrompt = JSON.stringify(prompt);
    const script = `
      (async function() {
        try {
          // 입력창이 렌더링될 때까지 최대 5초 대기 (Polling)
          let textarea = null;
          for (let i = 0; i < 50; i++) {
            textarea = document.querySelector('#prompt-textarea') || 
                       document.querySelector('div[contenteditable="true"]') ||
                       document.querySelector('textarea');
            if (textarea) break;
            await new Promise(r => setTimeout(r, 100));
          }

          if (!textarea) return { error: "Chat input not found after 5 seconds." };
          
          // Clear and set value
          textarea.value = ${escapedPrompt};
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));

          // Wait a moment for the Send button to enable
          await new Promise((resolve) => setTimeout(resolve, 500));

          const findSendButton = () => {
            return document.querySelector('button[data-testid="send-button"]') ||
                   document.querySelector('button[aria-label="Send message"]') ||
                   document.querySelector('button.absolute.bottom-1.5');
          };

          const sendBtn = findSendButton();
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
          } else {
            // Fallback: Try Enter key multiple times
            const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, ctrlKey: true });
            textarea.dispatchEvent(enter);
          }

          return await new Promise((resolve) => {
            let lastText = "";
            let checkCount = 0;
            const interval = setInterval(() => {
              checkCount += 1;
              const assistants = document.querySelectorAll('div[data-message-author-role="assistant"]');
              const sendBtnNow = findSendButton();

              if (assistants.length > 0) {
                const currentText = assistants[assistants.length - 1].innerText;
                if (currentText !== lastText) {
                  lastText = currentText;
                }
              }

              // Generation is done when send button is enabled again
              // We wait at least 10 checks (200ms) to ensure it started
              const isDone = sendBtnNow && !sendBtnNow.disabled && checkCount > 5;
              if (isDone) {
                clearInterval(interval);
                resolve({ text: lastText });
              } else if (checkCount > 1500) { // 30 seconds timeout
                clearInterval(interval);
                resolve({ text: lastText || "Timeout", timeout: true });
              }
            }, 20);
          });
        } catch (err) {
          return { error: err.message };
        }
      })();
    `;

    const result = await chatWindow.webContents.executeJavaScript(script);
    if (result?.error) {
      throw new Error(result.error);
    }
    return result?.text || "";
  }

  async _chatViaDOM_Gemini(prompt) {
    const chatWindow = await this.ensureChatWindow(GEMINI_URL);
    const escapedPrompt = JSON.stringify(prompt);
    const script = `
      (async function() {
        try {
          const textarea = document.querySelector('div[role="textbox"][contenteditable="true"]') || document.querySelector('rich-textarea');
          if (!textarea) return { error: "Gemini input not found." };

          textarea.innerHTML = ${escapedPrompt}.replace(/\\n/g, '<br>');
          textarea.dispatchEvent(new Event('input', { bubbles: true }));

          await new Promise((resolve) => setTimeout(resolve, 180));
          const sendBtn = document.querySelector('button[aria-label="Send message"], button[aria-label="메시지 전송"]');
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
          } else {
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }

          return await new Promise((resolve) => {
            let lastText = "";
            let checkCount = 0;
            const interval = setInterval(() => {
              checkCount += 1;
              const messages = document.querySelectorAll('message-content');
              const sendBtnNow = document.querySelector('button[aria-label="Send message"], button[aria-label="메시지 전송"]');

              if (messages.length > 0) {
                lastText = messages[messages.length - 1].innerText;
              }

              if (sendBtnNow && checkCount > 20) {
                clearInterval(interval);
                resolve({ text: lastText });
              } else if (checkCount > 450) {
                clearInterval(interval);
                resolve({ text: lastText || "Timeout", timeout: true });
              }
            }, 100);
          });
        } catch (err) {
          return { error: err.message };
        }
      })();
    `;

    const result = await chatWindow.webContents.executeJavaScript(script);
    if (result?.error) {
      throw new Error(result.error);
    }
    return result?.text || "";
  }
}

module.exports = new UnofficialAIProvider();
