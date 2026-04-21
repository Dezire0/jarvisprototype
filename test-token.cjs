const { app } = require("electron");
const path = require("path");
const fs = require("fs");

app.whenReady().then(async () => {
  const appDataPath = app.getPath("appData");
  // 쿠키가 확인된 실제 경로로 강제 설정
  const foundPath = path.join(appDataPath, "jarvis-prototype");
  
  console.log("------------------------------------------");
  console.log("Target UserData Path:", foundPath);
  app.setPath("userData", foundPath);

  const unofficialAI = require("./src/main/unofficial-ai-provider.cjs");

  console.log("Checking session cookie (Prefix: __Secure-next-auth.session-token)...");
  const cookie = await unofficialAI.getChatgptCookie("__Secure-next-auth.session-token");
  
  if (!cookie) {
    console.error("Error: Session cookie still not found. Please ensure the app is closed.");
    app.quit();
    return;
  }
  
  console.log("Found Cookie Name:", cookie.name);
  console.log("Session cookie found! Value starts with:", cookie.value.substring(0, 10) + "...");

  console.log("Attempting to fetch Access Token...");
  try {
    const token = await unofficialAI.getAccessToken({ forceRefresh: true });
    if (token) {
      console.log("SUCCESS! Access Token retrieved successfully.");
      console.log("Token sample:", token.substring(0, 30) + "...");
    } else {
      console.log("FAILED: Received null token.");
      const response = await unofficialAI.request({
        url: "https://chatgpt.com/api/auth/session",
        headers: {
          Accept: "application/json",
          Referer: "https://chatgpt.com/",
          Origin: "https://chatgpt.com"
        }
      });
      console.log("HTTP Status:", response.statusCode);
      console.log("Response Body Preview:", response.text.substring(0, 300));
    }
  } catch (err) {
    console.error("Error during fetch:", err.message);
  }
  
  console.log("------------------------------------------");
  app.quit();
});
