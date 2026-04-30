# Latest test errors

Current status: resolved.

Observed issue for this automation:

- Missing local apps or CLI tools were handled too generically.
- Jarvis could say an app was not found, but it did not clearly distinguish:
  - not installed locally,
  - official web app can run in browser,
  - official install page or CLI setup is required.
- Autonomous `[ACTION: OPEN_APP]` fallback could still drift toward opening install pages automatically instead of asking first.
- Browser ReAct planning was biased to local-only model calls, which could lose broader API conversation context during local fallback.
- Simple official install/download checks were still allowed to use the system browser first, instead of using Playwright for inspectable browser automation.

Verification:

- `npm run check` passed.
- `node --test tests/node/assistant-service.test.cjs` passed with 29/29 tests.
- `npm run test:node` passed with 75/75 tests.
- `npm run dev` started successfully, built the app, launched the Electron window, and finished loading.
- Playwright opened `http://127.0.0.1:3310`, read the Jarvis sign-in UI, found 4 interactive controls, and reported no page or console errors.
