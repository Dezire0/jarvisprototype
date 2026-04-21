const { app } = require("electron");
const path = require("path");
const fs = require("fs");

app.whenReady().then(async () => {
  const appDataPath = app.getPath("appData");
  const candidates = [
    path.join(appDataPath, "Jarvis Desktop"),
    path.join(appDataPath, "jarvis-prototype")
  ];
  
  let foundPath = null;
  for (const p of candidates) {
    // 세션 파티션 데이터가 저장되는 경로 확인
    const partitionPath = path.join(p, "Partitions/chatgpt");
    if (fs.existsSync(partitionPath)) {
      foundPath = p;
      break;
    }
  }

  if (!foundPath) {
    console.error("Error: Could not find app data folder with 'chatgpt' partition.");
    console.log("Checked candidates:", candidates);
    app.quit();
    return;
  }

  console.log("------------------------------------------");
  console.log("Target UserData Path:", foundPath);
  app.setPath("userData", foundPath);

  const unofficialAI = require("./src/main/unofficial-ai-provider.cjs");

  console.log("Checking session cookie (__Secure-next-auth.session-token)...");
  const cookie = await unofficialAI.getChatgptCookie("__Secure-next-auth.session-token");
  
  if (!cookie) {
    console.error("Error: Session cookie not found in partition. Are you logged in in the app?");
    app.quit();
    return;
  }
  
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
      
      if (response.statusCode === 403) {
        console.error("Diagnosis: Cloudflare is blocking the background request (403 Forbidden).");
      }
    }
  } catch (err) {
    console.error("Error during fetch:", err.message);
  }
  
  console.log("------------------------------------------");
  app.quit();
});
