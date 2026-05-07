2026-05-07 automation cycle

Latest remaining error:
- `getconf: confstr: DARWIN_USER_DIR: Input/output error`
- Source: `notification-monitor.cjs` reads macOS notification data during node tests in the current non-GUI/sandboxed environment.
- Reproduced in:
  - `node --test tests/node/browser-agent-runtime.test.cjs`
  - `npm run test:node`
- Impact:
  - Does not fail validation anymore.
  - Adds repeated stderr noise during test runs.
- Current judgment:
  - Environmental runtime warning, not an OpenClaw planner regression.
  - Safe to defer unless we want to silence notification reads in headless test mode.
