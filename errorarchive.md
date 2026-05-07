2026-05-07 multi-agent orchestration cycle

Resolved and implemented:
- Added `sessions_spawn` and `subagents` core skills in [src/main/skills/core.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/src/main/skills/core.cjs).
- Added dedicated sub-agent orchestration manager in [src/main/subagent-manager.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/src/main/subagent-manager.cjs):
  - `MAX_AGENT_DEPTH = 3`
  - depth overflow protection
  - session status tracking
  - `list|steer|kill` control surface
  - `[Agent -> SubAgent]` message logging to `data/subagent-messages.log`
  - graceful `possible_fix` guidance on depth/session/permission failures
- Updated [src/main/browser-agent-runtime.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/src/main/browser-agent-runtime.cjs):
  - validates `sessions_spawn` / `subagents` tool payloads
  - lazily attaches and reuses a `SubAgentManager`
  - passes runtime depth/session/language into skill execution context
  - supports `abortSignal` and supervisor steering notes in `runLoop`
  - returns `possible_fix` for automation permission failures and manager errors
- Updated [src/main/agent-tool-registry.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/src/main/agent-tool-registry.cjs):
  - orchestration tool group added
  - selective loading now includes sub-agent tools only when the goal hints at delegation/parallel work
  - added `SYSTEM_PROMPT_CACHE_BOUNDARY` marker for static prompt prefix caching friendliness
- Updated [src/main/beta/browser-service-beta.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/src/main/beta/browser-service-beta.cjs):
  - added `createIsolatedSession()`
  - stopped root `getPage()` from closing every other page, so sub-agent tabs/pages survive
- Updated [tests/node/browser-agent-runtime.test.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/tests/node/browser-agent-runtime.test.cjs), [tests/node/skill-registry.test.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/tests/node/skill-registry.test.cjs), [tests/node/subagent-manager.test.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/tests/node/subagent-manager.test.cjs) with spawn/kill/depth/permission coverage.

Validation:
- `npm run check` ✅
- `node --test tests/node/browser-agent-runtime.test.cjs tests/node/skill-registry.test.cjs tests/node/subagent-manager.test.cjs` ✅ `29/29`
- `npm run test:node` ✅ `148/148`
- `npm run dev` ✅
  - `http://127.0.0.1:3310`
  - `Creating Jarvis Desktop window...`
  - `Jarvis Desktop window is ready to show.`
  - `Jarvis Desktop window finished loading.`
