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
[2026-05-06 memory-cycle fixes]
핵심 수정
1. `src/main/memory-store.cjs`
   - 개인 메모리 외에 `threads`, `projects`, `documents` 계층을 추가.
   - 레거시 `jarvis-memory.json` 자동 마이그레이션 지원.
   - 스레드 대화 저장/복원, 프로젝트 최근 토픽, 파일 경로 기억, 문서 chunk 검색, temporary memory mode 비저장 지원.
2. `src/main/assistant-service.cjs`
   - `threadId/projectId/projectName/threadTitle/memoryMode` 세션 문맥 주입 추가.
   - transport state 또는 persisted thread memory에서 최근 대화 복원.
   - 답변 프롬프트에 장기 메모리, 관련 과거 대화, 프로젝트 메모리, 파일/문서 조각을 함께 주입.
   - 파일 read/write 시 문서 메모리 색인 추가.
3. `src/main/assistant-transport-server.cjs` / `Jarvis Ui/templates/cloud/app/jarvis-runtime-provider.tsx`
   - 현재 thread/project 메타데이터를 요청마다 전달.
   - backend가 thread별 메모리를 실제로 사용할 수 있게 연결.
4. `src/main/main.cjs`
   - assistant 인스턴스 생성 시 thread id 전달.
5. 테스트 보강
   - `tests/node/memory-store.test.cjs`: 레거시 마이그레이션, 스레드/프로젝트 메모리, 문서 검색, temporary mode 검증 추가.
   - `tests/node/assistant-service.test.cjs`: 세션 문맥 복원 및 메모리 기반 프롬프트 주입 검증 추가.

검증 결과
- `npm run check` 통과
- `node --test tests/node/memory-store.test.cjs tests/node/assistant-service.test.cjs` `49/49` 통과
- `npm run test:node` `111/111` 통과
- `corepack pnpm --dir 'Jarvis Ui' --filter assistant-ui-starter-cloud build` 통과
- `npm run dev` 실행 확인
- in-app browser DOM 검증: `http://127.0.0.1:3310/`, title `Jarvis Desktop`
Verification:

- `npm run check` 통과
- `npm run test:node` 통과 (`105/105`)
- `npm run dev` 부팅 성공
- 로컬 UI 확인: `http://127.0.0.1:3310/` / title `Jarvis Desktop`
