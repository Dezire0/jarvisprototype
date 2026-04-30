# Latest test errors

Current status: resolved.

Observed issue:

- The previous fix kept adding Korean launch-suffix variants such as `열어줄래`, `켜줄래`, and `실행해줄래`.
- That approach was inefficient because app/action intent should be judged by the LLM router, not by expanding local execution-verb cases.

Root problem:

- `routeInput()` was bypassing the LLM router for many non-chat fallback routes, including `app_open`, `app_action`, `open_targets`, and `browser`.
- The router also forced `localOnly: true` plus a router model override, so the connected conversation model such as Gemini was not the primary semantic router.
- `extractAppName()` depended on launch-verb stripping, which made every new polite form a new regex case.

Verification after redesign:

- `npm run check` passed.
- `node --test tests/node/assistant-service.test.cjs` passed.
- `npm run test:node` passed with 72/72 tests.
- Dev `/api/chat` request for `디스코드 열어줄래?` returned `open_app -> Discord`.
