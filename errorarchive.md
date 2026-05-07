2026-05-07 automation cycle

Resolved this cycle:
- OpenClaw planner prompt now injects only the tool schemas that fit the current goal/state/runtime hints instead of always dumping the full desktop/browser set.
- Browser agent retry ceilings were increased for multi-step UI work:
  - `maxSteps: 24`
  - `maxConsecutiveFailures: 6`
  - `maxRepeatActions: 4`
  - `maxNoProgressActions: 5`
  - `maxPingPongActions: 6`
- Browser/desktop failure feedback is now more specific:
  - popup/dialog overlay guidance
  - login/auth gate guidance
  - desktop app mismatch guidance
- Structured execution still goes through `SkillRegistry`, but now carries legacy-compatible alias fields so older orchestration/tests continue to work.
- Skill schema text now includes alias metadata for backward compatibility.
- `SkillRegistry.get()` now returns `undefined` for unknown actions again to preserve previous behavior.

Validation:
- `npm run check` ✅
- `node --test tests/node/browser-agent-runtime.test.cjs` ✅ `12/12`
- `npm run test:node` ✅ `141/141`
- `npm run dev` ✅
  - Next ready on `http://127.0.0.1:3310`
  - Electron logs:
    - `Creating Jarvis Desktop window...`
    - `Jarvis Desktop window is ready to show.`
    - `Jarvis Desktop window finished loading.`

Deferred:
- `notification-monitor.cjs` still emits `DARWIN_USER_DIR` warnings in the current test environment.
