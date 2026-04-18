# MARK XXXV Import Notes

`Mark-XXXV-main` 폴더를 훑어본 뒤, 현재 Jarvis 코드베이스에 가치 있게 가져올 수 있는 장점만 추려서 정리한 메모입니다.

## 이번에 실제로 가져온 장점

### 1. 장기 메모리 구조

MARK XXXV의 가장 좋은 부분 중 하나는 대화 중에서 장기적으로 유용한 사실만 따로 뽑아 저장하는 구조였습니다.

현재 Jarvis에는 이 아이디어를 새로 구현해서 아래 범주로 저장합니다.

- `identity`
- `preferences`
- `projects`
- `relationships`
- `wishes`
- `notes`

반영 위치:

- `/Users/JYH/Desktop/Jarvis Prototype/src/main/memory-store.cjs`
- `/Users/JYH/Desktop/Jarvis Prototype/src/main/assistant-service.cjs`

효과:

- 사용자의 선호, 진행 중인 프로젝트, 관계, 목표 같은 맥락을 다음 대화에서도 활용 가능
- 일반 대화뿐 아니라 조언, 추천, 후속 제안의 품질이 좋아짐
- 단기 히스토리 12턴만으로는 놓치던 정보를 별도 축으로 유지

### 2. 메모리 추출 기준의 공격성은 유지, 저장 범위는 안전하게 제한

MARK XXXV는 메모리를 꽤 적극적으로 뽑아내는 편이었습니다. 그 장점은 살리되, 현재 Jarvis에서는 아래 정보는 저장하지 않도록 제한했습니다.

- 비밀번호
- API 키
- 토큰
- 일회성 URL
- 현재 머신 상태
- 임시 브라우저 내용
- 단발성 실행 명령

즉, “잘 기억하는 장점”은 가져오고 “과도하게 저장하는 위험”은 줄였습니다.

### 3. 응답 프롬프트에 장기 맥락 반영

현재 Jarvis는 모델 호출 시 최근 대화뿐 아니라 장기 메모리 스니펫도 함께 넣습니다.

효과:

- 일반 대화가 덜 단절됨
- 추천/조언이 더 개인화됨
- 같은 프로젝트를 계속 이어갈 때 문맥이 덜 끊김

### 4. Steam / Epic 게임 관리 흐름

MARK XXXV 영상에서 강조된 게임 설치 경험을 현재 Jarvis에 맞는 방식으로 다시 연결했습니다.

현재 반영 내용:

- `스팀에서 PUBG 설치해줘`
- `에픽에서 포트나이트 업데이트해줘`
- `설치된 게임 목록 보여줘`

같은 요청을 별도 라우트로 해석하고,

- Steam 설치 / 업데이트 URI 호출
- Epic Games Launcher 열기
- 설치된 Steam / Epic 게임 목록 읽기

를 처리합니다.

반영 위치:

- `/Users/JYH/Desktop/Jarvis Prototype/src/main/game-service.cjs`
- `/Users/JYH/Desktop/Jarvis Prototype/src/main/assistant-service.cjs`
- `/Users/JYH/Desktop/Jarvis Prototype/src/main/platform-adapters.cjs`

### 5. F4 Jarvis 음성 음소거

MARK XXXV의 `F4` 음소거 아이디어를 Electron 구조에 맞게 옮겼습니다.

현재 반영 내용:

- `F4` 전역 단축키로 자비스 음성 응답 on/off
- 데스크톱 앱 UI 버튼
- 빠른 패널 UI 버튼
- 메인 프로세스와 두 렌더러 간 상태 동기화

반영 위치:

- `/Users/JYH/Desktop/Jarvis Prototype/src/main/main.cjs`
- `/Users/JYH/Desktop/Jarvis Prototype/src/preload.cjs`
- `/Users/JYH/Desktop/Jarvis Prototype/src/renderer/index.html`
- `/Users/JYH/Desktop/Jarvis Prototype/src/renderer/renderer.js`
- `/Users/JYH/Desktop/Jarvis Prototype/src/renderer/popup.html`
- `/Users/JYH/Desktop/Jarvis Prototype/src/renderer/popup.js`

### 6. 키보드 중심 상호작용 강화

MARK XXXV의 “마이크가 없어도 계속 사용할 수 있어야 한다”는 장점은 현재 Jarvis가 이미 갖고 있었지만, 이번 정리 과정에서 더 명확히 드러나게 했습니다.

현재 반영 내용:

- 빠른 패널 텍스트 입력
- 데스크톱 메인 화면 스레드형 채팅
- 음소거 상태와 텍스트 흐름 공존

즉, 음성 없이도 같은 오케스트레이터를 그대로 사용합니다.

### 7. 코드 프로젝트 생성

MARK XXXV의 “간단한 프로젝트를 바로 만들어 주는 흐름”을 현재 Jarvis 구조에 맞게 안전하게 다시 넣었습니다.

현재 반영 내용:

- `스네이크 게임 만들어줘`
- `간단한 todo 앱 만들어줘`

같은 요청을 받아 `generated-projects/` 아래에 실제 파일을 만들고, 가능하면 VS Code까지 엽니다.

반영 위치:

- `/Users/JYH/Desktop/Jarvis Prototype/src/main/code-project-service.cjs`
- `/Users/JYH/Desktop/Jarvis Prototype/src/main/assistant-service.cjs`

### 8. 앱 이름 우선 해석

MARK XXXV 계열 데모에서 기대하는 감각은 “앱 이름을 말했으면 그걸 먼저 이해하는 것”입니다.

현재 Jarvis에서도 이 원칙을 더 강하게 반영했습니다.

예:

- `YouTube에서 음악 틀어줘`
- `Spotify 열어줘`
- `Steam 켜줘`

같은 요청에서 일반 키워드보다 명시된 앱 / 사이트를 우선 해석하도록 라우터와 fallback 규칙을 보강했습니다.

## 이미 Jarvis에 있었고, 굳이 다시 가져오지 않은 장점

아래는 MARK XXXV에도 있었지만, 현재 Jarvis 쪽이 이미 더 나은 형태로 갖고 있거나 별도 구현이 끝난 항목입니다.

- 앱/브라우저 제어 라우팅
- 사이트별 브라우저 계획
- 로그인 저장소와 브라우저 프로필 재사용
- OCR 기반 화면 요약
- Electron 기반 데스크톱 셸
- 자동 업데이트 흐름

## 참고만 하고 직접 복사하지 않은 요소

아래는 아이디어만 참고하고 코드 자체는 가져오지 않았습니다.

### Windows 전용 액션 모듈

MARK XXXV는 Windows 자동화에 강하게 맞춰져 있습니다. 현재 Jarvis는 macOS 중심이라 그대로 붙이면 유지보수성이 떨어집니다.

### Tkinter UI

현재 Jarvis는 Electron 앱으로 가고 있으므로 Tkinter UI는 방향이 맞지 않습니다.

### generated code 실행기

MARK XXXV의 생성 코드 실행 흐름은 유연하지만 안전성과 예측 가능성이 떨어집니다. 현재 공개 Jarvis 구조에는 그대로 넣지 않는 편이 낫습니다.

## 다음에 더 가져올 가치가 있는 장점

우선순위가 높은 후보는 아래입니다.

1. 일반 복합 태스크용 범용 planner/executor
2. 실패 시 재시도/대안 경로 선택 로직
3. UI 상태값을 더 명확하게 드러내는 상위 상태 머신

지금은 장기 메모리만이 아니라, 게임 관리 / 음소거 / 코드 생성 / 앱 이름 우선 해석까지 실제 반영된 상태입니다.
