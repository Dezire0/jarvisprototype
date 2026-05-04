# 최신 오류 기록

현재 재검증 기준으로 남아 있는 앱 오류는 없습니다.

- `Amazon` 요청이 `Google 로그인`으로 잘못 이동하던 문제는 재현되지 않도록 수정되었습니다.
- `npm run dev` 결과: 기존 Jarvis UI dev 서버를 재사용하며 Electron 앱이 정상 기동했습니다.
- `http://127.0.0.1:3310/` 응답 정상 확인
- Assistant transport `/health` 응답 정상 확인
- `node --test tests/node/*.test.cjs` 94개 통과
