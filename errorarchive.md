# 2026-05-06 Latest Fixes

- Replaced the Electron Google OAuth desktop return path with a local HTTP callback handled by the running Jarvis Desktop process.
- `scripts/start-electron.cjs` now publishes `NEXT_PUBLIC_JARVIS_AUTH_CALLBACK_URL=http://127.0.0.1:<assistantPort>/auth/callback` before building/serving the desktop UI.
- `Jarvis Ui/templates/cloud/app/onboarding-gate.tsx` now sends Electron Google login flows to that local callback URL instead of hard depending on `jarvis-desktop://auth`.
- `src/main/assistant-transport-server.cjs` now exposes `GET /auth/callback`, parses the returned `token` and `user`, calls the Electron auth callback handler, and shows a small login-complete page in the external browser.
- `src/main/main.cjs` now receives that local callback, persists the auth session in the Electron PII store immediately, forwards `auth:callback` to the Jarvis Desktop window, and focuses the Jarvis window.
- This avoids the stale macOS protocol handler that was opening the bare Electron welcome screen.

Verification:

- `npm run check` passed.
- `node --test tests/node/assistant-service.test.cjs tests/node/web-ai-dom-helpers.test.cjs` passed with `40/40`.
- `corepack pnpm --dir 'Jarvis Ui' --filter assistant-ui-starter-cloud build` passed.
- `npm run dev` was restarted successfully and served `http://127.0.0.1:3310`.
- Running Electron opened `Jarvis Desktop`; the active local transport reported healthy at `http://127.0.0.1:62319/health`.
- The built desktop UI contains `return_to=http://127.0.0.1:62319/auth/callback` for Google login inside Electron, confirming the bare Electron protocol path is bypassed.
