# 2026-05-06 Latest Fixes
- OpenClaw 공통 직접 실행 진입점을 `AssistantService`에 추가함.
  - `src/main/assistant-service.cjs`
  - `handleToolInvocation(tool, payload)` 추가
  - `buildToolInvocationInput(tool, payload)` 추가
  - 앱/브라우저 직접 툴 요청도 자연어 세션 문맥과 동일하게 OpenClaw 응답 형식으로 정리되게 변경
- OpenClaw runtime hint를 보강함.
  - `route.appName`, `route.siteOrUrl`가 있으면 세션 힌트에 직접 주입해 desktop/browser 타깃 판단을 더 명확히 함
- IPC 툴 디스패치를 OpenClaw-first 경로로 통일함.
  - `src/main/main.cjs`
  - `app:open`
  - `app:action`
  - `browser:open`
  - `browser:search`
  - `browser:read`
  - `browser:login`
  - 위 케이스들이 더 이상 `automation.execute` / `browser.open` / `browser.readPage` / `browser.loginWithStoredCredential`를 직접 호출하지 않고 `liveAssistant.handleToolInvocation(...)`을 경유함
- 테스트를 추가 및 갱신함.
  - `tests/node/assistant-service.test.cjs`
  - `handleToolInvocation` 기반 `app:open`, `browser:open`, `browser:read` 회귀 테스트 추가

Verification:

- `npm run check` 통과
- `node --test tests/node/assistant-service.test.cjs` 통과 (`45/45`)
- `npm run test:node` 통과 (`122/122`)
- `npm run dev` 부팅 성공
- Browser Use로 `http://127.0.0.1:3310/` 확인
  - 제목: `Jarvis Desktop`
  - 로그인 화면과 `Jarvis 컴퓨터 작업 동의` 모달 노출 확인
