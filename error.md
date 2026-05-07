2026-05-07 i18n hardening validation

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
- targeted i18n/runtime/companion tests passed
- Next UI build passed
- shared message catalog is now used by backend runtime and new frontend Buddy/Admin UI
