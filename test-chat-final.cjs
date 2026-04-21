const { app } = require("electron");
const path = require("path");

// 1. 격리 환경 설정
const userDataPath = path.join(process.cwd(), "isolated_env");
app.setPath("userData", userDataPath);

const unofficialAI = require("./src/main/unofficial-ai-provider.cjs");

app.whenReady().then(async () => {
  console.log("--------------------------------------------------");
  console.log("Full Chat Flow Test (v1.3.30 Logic)");
  
  // 2. 연결 상태 확인 (매우 빨라진 버전)
  const startTime = Date.now();
  const connected = await unofficialAI.isConnected();
  const checkTime = Date.now() - startTime;
  
  console.log(`Connection Check: ${connected ? "CONNECTED (" + connected + ")" : "FAILED"}`);
  console.log(`Check Time: ${checkTime}ms`);

  if (!connected) {
    console.error("Test aborted: No session found.");
    app.quit();
    return;
  }

  // 3. 실제 대화 시도
  const prompt = "안녕하세요, 당신은 누구이며 오늘 날씨는 어떤가요? (테스트용 질문)";
  console.log(`\nUser: ${prompt}`);
  console.log("Assistant is thinking...");

  try {
    const reply = await unofficialAI.chat(prompt, connected);
    console.log("\n--------------------------------------------------");
    console.log("!!! CHAT SUCCESS !!!");
    console.log(`Assistant: ${reply}`);
    console.log("--------------------------------------------------");
  } catch (err) {
    console.error("\n!!! CHAT FAILED !!!");
    console.error("Error:", err.message);
  }

  app.quit();
});
