2026-05-07 v2 companion implementation fixes

Resolved this cycle:
1. Added an ESM-first v2 companion layer
   - `src/main/v2/companion-service.mjs`
   - `src/main/v2-services-bridge.cjs`
   - Main process now creates the companion service without converting Electron boot entrypoints away from CJS.

2. Wired Buddy local-trigger flow into runtime
   - preload bridge: `getCompanionState`, `reportBuddyEvent`, `getDashboardState`
   - main IPC handlers added for companion state and Buddy event ingestion
   - Buddy UI overlay added in `Jarvis Ui/templates/cloud/components/jarvis/companion-buddy.tsx`
   - Verified in Electron: Buddy button expands into a companion card

3. Added YouTube-first media subsystem surface
   - skills: `media_get_og_info`, `media_play`, `media_pause`, `media_seek`, `media_get_lyrics`
   - companion service stores card-safe media state and drives a hidden isolated browser page for playback control

4. Added single-worker account automation queue
   - skills: `account_queue_add`, `account_queue_list`, `account_queue_cancel`, `account_switch`
   - queue state uses `queued`, `running`, `waiting_for_auth`, `failed`, `completed`, `cancelled`
   - per-account isolated browser sessions are created when available
   - logs are written through redaction middleware

5. Added admin dashboard UI in the existing sidebar surface
   - `Jarvis Ui/templates/cloud/components/jarvis/admin-dashboard-card.tsx`
   - displays token/automation/Buddy/media/queue metrics from structured companion state
   - verified visible in the Electron sidebar

6. Fixed Buddy site classification regression
   - root cause: `mail.google.com` was not classified as `work`
   - fix: broadened work classifier in `src/main/v2/companion-service.mjs`
   - result: companion tests passed after the patch

Validation results after fixes:
- `npm run check` ✅
- `node --test tests/node/companion-service.test.cjs tests/node/browser-agent-runtime.test.cjs tests/node/skill-registry.test.cjs` ✅ `35/35`
- `npm run test:node` ✅ `160/160`
- `corepack pnpm --dir 'Jarvis Ui' --filter assistant-ui-starter-cloud build` ✅
- `npm run dev` + Electron UI verification ✅

2026-05-07 i18n hardening follow-up

Resolved this cycle:
1. Removed residual browser runtime hardcoded confirmation strings
   - `src/main/browser-agent-runtime.cjs`
   - `runtime.sensitiveFinalActionLabel` now comes from the shared catalog
   - redundant `buildPlannerFailureReply` behavior was reduced to a passthrough and final summaries now return directly

2. Centralized backend/frontend messages into one shared catalog
   - added `src/shared/jarvis-messages.json`
   - backend loader: `src/main/i18n/messages.cjs`
   - frontend helper: `Jarvis Ui/templates/cloud/lib/jarvis-messages.ts`

3. Moved CompanionBuddy UI strings into the shared catalog
   - `Jarvis Ui/templates/cloud/components/jarvis/companion-buddy.tsx`
   - removed local `prefersKorean()`-style hardcoded message branching

4. Moved AdminDashboardCard UI strings into the shared catalog
   - `Jarvis Ui/templates/cloud/components/jarvis/admin-dashboard-card.tsx`
   - dashboard labels now resolve through the same helper used by Buddy

5. Replaced matching assistant-service sensitive confirmation copy with catalog-backed strings
   - `src/main/assistant-service.cjs`

Validation results after i18n hardening:
- `npm run check` ✅
- `node --test tests/node/i18n-messages.test.cjs tests/node/browser-agent-runtime.test.cjs tests/node/companion-service.test.cjs` ✅ `24/24`
- `corepack pnpm --dir 'Jarvis Ui' --filter assistant-ui-starter-cloud build` ✅

2026-05-07 browser-context follow-up fixes

Resolved this cycle:
1. Strengthened current-browser follow-up detection
   - `src/main/assistant-service.cjs`
   - `refersToCurrentBrowserContext()` now includes additional pronouns and follow-up forms:
     - `거기서`, `여기서`, `그거`, `이거`, `그곳`, `이곳`
     - `it`, `that`, `that one`, `this one`

2. Added a heuristic planner guard to prevent blind Google fallback
   - `buildHeuristicBrowserPlan(input, options)` now accepts current browser context
   - when the user clearly refers to the current page and `currentBrowserUrl` exists, the heuristic plan returns:
     - `forceCurrentBrowserContext: true`
     - no generic search steps
   - `planBrowserWorkflow()` now passes live browser planning context into the heuristic fallback
   - `handleAutonomousTask()` now honors `plan.forceCurrentBrowserContext`

3. Added regression coverage for context carry-over
   - `tests/node/assistant-service.test.cjs`
   - verifies:
     - `거기서 아무거나 틀어` forces current browser context
     - Korean/English pronoun follow-ups are treated as browser-context follow-ups

4. Added explicit shared-catalog regression coverage
   - `tests/node/i18n-catalog.test.cjs`
   - verifies shared JSON runtime key presence and interpolation for `runtime.sensitiveFinalActionLabel`

Validation results after browser-context fixes:
- `npm run check` ✅
- `node --test tests/node/assistant-service.test.cjs tests/node/i18n-catalog.test.cjs tests/node/browser-agent-runtime.test.cjs` ✅ `65/65`
- `npm run test:node` ✅ `164/164`
- `npm run dev` ✅ Next/Electron dev boot reached local app URL
