2026-05-07 i18n extraction cycle

Latest remaining warnings:
- `getconf: confstr: DARWIN_USER_DIR: Input/output error`
- `Electron[...] error messaging the mach port for IMKCFRunLoopWakeUpReliable`

Observed in:
- `npm run test:node`
- `npm run dev`

Impact:
- No failing tests.
- App still boots and serves normally.
- Warning noise only in the current macOS/headless environment.

Current judgment:
- Environmental warnings, not regressions from the new message catalog / i18n extraction.
