2026-05-07 browser-context follow-up hardening

Latest remaining warning during node tests:
- `getconf: confstr: DARWIN_USER_DIR: Input/output error`
- `Failed to read notifications: Command failed: getconf DARWIN_USER_DIR`

Scope:
- Reproduced during `node --test ...` and `npm run test:node`
- Does not fail the suite
- Appears to come from macOS notification probing in the sandbox/test environment, not from Buddy/media/account/dashboard logic

Current product-level result:
- No failing app/runtime tests remain
- `npm run check` passed
- targeted assistant/i18n/runtime tests passed
- `npm run test:node` passed `164/164`
- `npm run dev` reached `http://127.0.0.1:3310`
- current-browser pronoun follow-ups now stay in the active browser context instead of falling back to Google search
