2026-05-07 v2 validation

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
- targeted companion/runtime/registry tests passed
- `npm run test:node` passed `160/160`
- Next UI build passed
- Electron `Jarvis Desktop` launched and showed the new Buddy + Admin Dashboard UI
