const { app } = require("electron");
const unofficialAI = require("./src/main/unofficial-ai-provider.cjs");

app.whenReady().then(async () => {
  console.log("Checking session cookie...");
  const cookie = await unofficialAI.getChatgptCookie("__Secure-next-auth.session-token");
  console.log("Session cookie exists:", !!cookie);

  console.log("Fetching token...");
  const token = await unofficialAI.getAccessToken({ forceRefresh: true });
  console.log("Token result:", token ? token.substring(0, 15) + "..." : null);
  
  app.quit();
});
