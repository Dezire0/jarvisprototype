2026-05-07

Fixed in this cycle:

- Reworked the running-status UI in [thread.tsx](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/Jarvis%20Ui/templates/cloud/components/assistant-ui/thread.tsx) so it reads like a thought/execution flow instead of showing the live preview immediately.
- Gated chat-embedded live preview until at least one real tool call has executed, preventing the preview card from appearing during the initial planning-only phase.
- Fixed heuristic browser planning for English `search ... in youtube` requests so prompts like `can you search travis scott music in youtube?` keep the intended query instead of degrading into a generic or wrong flow.
- Added a direct heuristic guard in [assistant-service.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/src/main/assistant-service.cjs) to bypass the OpenClaw planner for one-step YouTube searches, preventing invalid planner JSON failures on simple media tasks.
- Softened the internal planner failure text in [browser-agent-runtime.cjs](/Users/JYH/Documents/Codex/2026-05-04/git-switch-beta-testing/codex-memory-fix/src/main/browser-agent-runtime.cjs) so any future fallback is less schema-jargon-heavy.

Validation:

- `npm run check` passed
- `node --test tests/node/assistant-service.test.cjs tests/node/browser-agent-runtime.test.cjs tests/node/i18n-catalog.test.cjs` passed `67/67`
- `npm run test:node` passed `166/166`
- `corepack pnpm --dir 'Jarvis Ui' --filter assistant-ui-starter-cloud build` passed
- `npm run dev` launched the Electron entrypoint
- `http://127.0.0.1:3310` responded with `200 OK`
