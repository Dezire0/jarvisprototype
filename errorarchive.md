# 오류 수정 기록

## 로그인 입력칸 탐색 실패 수정

- 증상: 보안 로그인 카드에서 `assistant:invoke-tool` 호출 시 `로그인 입력칸을 확실히 찾지 못했어요...` 오류가 발생했습니다.
- 원인: Jarvis가 현재 페이지에서 입력칸만 바로 찾고 있었고, 로그인 버튼/링크를 눌러 로그인 화면으로 이동하는 단계가 없었습니다. 또한 일반 검색창 같은 `input[type="text"]`를 로그인 칸으로 오인할 수 있었습니다.
- 수정: `BrowserService`에 로그인 진입점 탐색, 로그인 URL 후보 이동, 2단계 로그인 입력 흐름, 강한 로그인 입력칸 판별 로직을 추가했습니다.
- 수정: 로그인 작업은 시스템 브라우저보다 Jarvis가 제어 가능한 Assistant browser를 우선 사용하게 바꿨습니다.
- 검증: 실제 Playwright smoke에서 첫 화면의 `Sign in` 버튼을 누른 뒤 이메일/비밀번호 입력이 정상 수행됨을 확인했습니다.

## 개발 서버 포트 충돌 보강

- 증상: `npm run dev` 최초 실행 시 `EADDRINUSE: address already in use 127.0.0.1:3310` 오류가 발생했습니다.
- 원인: 이전 Jarvis 개발 프로세스가 3310 포트를 계속 점유하고 있었습니다.
- 조치: 잔류 개발 프로세스를 종료한 뒤 `npm run dev`를 재실행했습니다.
- 보강: `scripts/start-electron.cjs`에서 기본 UI 포트가 이미 사용 중이면 자동으로 빈 포트를 할당하게 변경했습니다.

## 세션 컨텍스트 점검

- 확인: Assistant transport는 `threadId`별로 `AssistantService` 인스턴스를 캐시합니다.
- 확인: 각 인스턴스는 최근 대화 12턴을 유지하고, LLM 호출 시 최근 히스토리와 장기 메모리 요약을 함께 전달합니다.
- 주의: 장기 메모리는 안정적인 사용자 정보만 별도 `jarvis-memory.json`에 저장하는 구조이고, 매 턴 전체 대화를 영구 저장하는 구조는 아닙니다.

## 이번 회차 검증

- `npm run check`: 통과
- `node --test tests/node/browser-service.test.cjs tests/node/assistant-service.test.cjs`: 38개 통과
- `npm run test:node`: 92개 통과
- `npm run dev`: 재실행 후 정상 기동
- UI smoke: `http://127.0.0.1:3310/`에서 Jarvis 로그인 화면과 컴퓨터 작업 동의 팝업 확인
- backend smoke: Assistant transport `/health` 정상 응답 확인
