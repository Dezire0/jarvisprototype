# 2026-05-06 Latest Fixes

- Created the working fix on top of `origin/main` / Jarvis `1.8.9` instead of continuing from stale `1.6.0`.
- Preserved sessions across version changes by changing onboarding version tracking to record `1.8.9` without clearing auth storage.
- Restored safe Google OAuth return routing:
  - Electron sends `return_to=http://127.0.0.1:<assistantPort>/auth/callback`.
  - Official/local web sends `return_to=<current web origin/path>`.
  - Backend validates and preserves `return_to` through OAuth state for `jarvis-desktop://`, localhost, and `https://dexproject.pages.dev`.
- Added `GET /auth/callback` to the Electron assistant transport server so the running Jarvis Desktop process receives OAuth tokens directly without relying on macOS protocol registration.
- Electron main now persists auth callbacks immediately, emits `auth:callback` to the Jarvis Desktop window, and focuses the window.
- Invalid/expired plan-update sessions now call `clearAuthSession()` so localStorage, sessionStorage, and Electron PII auth state are cleared together.
- Restored missing latest-main runtime support files:
  - `src/main/automation-error-utils.cjs`
  - `src/main/agent-tool-registry.cjs`
- Added Wrangler alias for `assistant-stream` so the `1.8.9` backend deploy can bundle successfully.

Verification:

- `npm run check` passed on Jarvis `1.8.9`.
- `npm run test:node` passed with `98/98`.
- `corepack pnpm --dir 'Jarvis Ui' --filter assistant-ui-starter-cloud build` passed.
- `npm run dev` launched Jarvis `1.8.9` at `http://127.0.0.1:3310`.
- Electron assistant transport health passed at `http://127.0.0.1:62893/health`.
- Electron local auth callback route is registered and returns expected `400 Missing auth callback payload` without token/user.
- Backend Worker deployed successfully to `https://jarvis-auth-service.dexproject.workers.dev` as version `8599e36b-7cc7-4d42-aa36-176983b92d64`.
