2026-05-04 오류 수정 기록

- 원인 정리:
  `browser_login` 경로가 로그인 대상 사이트를 확실히 검증하지 못한 채 `normalizeBrowserOpenUrl()`까지 내려가면서, 애매한 문자열이 Google 검색 URL로 바뀌는 구조였음.

- 수정 내용:
  `src/main/assistant-service.cjs`
  로그인 대상 해석을 `resolveBrowserLoginTarget()`로 분리함.
  알려진 사이트, 명시 URL, 직접 도메인, 추론 가능한 사이트만 허용함.
  애매한 경우에는 검색 엔진으로 보내지 않고 `local-clarify`로 다시 확인하게 변경함.
  마지막으로 연 브라우저 대상(`lastBrowserContext`)을 기억해서 `거기 로그인해줘` 같은 후속 요청은 안전하게 이어받도록 보강함.

- 검증:
  `tests/node/assistant-service.test.cjs`
  애매한 로그인 요청은 fallback 없이 확인 질문으로 멈추는 테스트 추가.
  방금 연 사이트에 대한 후속 로그인 요청이 정상 동작하는 테스트 추가.
  전체 Node 테스트 96개 통과.

- 실행 점검:
  `npm run dev` 정상 기동.
  `http://127.0.0.1:3310/` 응답 확인.
  assistant transport health: `http://127.0.0.1:49503/health` 응답 확인.
