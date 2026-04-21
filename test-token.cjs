const { app } = require("electron");
const path = require("path");
const fs = require("fs");

app.whenReady().then(async () => {
  // 현재 디렉토리의 temp_test_data를 사용
  const foundPath = path.join(process.cwd(), "temp_test_data");
  
  console.log("------------------------------------------");
  console.log("Using ISOLATED Temp Path:", foundPath);
  app.setPath("userData", foundPath);

  const unofficialAI = require("./src/main/unofficial-ai-provider.cjs");

  console.log("Checking session cookie (Prefix: __Secure-next-auth.session-token)...");
  const cookie = await unofficialAI.getChatgptCookie("__Secure-next-auth.session-token");
  
  if (!cookie) {
    console.error("Error: Session cookie not found even in temp directory!");
    app.quit();
    return;
  }
  
  console.log("SUCCESS: Cookie found in isolated environment!");
  console.log("Found Cookie Name:", cookie.name);
  console.log("Value starts with:", cookie.value.substring(0, 10) + "...");

  console.log("Attempting to fetch Access Token via net.request...");
  try {
    const token = await unofficialAI.getAccessToken({ forceRefresh: true });
    if (token) {
      console.log("FINAL SUCCESS! Access Token retrieved successfully using the new matching logic.");
      console.log("Token sample:", token.substring(0, 30) + "...");
    } else {
      console.log("FAILED: Token is still null. Checking raw response...");
      const response = await unofficialAI.request({
        url: "https://chatgpt.com/api/auth/session",
        headers: {
          Accept: "application/json",
          Referer: "https://chatgpt.com/",
          Origin: "https://chatgpt.com"
        }
      });
      console.log("HTTP Status:", response.statusCode);
      console.log("Body:", response.text.substring(0, 200));
    }
  } catch (err) {
    console.error("Error during fetch:", err.message);
  }
  
  console.log("------------------------------------------");
  app.quit();
});
