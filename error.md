# 2026-05-06 Latest Errors
- 재현 가능한 차단 오류 없음.
- 검증 기준:
  - `npm run check` 통과
  - `npm run test:node` 통과 (`119/119`)
  - `npm run dev` 부팅 성공
  - 로컬 UI 진입 확인: `http://127.0.0.1:3310/`
- 참고:
  - 전체 노드 테스트 중 `getconf DARWIN_USER_DIR` 기반 알림 조회 경고가 반복 출력되지만, 현재 테스트 환경 노이즈이며 이번 OpenClaw 중심 리팩터링 실패로 이어지지는 않았음.
