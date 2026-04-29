const { BrowserWindow, session, net } = require("electron");
const crypto = require("crypto");
const piiManager = require("./pii-manager.cjs");

const CHATGPT_URL = "https://chatgpt.com";
const CHATGPT_PARTITION = "persist:chatgpt";
const CHATGPT_SESSION_ENDPOINT = `${CHATGPT_URL}/api/auth/session`;
const CHATGPT_CONVERSATION_ENDPOINT = `${CHATGPT_URL}/backend-api/conversation`;
const GEMINI_URL = "https://gemini.google.com/app";
const GEMINI_ORIGIN = "https://gemini.google.com";
const GOOGLE_GEMINI_LOGIN_URL =
  `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(GEMINI_URL)}&service=wise`;
const CLAUDE_CHAT_URL = "https://claude.ai/new";
const CLAUDE_LOGIN_URL = "https://claude.ai/login";
const CLAUDE_ORIGIN = "https://claude.ai";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ACTIVE_WEB_PROVIDER_KEY = "webai.activeProvider";

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

function getUrlOrigin(url = "") {
  try {
    return new URL(url).origin;
  } catch (_error) {
    return "";
  }
}

function normalizeWebProvider(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["chatgpt", "gemini"].includes(normalized) ? normalized : null;
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
    this.loginProvider = null;
    this.chatWindow = null;
    this.activeWebProvider = normalizeWebProvider(piiManager.get(ACTIVE_WEB_PROVIDER_KEY));
    this.deviceId = crypto.randomUUID();
    this.isLoggingIn = false;
    this.claudeSessionVerified = false;
    this.lastConnectionState = {
      connected: false,
      provider: null,
      reason: "unknown",
      checkedAt: 0
    };
    this.webModelProvider = null;
  }

  async logout() {
    this.accessToken = null;
    this.claudeSessionVerified = false;
    this.activeWebProvider = null;
    piiManager.delete(ACTIVE_WEB_PROVIDER_KEY);
    if (this.chatWindow && !this.chatWindow.isDestroyed()) {
      this.chatWindow.close();
    }
    this.chatWindow = null;
    await this.chatgptSession.clearStorageData({
      storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"]
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
      url: GEMINI_ORIGIN,
      name: "__Secure-1PSID"
    });

    return cookies[0] || null;
  }

  async getClaudeCookie() {
    const cookies = await this.chatgptSession.cookies.get({
      url: CLAUDE_ORIGIN
    });

    return cookies.find((cookie) => {
      const name = String(cookie.name || "");
      return /^(sessionKey|__Secure-next-auth\.session-token|claude.*session|.*auth.*token)$/i.test(name);
    }) || null;
  }

  async hasClaudeChatAccess() {
    const response = await this.request({
      url: `${CLAUDE_ORIGIN}/api/organizations`,
      headers: {
        Accept: "application/json",
        Referer: `${CLAUDE_ORIGIN}/`
      }
    }).catch(() => null);

    return response?.statusCode === 200;
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
    if (
      !forceRefresh &&
      now - this.lastConnectionState.checkedAt < 10000 &&
      (!provider || this.lastConnectionState.provider === provider)
    ) {
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
      const activeProviderConnected =
        (this.activeWebProvider === "chatgpt" && chatgptConnected) ||
        (this.activeWebProvider === "gemini" && geminiConnected);

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
        if (activeProviderConnected) {
          nextState = {
            connected: true,
            provider: this.activeWebProvider,
            reason: "ok",
            checkedAt: now
          };
        } else if (chatgptConnected) {
          // provider가 명시되지 않은 경우, 현재 활성화된 것을 우선하고 그다음 기존 우선순위를 사용한다.
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

  setActiveWebProvider(provider) {
    const normalized = normalizeWebProvider(provider);
    if (!normalized) {
      return null;
    }

    this.activeWebProvider = normalized;
    piiManager.set(ACTIVE_WEB_PROVIDER_KEY, normalized);
    this.lastConnectionState = {
      connected: true,
      provider: normalized,
      reason: "selected",
      checkedAt: Date.now()
    };
    return normalized;
  }

  setWebModelProvider(fn) {
    this.webModelProvider = typeof fn === "function" ? fn : null;
  }

  getSelectedWebModel(provider = "") {
    if (!this.webModelProvider) {
      return "auto";
    }

    try {
      const web = this.webModelProvider() || {};
      if (web.provider && web.provider !== provider) {
        return "auto";
      }
      return String(web.model || "auto").trim() || "auto";
    } catch (_error) {
      return "auto";
    }
  }

  async requireLogin(provider = "chatgpt") {
    await this.logout();

    return new Promise((resolve) => {
      const isGemini = provider === "gemini";
      const isClaude = provider === "claude";
      const targetUrl = isGemini ? GOOGLE_GEMINI_LOGIN_URL : isClaude ? CLAUDE_LOGIN_URL : CHATGPT_URL;
      const title = isGemini
        ? "Jarvis 연동을 위한 Gemini 로그인 (완료 시 창이 자동으로 닫힙니다)"
        : isClaude
          ? "Jarvis 연동을 위한 Claude 로그인 (로그인 완료 후 직접 창을 닫아주세요)"
          : "Jarvis 연동을 위한 ChatGPT 로그인 (완료 시 창이 자동으로 닫힙니다)";

      if (this.loginWindow && !this.loginWindow.isDestroyed()) {
        this.loginWindow.close();
        this.loginWindow = null;
      }

      this.isLoggingIn = true;
      this.loginProvider = provider;

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

      const openGeminiLoginIfLandingPage = async () => {
        if (!isGemini || !this.loginWindow || this.loginWindow.isDestroyed()) {
          return;
        }

        const currentUrl = this.loginWindow.webContents.getURL();
        if (!currentUrl.startsWith(GEMINI_ORIGIN)) {
          return;
        }

        const didClick = await this.loginWindow.webContents.executeJavaScript(`
          (() => {
            const candidates = Array.from(document.querySelectorAll("a, button"));
            const loginTarget = candidates.find((element) => {
              const text = (element.innerText || element.textContent || "").trim();
              const aria = element.getAttribute("aria-label") || "";
              const href = element.getAttribute("href") || "";
              return /로그인|sign in|login/i.test(text) ||
                /로그인|sign in|login/i.test(aria) ||
                /accounts\\.google\\.com/i.test(href);
            });

            if (!loginTarget) {
              return false;
            }

            loginTarget.click();
            return true;
          })();
        `).catch(() => false);

        if (!didClick && !currentUrl.startsWith("https://accounts.google.com")) {
          await this.loginWindow.loadURL(GOOGLE_GEMINI_LOGIN_URL);
        }
      };

      const finish = async () => {
        if (isClaude) {
          return false;
        }

        const state = await this.getConnectionState({
          forceRefresh: true,
          provider
        });
        if (!state.connected || state.provider !== provider) {
          return false;
        }

        this.loginWindow?.close();
        this.setActiveWebProvider(provider);
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

        if (isClaude) {
          return;
        }

        if (url === `${CHATGPT_URL}/` || url.startsWith(`${CHATGPT_URL}/c/`)) {
          await finish();
        }
      };

      this.loginWindow.webContents.on("did-navigate", checkLogin);
      this.loginWindow.webContents.on("did-navigate-in-page", checkLogin);
      this.loginWindow.webContents.on("did-finish-load", () => {
        void openGeminiLoginIfLandingPage();
      });

      const pollInterval = isClaude ? null : setInterval(async () => {
        if (!this.loginWindow) {
          clearInterval(pollInterval);
          return;
        }

        await finish();
      }, 2500);

      this.loginWindow.on("closed", () => {
        if (pollInterval) {
          clearInterval(pollInterval);
        }
        this.loginWindow = null;
        this.loginProvider = null;
        this.isLoggingIn = false;
        if (isClaude) {
          void (async () => {
            const connected = await this.hasClaudeChatAccess();
            if (connected) {
              this.claudeSessionVerified = true;
              this.setActiveWebProvider("claude");
            }
            resolve(connected);
          })();
          return;
        }
        resolve(provider === "chatgpt" ? this.accessToken : false);
      });
    });
  }

  buildConversationPayload(prompt, model = "auto") {
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
      model: model || "auto",
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
    const selectedModel = this.getSelectedWebModel(provider);
    if (provider === "gemini") {
      const state = await this.getConnectionState({ provider: "gemini" });
      if (!state.connected) {
        throw new Error("Gemini site login is not connected. Please reconnect Google/Gemini in Web AI Management.");
      }
      return this._chatViaDOM_Gemini(prompt, selectedModel);
    }

    if (provider === "claude") {
      const state = await this.getConnectionState({ provider: "claude" });
      if (!state.connected) {
        throw new Error("Claude site login is not connected. Please reconnect Anthropic/Claude in Web AI Management.");
      }
      return this._chatViaDOM_Claude(prompt, selectedModel);
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

    if (token && selectedModel === "auto") {
      try {
        console.log("[WebAI] Token found. Sending direct API request...");
        return await this._chatViaBackendApi(prompt, token, selectedModel);
      } catch (error) {
        console.warn("[WebAI] Direct API failed. Falling back to DOM automation:", error.message);
        this.accessToken = null;
        return this._chatViaDOM_ChatGPT(prompt, selectedModel);
      }
    } else {
      console.warn("[WebAI] Token fetch returned null (likely Cloudflare block). Using DOM automation fallback.");
      return this._chatViaDOM_ChatGPT(prompt, selectedModel);
    }
  }

  async _chatViaBackendApi(prompt, token, model = "auto") {
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
      body: JSON.stringify(this.buildConversationPayload(prompt, model))
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
      const currentUrl = this.chatWindow.webContents.getURL();
      const currentOrigin = getUrlOrigin(currentUrl);
      const targetOrigin = getUrlOrigin(targetUrl);

      if (currentOrigin === targetOrigin) {
        if (!currentUrl || currentUrl === "about:blank") {
          await this.chatWindow.loadURL(targetUrl);
          await wait(2500);
        }
        return this.chatWindow;
      }

      await this.chatWindow.loadURL(targetUrl);
      await wait(2500);
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

  async selectWebModel(chatWindow, model = "auto") {
    const cleanModel = String(model || "auto").trim();
    if (!cleanModel || cleanModel === "auto") {
      return false;
    }

    const escapedModel = JSON.stringify(cleanModel);
    return chatWindow.webContents.executeJavaScript(`
      (async function() {
        const wanted = ${escapedModel}.toLowerCase();
        const aliases = {
          "chatgpt-auto": ["auto", "자동", "default"],
          "chatgpt-instant": ["instant", "빠른", "fast"],
          "chatgpt-thinking": ["thinking", "생각", "reason"],
          "chatgpt-pro": ["pro", "프로"],
          "gemini-3-pro-preview": ["gemini 3 pro", "3 pro", "pro"],
          "gemini-3-flash-preview": ["gemini 3 flash", "3 flash", "flash"],
          "gemini-2.5-flash": ["2.5 flash", "flash"],
          "gemini-2.5-pro": ["2.5 pro", "pro"],
          "gemini-2.5-flash-lite": ["flash-lite", "flash lite", "lite"],
          "gemini-1.5-flash-latest": ["1.5 flash", "flash"],
          "gemini-fast": ["빠른 모델", "fast model", "flash"],
          "gemini-advanced": ["고급 모델", "advanced", "pro"],
          "gemini-deep-think": ["deep think", "딥 씽크", "깊게"],
          "claude-haiku-4-5": ["haiku", "하이쿠"],
          "claude-sonnet-4-6": ["sonnet", "소넷"],
          "claude-opus-4-7": ["opus", "오퍼스"]
        };
        const needles = aliases[wanted] || [wanted];
        const norm = (value) => String(value || "").trim().toLowerCase();
        const includesWanted = (value) => needles.some((needle) => norm(value).includes(norm(needle)));

        const clickCandidate = (elements) => {
          const target = Array.from(elements).find((element) => {
            const text = element.innerText || element.textContent || element.getAttribute("aria-label") || "";
            return includesWanted(text);
          });
          if (target) {
            target.click();
            return true;
          }
          return false;
        };

        if (clickCandidate(document.querySelectorAll('[role="option"], [role="menuitem"], button, div[role="button"]'))) {
          return true;
        }

        const buttons = Array.from(document.querySelectorAll("button, div[role='button']"));
        const picker = buttons.find((button) => {
          const text = button.innerText || button.textContent || button.getAttribute("aria-label") || "";
          return /model|모델|gpt|gemini|claude|haiku|sonnet|opus|fast|pro|flash|thinking/i.test(text);
        });
        if (!picker) {
          return false;
        }

        picker.click();
        await new Promise((resolve) => setTimeout(resolve, 500));
        return clickCandidate(document.querySelectorAll('[role="option"], [role="menuitem"], button, div[role="button"]'));
      })();
    `).catch(() => false);
  }

  async _chatViaDOM_ChatGPT(prompt, model = "auto") {
    const chatWindow = await this.ensureChatWindow(`${CHATGPT_URL}/`);
    await this.selectWebModel(chatWindow, model);
    const escapedPrompt = JSON.stringify(prompt);
    const script = `
      (async function() {
        try {
          const isUsable = (element) => {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            return style.visibility !== "hidden" && style.display !== "none" && !element.disabled;
          };

          const findInput = () => {
            const selectors = [
              '#prompt-textarea',
              'textarea',
              'div[contenteditable="true"][role="textbox"]',
              'div[contenteditable="true"]'
            ];
            for (const selector of selectors) {
              const element = Array.from(document.querySelectorAll(selector)).find(isUsable);
              if (element) return element;
            }
            return null;
          };

          const setInputValue = (input, value) => {
            input.focus();
            if ("value" in input) {
              input.value = value;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
              return;
            }

            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(input);
            selection.removeAllRanges();
            selection.addRange(range);

            let inserted = false;
            try {
              const dataTransfer = new DataTransfer();
              dataTransfer.setData("text/plain", value);
              const pasteEvent = new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer
              });
              input.dispatchEvent(pasteEvent);
              inserted = (input.innerText || input.textContent || "").includes(value);
            } catch (_error) {
              inserted = false;
            }

            if (!inserted) {
              input.dispatchEvent(new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType: "insertText",
                data: value
              }));
              input.textContent = value;
            }

            input.dispatchEvent(new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data: value
            }));
          };

          const findSendButton = () => {
            const directMatch = document.querySelector('button[data-testid="send-button"]');
            if (isUsable(directMatch) && directMatch.getAttribute("aria-disabled") !== "true") {
              return directMatch;
            }

            const buttons = Array.from(document.querySelectorAll("button, div[role='button']"));
            return buttons.find((button) => {
              if (!isUsable(button) || button.getAttribute("aria-disabled") === "true") return false;
              const text = [
                button.getAttribute("aria-label"),
                button.getAttribute("data-testid"),
                button.textContent,
                button.innerText
              ].filter(Boolean).join(" ");
              return /send|submit|전송|보내기/i.test(text) && !/stop|cancel|중지/i.test(text);
            }) || null;
          };

          // 입력창이 렌더링될 때까지 최대 5초 대기 (Polling)
          let textarea = null;
          for (let i = 0; i < 50; i++) {
            textarea = findInput();
            if (textarea) break;
            await new Promise(r => setTimeout(r, 100));
          }

          if (!textarea) return { error: "Chat input not found after 5 seconds." };
          
          setInputValue(textarea, ${escapedPrompt});

          // Wait a moment for the Send button to enable
          await new Promise((resolve) => setTimeout(resolve, 500));

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

  async _chatViaDOM_Gemini(prompt, model = "auto") {
    const chatWindow = await this.ensureChatWindow(GEMINI_URL);
    await this.selectWebModel(chatWindow, model);
    const escapedPrompt = JSON.stringify(prompt);
    const script = `
      (async function() {
        try {
          const prompt = ${escapedPrompt};
          if (/accounts\\.google\\.com|signin|login/i.test(location.href)) {
            return { error: "Gemini is showing a login page. Please reconnect Gemini in Web AI Management." };
          }
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const isUsable = (element) => {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            return style.visibility !== "hidden" && style.display !== "none" && !element.disabled;
          };
          const findInput = () => {
            const selectors = [
              'rich-textarea [contenteditable="true"]',
              'rich-textarea textarea',
              'div[role="textbox"][contenteditable="true"]',
              'div.ql-editor[contenteditable="true"]',
              '[contenteditable="true"]',
              'textarea'
            ];
            for (const selector of selectors) {
              const element = Array.from(document.querySelectorAll(selector)).find(isUsable);
              if (element) return element;
            }
            const richTextArea = document.querySelector("rich-textarea");
            if (richTextArea?.shadowRoot) {
              return richTextArea.shadowRoot.querySelector('[contenteditable="true"], textarea');
            }
            return null;
          };
          const collectText = () => {
            const nodes = [
              ...document.querySelectorAll("message-content"),
              ...document.querySelectorAll('[data-response-index]'),
              ...document.querySelectorAll(".model-response-text"),
              ...document.querySelectorAll(".markdown"),
              ...document.querySelectorAll('[class*="response"]')
            ];
            const texts = nodes
              .map((node) => (node.innerText || node.textContent || "").trim())
              .filter(Boolean)
              .filter((text) => text !== prompt)
              .filter((text) => !text.includes("User request:"))
              .filter((text) => !/Follow the conversation naturally|당신은 유능하고 친절한 AI 비서/i.test(text))
              .filter((text) => !/Gemini에게 물어보기|Ask Gemini|로그인|Login/i.test(text));
            return texts[texts.length - 1] || "";
          };
          const baselineText = collectText();

          let input = null;
          for (let i = 0; i < 100; i++) {
            input = findInput();
            if (input) break;
            await sleep(100);
          }

          if (!input) return { error: "Gemini input not found. The site UI may not be logged in or has changed." };

          input.focus();
          if ("value" in input) {
            input.value = prompt;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(input);
            selection.removeAllRanges();
            selection.addRange(range);

            let inserted = false;
            try {
              const dataTransfer = new DataTransfer();
              dataTransfer.setData("text/plain", prompt);
              const pasteEvent = new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer
              });
              input.dispatchEvent(pasteEvent);
              inserted = (input.innerText || input.textContent || "").includes(prompt);
            } catch (_error) {
              inserted = false;
            }

            if (!inserted) {
              input.dispatchEvent(new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType: "insertText",
                data: prompt
              }));
              input.textContent = prompt;
            }

            input.dispatchEvent(new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data: prompt
            }));
          }

          await sleep(400);
          const findSendButton = () => {
            const buttons = Array.from(document.querySelectorAll("button"));
            return buttons.find((button) => {
              if (!isUsable(button) || button.getAttribute("aria-disabled") === "true") return false;
              const text = [
                button.getAttribute("aria-label"),
                button.getAttribute("data-testid"),
                button.textContent,
                button.innerText
              ].filter(Boolean).join(" ");
              return /send|submit|전송|보내기|메시지 전송/i.test(text);
            });
          };

          const sendBtn = findSendButton();
          if (sendBtn) {
            sendBtn.click();
          } else {
            input.dispatchEvent(new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true
            }));
          }

          return await new Promise((resolve) => {
            let lastText = "";
            let stableCount = 0;
            let checkCount = 0;
            const interval = setInterval(() => {
              checkCount += 1;
              const currentText = collectText();

              if (currentText && currentText !== baselineText && currentText !== lastText) {
                lastText = currentText;
                stableCount = 0;
              } else if (lastText) {
                stableCount += 1;
              }

              const sendReady = !!findSendButton();
              if (lastText && sendReady && stableCount > 8 && checkCount > 20) {
                clearInterval(interval);
                resolve({ text: lastText });
              } else if (checkCount > 300) {
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
    if (result?.timeout) {
      throw new Error("Gemini site reply timed out after 30 seconds. The page may be blocked, logged out, still generating, or the UI changed.");
    }
    if (!String(result?.text || "").trim()) {
      throw new Error("Gemini site returned an empty reply. Please reconnect Gemini or try the API/Ollama path.");
    }
    return result?.text || "";
  }

  async _chatViaDOM_Claude(prompt, model = "auto") {
    const chatWindow = await this.ensureChatWindow(CLAUDE_CHAT_URL);
    await this.selectWebModel(chatWindow, model);
    const escapedPrompt = JSON.stringify(prompt);
    const script = `
      (async function() {
        try {
          const prompt = ${escapedPrompt};
          if (/login|signin/i.test(location.href)) {
            return { error: "Claude is showing a login page. Please reconnect Claude in Web AI Management." };
          }
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const isUsable = (element) => {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            return style.visibility !== "hidden" && style.display !== "none" && !element.disabled;
          };
          const collectText = () => {
            const selectors = [
              '[data-testid="chat-message-assistant"]',
              '[data-testid*="assistant"]',
              '[data-is-streaming="true"]',
              '.font-claude-message',
              'div.prose',
              '[class*="assistant"] [class*="message"]',
              '[class*="message"]'
            ];
            const nodes = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
            const texts = nodes
              .map((node) => (node.innerText || node.textContent || "").trim())
              .filter(Boolean)
              .filter((text) => text !== prompt)
              .filter((text) => !text.includes("User request:"))
              .filter((text) => !/Follow the conversation naturally|당신은 유능하고 친절한 AI 비서/i.test(text))
              .filter((text) => !/Talk to Claude|Message Claude|로그인|Login/i.test(text));
            return texts[texts.length - 1] || "";
          };
          const baselineText = collectText();

          let editor = null;
          for (let i = 0; i < 80; i++) {
            const candidates = [
              ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
              ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
              ...document.querySelectorAll('[data-testid*="chat-input"] [contenteditable="true"]'),
              ...document.querySelectorAll('div[contenteditable="true"]'),
              ...document.querySelectorAll('textarea')
            ];
            editor = candidates.find(isUsable) || null;
            if (editor) break;
            await sleep(100);
          }

          if (!editor) return { error: "Claude input not found. The site UI may not be logged in or has changed." };

          editor.focus();

          if ("value" in editor) {
            editor.value = prompt;
            editor.dispatchEvent(new Event("input", { bubbles: true }));
            editor.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            editor.textContent = "";
            document.execCommand("selectAll", false, null);
            document.execCommand("insertText", false, prompt);
            editor.dispatchEvent(new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data: prompt
            }));
          }

          await sleep(500);

          const findSendButton = () => {
            const buttons = Array.from(document.querySelectorAll("button"));
            return buttons.find((button) => {
              if (!isUsable(button) || button.getAttribute("aria-disabled") === "true") return false;
              const text = [
                button.getAttribute("aria-label"),
                button.getAttribute("data-testid"),
                button.textContent,
                button.innerText
              ].filter(Boolean).join(" ");
              return /send|submit|보내기|전송/i.test(text);
            });
          };

          const sendBtn = findSendButton();
          if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute("aria-disabled") !== "true") {
            sendBtn.click();
          } else {
            editor.dispatchEvent(new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true
            }));
          }

          return await new Promise((resolve) => {
            let lastText = "";
            let stableCount = 0;
            let checkCount = 0;

            const interval = setInterval(() => {
              checkCount += 1;
              const currentText = collectText();
              const sendBtnNow = findSendButton();

              if (currentText && currentText !== baselineText && currentText !== lastText) {
                lastText = currentText;
                stableCount = 0;
              } else if (lastText) {
                stableCount += 1;
              }

              const sendReady = sendBtnNow && !sendBtnNow.disabled && sendBtnNow.getAttribute("aria-disabled") !== "true";
              if (lastText && sendReady && stableCount > 8 && checkCount > 20) {
                clearInterval(interval);
                resolve({ text: lastText });
              } else if (checkCount > 300) {
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
    if (result?.timeout) {
      throw new Error("Claude site reply timed out after 30 seconds. The page may be blocked, logged out, still generating, or the UI changed.");
    }
    if (!String(result?.text || "").trim()) {
      throw new Error("Claude site returned an empty reply. Please reconnect Claude or try the API/Ollama path.");
    }
    return result?.text || "";
  }
}

module.exports = new UnofficialAIProvider();
