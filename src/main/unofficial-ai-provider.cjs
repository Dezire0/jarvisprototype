const { BrowserWindow, session, net } = require("electron");
const crypto = require("crypto");
const safeJsonParse = (str) => {
  try { return JSON.parse(str); } catch (e) { return null; }
};

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
    this.isLoggingIn = false;
  }

  /**
   * Check if user is already logged in to any provider without prompting.
   * Returns 'chatgpt', 'gemini', or null.
   */
  async isConnected() {
    const chatgptSession = session.fromPartition("persist:chatgpt");
    
    // Check ChatGPT
    if (this.accessToken) return "chatgpt";
    const gptCookies = await chatgptSession.cookies.get({ url: "https://chatgpt.com", name: "__Secure-next-auth.session-token" });
    if (gptCookies.length > 0) return "chatgpt";

    // Check Gemini
    const geminiCookies = await chatgptSession.cookies.get({ url: "https://gemini.google.com", name: "__Secure-1PSID" });
    if (geminiCookies.length > 0) return "gemini";

    return null;
  }

  /**
   * Check if we have a valid session, otherwise prompt login.
   */
  async getAccessToken() {
    if (this.accessToken) return this.accessToken;

    const chatgptSession = session.fromPartition("persist:chatgpt");

    // Plan-based extraction: check for the session token cookie directly
    const cookies = await chatgptSession.cookies.get({ name: "__Secure-next-auth.session-token" });
    if (cookies.length > 0) {
      console.log("Extracted session token from cookie.");
    }

    return new Promise((resolve, reject) => {
      const request = net.request({
        url: "https://chatgpt.com/api/auth/session",
        session: chatgptSession,
        useSessionCookies: true
      });
      
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
   * @param {string} provider 'chatgpt' | 'gemini'
   */
  async requireLogin(provider = "chatgpt") {
    return new Promise((resolve) => {
      if (this.loginWindow) {
        this.loginWindow.focus();
        return;
      }

      this.isLoggingIn = true;
      const isGemini = provider === "gemini";
      const targetUrl = isGemini ? "https://gemini.google.com/app" : "https://chatgpt.com";
      const title = isGemini 
        ? "Jarvis 연동을 위한 Gemini 로그인 (완료 시 창이 자동으로 닫힙니다)"
        : "Jarvis 연동을 위한 ChatGPT 로그인 (완료 시 창이 자동으로 닫힙니다)";

      this.loginWindow = new BrowserWindow({
        width: 800,
        height: 800,
        title: title,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          partition: "persist:chatgpt" // Share partition for simplicity
        }
      });

      this.loginWindow.loadURL(targetUrl);

      // SPA 네비게이션도 감지하기 위해 did-navigate-in-page 사용
      const checkLogin = async (event, url) => {
        if (isGemini) {
          if (url.startsWith("https://gemini.google.com/app")) {
            const chatgptSession = session.fromPartition("persist:chatgpt");
            const cookies = await chatgptSession.cookies.get({ url: "https://gemini.google.com", name: "__Secure-1PSID" });
            if (cookies.length > 0) {
              this.loginWindow?.close();
              resolve(cookies[0].value);
            }
          }
        } else {
          if (url === "https://chatgpt.com/" || url.startsWith("https://chatgpt.com/c/")) {
            const token = await this.getAccessToken();
            if (token) {
              this.loginWindow?.close();
              resolve(token);
            }
          }
        }
      };

      this.loginWindow.webContents.on("did-navigate", checkLogin);
      this.loginWindow.webContents.on("did-navigate-in-page", checkLogin);

      // 추가적으로 주기적으로 토큰 확인
      const pollInterval = setInterval(async () => {
        if (!this.loginWindow) {
          clearInterval(pollInterval);
          return;
        }
        if (isGemini) {
          const chatgptSession = session.fromPartition("persist:chatgpt");
          const cookies = await chatgptSession.cookies.get({ url: "https://gemini.google.com", name: "__Secure-1PSID" });
          if (cookies.length > 0) {
            clearInterval(pollInterval);
            this.loginWindow?.close();
            resolve(cookies[0].value);
          }
        } else {
          const token = await this.getAccessToken();
          if (token) {
            clearInterval(pollInterval);
            this.loginWindow?.close();
            resolve(token);
          }
        }
      }, 3000);

      this.loginWindow.on("closed", () => {
        clearInterval(pollInterval);
        this.loginWindow = null;
        this.isLoggingIn = false;
        resolve(this.accessToken); // might be null if they closed without logging in
      });
    });
  }

  /**
   * Send a message to ChatGPT's unofficial backend API.
   * @param {string} prompt 
   */
  async chat(prompt, provider = "chatgpt") {
    // 1. 토큰(로그인) 확인
    let token = await this.getAccessToken();
    if (!token && provider === "chatgpt") {
      console.log("No valid session. Prompting login...");
      token = await this.requireLogin(provider);
      if (!token) throw new Error("User did not log in to AI provider.");
    }

    // 2. 숨겨진 브라우저 창(Chat Window) 가져오기 및 로드
    if (!this.chatWindow || this.chatWindow.isDestroyed()) {
      this.chatWindow = new BrowserWindow({
        show: false, // 백그라운드 실행
        width: 1024,
        height: 768,
        webPreferences: {
          partition: "persist:chatgpt", // 동일한 파티션(로그인 상태) 공유
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      const targetUrl = provider === "gemini" ? "https://gemini.google.com/app" : "https://chatgpt.com/";
      await this.chatWindow.loadURL(targetUrl);
      
      // 페이지 로딩 대기
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // 3. DOM 조작을 통해 메시지 전송 및 결과 추출
    if (provider === "chatgpt") {
      return await this._chatViaDOM_ChatGPT(prompt);
    } else {
      return await this._chatViaDOM_Gemini(prompt);
    }
  }

  async _chatViaDOM_ChatGPT(prompt) {
    const escapedPrompt = JSON.stringify(prompt);
    const script = `
      (async function() {
        try {
          const textarea = document.querySelector('#prompt-textarea');
          if (!textarea) return { error: "Chat input not found. Might need login." };
          
          // 1. 텍스트 입력
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeInputValueSetter.call(textarea, ${escapedPrompt});
          textarea.dispatchEvent(new Event('input', { bubbles: true }));

          // 2. 전송 버튼 클릭
          await new Promise(r => setTimeout(r, 200));
          const sendBtn = document.querySelector('button[data-testid="send-button"]');
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
          } else {
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }

          // 3. 응답 대기 및 폴링
          return await new Promise((resolve) => {
            let lastText = "";
            let checkCount = 0;
            const interval = setInterval(() => {
              checkCount++;
              const assistants = document.querySelectorAll('div[data-message-author-role="assistant"]');
              const sendBtnNow = document.querySelector('button[data-testid="send-button"]');
              
              if (assistants.length > 0) {
                lastText = assistants[assistants.length - 1].innerText;
              }

              // 전송 버튼이 다시 활성화되면 생성 완료로 간주
              const isDone = sendBtnNow && !sendBtnNow.disabled && checkCount > 15;
              
              if (isDone) {
                clearInterval(interval);
                resolve({ text: lastText });
              } else if (checkCount > 400) { // 약 40초 타임아웃
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

    try {
      const result = await this.chatWindow.webContents.executeJavaScript(script);
      if (result.error) {
        throw new Error(result.error);
      }
      return result.text;
    } catch (err) {
      console.error("DOM ChatGPT error:", err);
      throw err;
    }
  }

  async _chatViaDOM_Gemini(prompt) {
    const escapedPrompt = JSON.stringify(prompt);
    const script = `
      (async function() {
        try {
          // Gemini 입력창
          const textarea = document.querySelector('div[role="textbox"][contenteditable="true"]') || document.querySelector('rich-textarea');
          if (!textarea) return { error: "Gemini input not found." };
          
          // 1. 텍스트 입력
          textarea.innerHTML = ${escapedPrompt}.replace(/\\n/g, '<br>');
          textarea.dispatchEvent(new Event('input', { bubbles: true }));

          // 2. 전송 버튼 클릭
          await new Promise(r => setTimeout(r, 200));
          const sendBtn = document.querySelector('button[aria-label="Send message"], button[aria-label="메시지 전송"]');
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
          } else {
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }

          // 3. 응답 대기
          return await new Promise((resolve) => {
            let lastText = "";
            let checkCount = 0;
            const interval = setInterval(() => {
              checkCount++;
              const messages = document.querySelectorAll('message-content');
              const sendBtnNow = document.querySelector('button[aria-label="Send message"], button[aria-label="메시지 전송"]');
              
              if (messages.length > 0) {
                lastText = messages[messages.length - 1].innerText;
              }

              // 전송 버튼이 다시 나타나거나 활성화되면 완료
              const isDone = sendBtnNow && checkCount > 20;
              
              if (isDone) {
                clearInterval(interval);
                resolve({ text: lastText });
              } else if (checkCount > 400) {
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

    try {
      const result = await this.chatWindow.webContents.executeJavaScript(script);
      if (result.error) {
        throw new Error(result.error);
      }
      return result.text;
    } catch (err) {
      console.error("DOM Gemini error:", err);
      throw err;
    }
  }
}

module.exports = new UnofficialAIProvider();
