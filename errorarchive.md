# Latest error fixes

- Extended `extractAppName()` to strip polite Korean app-launch prefixes and suffixes:
  - `열어줄래`, `열어줄래요`
  - `켜줄래`, `켜줄래요`
  - `실행해줄래`, `실행해줄래요`
  - `시작해줄래`, `시작해줄래요`
- Added regression coverage for `디스코드 열어줄래?`, `크롬 켜줄래`, and `노션 실행해줄래`.
- Confirmed the failing command now routes as:
  - input: `디스코드 열어줄래?`
  - route: `app_open`
  - appName: `디스코드`
- Verified syntax and behavior with `npm run check`, focused assistant-service tests, and the full Node test suite.
