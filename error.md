2026-05-07

Latest remaining warning during validation:

- `getconf: confstr: DARWIN_USER_DIR: Input/output error`
- `Failed to read notifications: Command failed: getconf DARWIN_USER_DIR`

Observed in:

- `node --test tests/node/*.test.cjs`

Impact:

- Non-blocking test-environment warning from notification probing.
- No assistant, browser, UI, or planner regression reproduced after the current fixes.
