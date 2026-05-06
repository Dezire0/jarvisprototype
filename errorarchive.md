# 2026-05-06 Latest Fixes

- Browser continuity:
  - `src/main/assistant-service.cjs` now keeps browser opens inside the controlled assistant browser first through `openBrowserTargetForUser(...)` instead of preferring external `open_url` recovery.
  - Mailbox follow-up detection now treats latest-message requests as mailbox actions and routes them to a deterministic controlled-browser action.

- Mailbox execution:
  - `src/main/beta/browser-service-beta.cjs` adds `openLatestMailboxMessage()` and mailbox-item marking heuristics so `가장 최신 메시지 들어가줘` opens the newest visible item instead of only replying as if it did.

- Login context inheritance:
  - `src/main/assistant-service.cjs` adds `looksLikeGenericBrowserLoginRequest(...)` and reuses `lastBrowserTargetUrl` / `lastBrowserTargetLabel` for generic follow-ups like `로그인 진행해줘 로그인창으로 먼저 들어가`.
  - Manual login replies on this route are now deterministic instead of being rephrased by the chat model, preventing false "로그인 완료" responses.

- Login screen entry and credential fill:
  - `src/main/beta/browser-service-beta.cjs` adds `openLoginEntry(...)` for semantic sign-in entry clicks plus known login URL fallback.
  - `fillStoredCredential(...)` now supports two-step login flows by filling username first, advancing with Continue/Next when needed, then filling the password field.
  - `handleBrowserLogin(...)` now prefills saved credentials on "로그인창 먼저" flows with `submit: false` so the user still controls the final sensitive submit step.

- Browser auth handoff:
  - `Jarvis Ui/templates/cloud/app/onboarding-gate.tsx` now sends browser-based Google login flows to `/api/auth/google?return_to=<current local UI>` instead of always relying on a desktop deep link.
  - `backend/src/routes/auth.ts` now preserves a sanitized `return_to` target through Google OAuth `state` and redirects back to that local URL with `token` and `user` query params after callback.
  - The auth Worker was deployed successfully to `https://jarvis-auth-service.dexproject.workers.dev` as version `640141d9-7c96-4d1e-af94-0bab793cea9a`.
  - `src/main/main.cjs` also keeps the development `jarvis-desktop://` protocol registration explicit so packaged-app handoff and browser-based handoff are both covered.

- In-thread progress UX:
  - `src/main/main.cjs` and `src/preload.cjs` expose `assistant:get-live-preview`.
  - `src/renderer/renderer.js` adds a running assistant message, safe high-level progress stages, and live preview polling during in-flight actions.
  - `src/renderer/styles.css` adds compact preview-card and thinking-state styling sized for a small inline popup.

- Verification:
  - `npm run check` passed.
  - `node --test tests/node/assistant-service.test.cjs tests/node/web-ai-dom-helpers.test.cjs` passed with `40/40`.
  - `corepack pnpm --dir 'Jarvis Ui' --filter assistant-ui-starter-cloud build` passed.
  - `npm run dev` booted successfully and served `http://127.0.0.1:3310`.
  - Electron `Jarvis Desktop` launched and rendered the login gate successfully.

- Remaining limitation:
  - Full visual confirmation of the logged-in chat preview card was not completed in this cycle because the onboarding flow currently wipes local auth state on version change and the dev session remained at the login gate without a fresh authenticated session.
