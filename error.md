# Latest test errors

Current status: resolved in source and unit tests.

Observed error:

- `디스코드 열어줄래?` routed to `app_open`, but `extractAppName()` did not strip the polite Korean launch suffix `열어줄래`.
- Because the extracted app name stayed as `디스코드 열어줄래`, macOS execution called `open -a "디스코드 열어줄래"`.
- macOS then failed with `Unable to find application named '디스코드 열어줄래'`.

Root cause:

- The local deterministic app-launch parser recognized `열어줘`, `열어`, `켜줘`, `켜`, `실행해줘`, and similar short forms, but not polite request forms like `열어줄래`, `켜줄래`, `실행해줄래`, `시작해줄래`.

Verification:

- Direct parser check now returns `appName: "디스코드"` for `디스코드 열어줄래?`.
- `npm run check` passed.
- `node --test tests/node/assistant-service.test.cjs` passed.
- `npm run test:node` passed with 71/71 tests.
