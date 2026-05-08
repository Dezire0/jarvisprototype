const { safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

class InternalBrainService {
  constructor({ app, settingsStore }) {
    this.app = app;
    this.settingsStore = settingsStore;
    this.internalKey = "";
    this.provider = "groq"; // 기본 전략 판단 엔진으로 Groq 고정 (속도 최우선)
    this.model = "llama-3.3-70b-versatile";
  }

  async init() {
    const settings = await this.settingsStore.load();
    // Groq 키 하나로 통합 관리
    this.groqKey = this.settingsStore.decryptSecret(this.settingsStore.cache.internalGroqKeyEncrypted || "");
    
    if (!this.groqKey) {
      console.warn("[InternalBrain] Internal Groq API key missing.");
    }
  }

  async decideStrategy(input, context) {
    if (!this.groqKey) return { strategy: "REACT", reason: "no-key-fallback" };

    const prompt = `Decision task for Jarvis AI. Decide MACRO or REACT.
[Request]: "${input}"
[Context]: ${JSON.stringify(context)}
Output JSON: { "strategy": "MACRO" | "REACT", "reason": "string" }`;

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${this.groqKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        })
      });
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content);
    } catch (e) {
      return { strategy: "REACT", reason: "error-fallback" };
    }
  }

  async verifyOutcome(input, screenshotBase64) {
    if (!this.groqKey) return true;

    try {
      // Groq Vision 모델 (Llama 3.2 Vision) 활용
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${this.groqKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.2-11b-vision-preview",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `User Goal: "${input}"\nWas the goal achieved? Reply ONLY YES or NO.` },
                { type: "image_url", image_url: { url: `data:image/png;base64,${screenshotBase64}` } }
              ]
            }
          ],
          max_tokens: 10
        })
      });
      const data = await response.json();
      const text = data.choices[0].message.content || "";
      return text.toUpperCase().includes("YES");
    } catch (e) {
      return true;
    }
  }
}

module.exports = { InternalBrainService };
