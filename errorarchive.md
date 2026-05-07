# 2026-05-06 Latest Fixes
- `BrowserAgentRuntime`의 자율 실행을 하드코딩 `switch`에서 스킬 레지스트리 위임 구조로 변경함.
  - `src/main/browser-agent-runtime.cjs`
  - `executeStructuredAction(...)`이 이제 `this.skillRegistry.execute(...)`를 사용
  - `BrowserAgentRuntime` 생성자에 `skillRegistry` 주입 경로 추가
- 자율 에이전트 시스템 프롬프트에 동적 스킬 스키마를 주입하도록 변경함.
  - `src/main/agent-tool-registry.cjs`
  - `buildBrowserAgentSystemPrompt(...)`가 `skillRegistry.getSchemasForTools(toolSet)` 결과를 포함
- 스킬 레지스트리를 새 OpenClaw 툴 이름 중심으로 정렬하고 레거시 액션 별칭도 유지함.
  - `src/main/skills/skill-registry.cjs`
  - `resolve(...)`, `normalizeAction(...)`, `getSchemasForTools(...)` 추가
  - `tool` 기반 액션과 `action` 기반 레거시 액션을 모두 수용
- 모듈형 스킬 정의를 새 툴 네이밍에 맞게 정리함.
  - `src/main/skills/browser.cjs`
    - `browser.open`, `browser.click`, `browser.type`, `browser.keypress`, `browser.scroll`, `browser.wait_for`, `browser.observe`
  - `src/main/skills/os.cjs`
    - `desktop.type`, `desktop.open_app`, `desktop.click`, `shell.run`
  - `src/main/skills/security.cjs`
    - `pii.get`
  - `src/main/skills/file.cjs`
    - `file.read`, `file.write`
  - 각 스킬에 레거시 별칭(`navigate`, `os_app`, `ask_pii` 등)을 남겨 기존 경로와 호환되게 유지
- 관련 회귀 테스트를 추가함.
  - `tests/node/browser-agent-runtime.test.cjs`
  - 프롬프트 스키마 노출 검증 추가
  - 스킬 레지스트리 위임 실행 검증 추가

Verification:

- `npm run check` 통과
- `node --test tests/node/browser-agent-runtime.test.cjs` 통과 (`9/9`)
- `npm run test:node` 통과 (`124/124`)
- `npm run dev` 부팅 성공
- `http://127.0.0.1:3310` 응답 확인

Residual runtime issues observed after boot:

- OpenClaw planner process still expects `cargo` in the local environment
- conversation model settings currently reference unsupported Gemini/Ollama model ids
