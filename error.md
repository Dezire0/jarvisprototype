# Latest test errors

Current status: resolved.

Observed errors during this automation:

- Natural-language open command routing bug: `크롬 켜고 Gmail 열어줘` was parsed as one fake app name, `크롬 켜고 Gmail`, and the running app resolved it to `Mail`, returning `Mail 열었어요.` instead of opening Chrome plus Gmail.
- Bare workspace-app open bug: `디스코드 열어줘` was routed to `app_action` and attempted a workspace target switch instead of opening/focusing the Discord app itself.
- Direct Gmail browser label bug: `Gmail 열어줘` opened `https://mail.google.com/` correctly but replied `구글 열었어요.` because `mail.google.com` was labeled as Google.
- Initial regression-test failure after adding coverage: `handleBrowser labels Gmail direct opens as Gmail` expected `Gmail 열었어요.`, while Korean locale intentionally returns `지메일 열었어요.`.
- UI/DOM verification note: unauthenticated browser loads the login gate first, so `textarea[aria-label="Message input"]` is not present until an auth session exists. With a seeded local session, the composer textarea and send button render and submit successfully.
- UI submit verification note: seeded fake auth token caused expected cloud-sync `401` console errors, but local command submission still returned `지메일 열었어요.`.

Verification after fixes:

- `npm run check` passed.
- `npm run test:node` passed with 70/70 tests.
- `npm run dev` started the Next UI at `http://127.0.0.1:3310` and Electron transport on a dynamic localhost port.
- Direct `/api/chat` verification passed for `Gmail 열어줘` with `open_url -> https://mail.google.com/`.
- Direct `/api/chat` verification passed for `크롬 켜고 Gmail 열어줘` with `open_app -> Google Chrome` and `chrome_navigate -> https://mail.google.com/`.
