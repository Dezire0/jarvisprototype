# 오류 수정 기록

## Amazon 요청이 Google 로그인으로 새는 문제 수정

- 증상: 사용자가 Amazon에서 상품을 찾고 로그인까지 요청했는데, Jarvis가 Amazon이 아니라 Google 로그인 카드와 Google 로그인 페이지를 띄웠습니다.
- 원인 1: `Amazon`이 Jarvis의 직접 웹 타깃 목록에 없어서 `amazon.com`으로 가지 못하고 일반 검색/다른 로그인 진입점으로 흘렀습니다.
- 원인 2: 영어 문장 `find some cool things in Amazon` 형태를 파싱할 때 검색어와 사이트가 뒤바뀌는 경우가 있었습니다.
- 원인 3: `browser_login` 라우트에서 모델이 `amazon login`처럼 지저분한 `siteOrUrl`을 주면, 실행 직전 정규화 없이 그대로 믿어서 Google 검색으로 변환될 수 있었습니다.
- 수정: `assistant-service.cjs`에 `Amazon`/`아마존`을 직접 웹 타깃으로 추가했습니다.
- 수정: 사이트 추출 시 등록된 웹 타깃 토큰을 먼저 찾는 `findKnownWebTarget()` 흐름을 추가했습니다.
- 수정: `extractComplexBrowserIntent()`에서 영어 검색문장 파싱을 보강해 `query=some cool things`, `site=Amazon`으로 안정적으로 분리되게 했습니다.
- 수정: `handleBrowserLogin()` 앞단에 로그인 대상 정규화 레이어를 추가해 `amazon login` 같은 값도 `https://www.amazon.com/`으로 교정하게 했습니다.
- 수정: `browser-service.cjs` 로그인 URL 후보에 `https://www.amazon.com/ap/signin`을 추가했습니다.

## 기존 Next dev 서버 재사용 보강

- 증상: `npm run dev` 실행 시 같은 `templates/cloud` 디렉터리의 기존 `next dev` 서버가 이미 살아 있으면 `Another next dev server is already running.` 오류가 발생했습니다.
- 원인: 스크립트가 기존 Jarvis UI dev 서버를 재사용하지 않고 새 서버를 띄우려 했습니다.
- 수정: `scripts/start-electron.cjs`에서 기존 Jarvis UI dev 서버가 이미 정상 응답 중이면 새 `next dev`를 띄우지 않고 그대로 재사용하도록 보강했습니다.

## 이번 회차 검증

- `buildHeuristicBrowserPlan('hi, could you find some cool things in Amazon, with log ins?')`
  결과: `open_url=https://www.amazon.com/`, `site_search=some cool things`, `login.site=Amazon`
- `handleBrowserLogin('go to amazon login', { siteOrUrl: 'amazon login' })`
  결과: `https://www.amazon.com/`으로 정규화된 뒤 보안 로그인 카드가 Amazon 기준으로 열림
- `node --test tests/node/assistant-service.test.cjs tests/node/browser-service.test.cjs`: 39개 통과
- `node --test tests/node/*.test.cjs`: 94개 통과
- `npm run check`: 통과
- `npm run dev`: 기존 UI 서버 재사용 + Electron 정상 기동
- `http://127.0.0.1:3310/`: HTTP 200 확인
- Assistant transport `/health`: 정상 응답 확인
