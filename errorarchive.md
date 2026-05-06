# 2026-05-06 Latest Fixes

- 최신 `1.8.9` 브랜치에 `src/main/openclaw-service.cjs`를 복원하고, OpenClaw CLI 세션(`--resume latest`) 기반 브라우저 플래너를 다시 연결함.
- OpenClaw 플래너 스키마에 `jarvis_delegate`를 추가해서, 브라우저로 우겨 넣지 말아야 하는 작업은 Jarvis 라우트(`browser_login`, `app_open`, `file_*`, `obs_*`, `screen_*`, `game_*`, `code_project` 등)로 직접 위임할 수 있게 함.
- `src/main/main.cjs`에서 OpenClaw 서비스를 실제 런타임 서비스로 생성하고, 메인 Assistant와 thread assistant 둘 다 최신 브랜치 구조에서 같은 OpenClaw 인스턴스를 사용하도록 연결함.
- `src/main/assistant-service.cjs`에서 OpenClaw 우선 브라우저 계획 경로를 복원함.
  - Heuristic만 쓰던 경로를 `planBrowserWorkflow()`로 교체
  - planner metadata(`planner`, `plannerReason`, `openClawSessionRef`, `openClawCommandLine`, `openClawToolUses`)를 결과 details에 유지
  - OpenClaw 다단계 브라우저 계획은 ReAct 전에 deterministic executor로 먼저 실행
  - 로그인이 필요한 경우 OpenClaw delegate 또는 login metadata를 통해 Jarvis secure credential 흐름으로 전환
- 브라우저 문맥 유지 능력을 복구함.
  - mailbox context 판정 복원
  - chat로 잘못 떨어지던 브라우저 후속 명령을 다시 browser route로 승격
  - 현재 메일함 문맥에서 `가장 최신 메시지 들어가줘`를 직접 처리할 수 있게 복원
- `src/main/browser-service.cjs`에 최신 메일 타깃 탐색/클릭 로직(`openLatestMailboxMessage`)을 다시 추가함.
- 앱이 로컬에 없을 때의 공식 웹/설치 fallback도 OpenClaw 세션 기준으로 다시 태우도록 바꿈.
  - 예전처럼 단순 하드코딩 open이 아니라 `handleAutonomousTask()`를 거쳐 OpenClaw planner -> Jarvis/browser 실행으로 연결
- 회귀 테스트를 추가함.
  - OpenClaw simple open plan 우선 사용
  - OpenClaw multi-step deterministic plan 실행
  - OpenClaw `jarvis_delegate` 로그인 continuation
  - mailbox 최신 메시지 진입

Verification:

- `npm run check` 통과
- `npm run test:node` 통과 (`105/105`)
- `npm run dev` 부팅 성공
- 로컬 UI 확인: `http://127.0.0.1:3310/` / title `Jarvis Desktop`
