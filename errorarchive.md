2026-05-07 i18n extraction cycle

Resolved and improved:
- Added shared message catalog in [src/main/i18n/messages.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/src/main/i18n/messages.cjs).
- Moved high-visibility runtime/user-facing strings out of code paths and into message keys:
  - [src/main/browser-agent-runtime.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/src/main/browser-agent-runtime.cjs)
  - [src/main/assistant-transport-server.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/src/main/assistant-transport-server.cjs)
- Externalized:
  - OpenClaw progress step labels
  - auth callback page title/body
  - browser runtime stop/failure/confirmation summaries
- Added `SYSTEM_PROMPT_CACHE_BOUNDARY` previously and now reduced some direct string duplication by routing repeated UI text through `message(...)`.
- Added catalog tests in [tests/node/i18n-messages.test.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/tests/node/i18n-messages.test.cjs).

Validation:
- `npm run check` ✅
- `node --test tests/node/i18n-messages.test.cjs tests/node/browser-agent-runtime.test.cjs` ✅ `17/17`
- `npm run test:node` ✅ `151/151`
- `npm run dev` ✅
  - `http://127.0.0.1:3310`
  - `Creating Jarvis Desktop window...`
  - `Jarvis Desktop window is ready to show.`
  - `Jarvis Desktop window finished loading.`

Follow-up candidates:
- Move more `assistant-service.cjs` response strings into the same catalog.
- Split language resources by domain (`runtime`, `assistant`, `transport`, `skills`) once the catalog grows further.
