# Jarvis Prototype

`friday` 기반 Python MCP/voice 스택 위에 Electron 데스크톱 셸을 얹은 로컬 AI 비서 프로토타입입니다. 이 저장소는 지금 실제로 실행되는 코드만 남겨둔 상태이며, 텍스트 명령, Electron 보조 음성 입력, LiveKit 음성 에이전트, 브라우저 자동화, 앱 자동화, OCR, OBS 제어, 파일 작업, 자격증명 저장소를 하나의 자비스 경험으로 묶는 것이 목적입니다.

## 지금 이 저장소가 하는 일

- Electron 팝업에서 자연어 명령을 받아 대화하거나 로컬 작업을 수행합니다.
- Electron 설정창에서 웨이크워드와 1회성 음성 입력으로 명령을 받아 같은 오케스트레이터로 보냅니다.
- LiveKit 기반 음성 에이전트가 별도의 음성 세션에서 같은 `friday` MCP 도구들을 사용합니다.
- 로컬 데스크톱 자동화와 Python MCP 도구를 분리해 두어서, 데스크톱 셸과 음성 에이전트가 같은 기능 축을 공유할 수 있습니다.
- 자격증명, TTS 설정, 브라우저 프로필, OBS 연결, OCR, 파일 작업을 전부 실사용 기준으로 엮어둔 상태입니다.

## 구성

```text
.
├── server.py              # FastMCP 서버 엔트리
├── agent_friday.py        # LiveKit 음성 에이전트 엔트리
├── main.py                # Python 통합 실행기
├── friday/                # Python MCP / voice package
├── src/main/              # Electron 메인 프로세스 서비스
├── src/renderer/          # Electron 팝업 / 설정 UI
├── scripts/               # smoke / E2E 보조 스크립트
├── tests/                 # Python + Node 검증
└── docs/                  # 구조 / 보안 문서
```

## 현재 동작하는 기술 스택

### Electron 데스크톱 셸

- `Electron 36`
- `ipcMain` / `ipcRenderer` / `contextBridge` 기반 IPC
- 고정형 팝업 창 + 고급 설정 창
- 전역 단축키
  - `Cmd/Ctrl + Shift + Space`: 팝업 표시
  - `Cmd/Ctrl + ,`: 설정 창 열기
- 렌더러 음성 입력
  - `SpeechRecognition` / `webkitSpeechRecognition`
  - 웨이크워드: `jarvis`, `자비스`
- 렌더러 음성 출력 fallback
  - 브라우저 `speechSynthesis`

### 모델 계층

- Electron 빠른 계층 LLM
  - `auto` provider selection
    - `Gemini` 우선
    - `OpenAI-compatible` 차선
    - `Ollama` 로컬 fallback
- Electron 복잡 작업용 LLM
  - `auto` provider selection
    - `Gemini`
    - `OpenAI-compatible`
    - `Ollama` fallback
  - OpenAI-compatible API
    - `LM Studio`
    - `Jan`
    - `AnythingLLM`
    - `OpenWebUI`
    - 공식 `OpenAI`
    - 기타 OpenAI 호환 서버
- Electron 라우터 / 플래너 / 일반 대화 분리
  - intent routing
  - browser planning
  - app planning
  - general chat tiering
- LiveKit voice LLM
  - `Gemini`
  - `OpenAI`
  - `Groq`
  - OpenAI-compatible endpoint

### Python 음성 / MCP 런타임

- `FastMCP` SSE 서버
- `LiveKit Agents`
- LiveKit plugins
  - `Groq STT`
  - `OpenAI STT / LLM / TTS`
  - `Google Gemini LLM`
  - `Google TTS`
  - `Sarvam STT / TTS`
  - `macOS say` local TTS fallback
  - `Silero VAD`
- `python-dotenv`
- `httpx`

### 브라우저 자동화

- `Playwright`
- Chromium 번들 브라우저 fallback
- Google Chrome 저장 프로필 재사용 / 미러링
- 검색 / 링크 클릭 / 페이지 읽기 / 로그인 자동화

### 데스크톱 자동화

- macOS 기준
  - `AppleScript`
  - `System Events`
  - Spotlight + 파일시스템 기반 앱 카탈로그
  - Discord/워크스페이스 OCR 클릭 보조
- Windows 기준
  - 앱 열기
  - URL 열기
- Linux 기준
  - URL 열기

### 화면 / OCR / 미디어

- `screenshot-desktop`
- `tesseract` CLI
- Python 측 `pytesseract` + `Pillow`
- macOS `screencapture`
- macOS `say`

### 음성 출력

- Electron TTS provider chain
  - `ElevenLabs`
  - `Cartesia Sonic`
  - `NAVER CLOVA Voice`
  - `Google Cloud TTS`
  - `system fallback`
- Voice agent TTS
  - `macOS say`
  - `OpenAI TTS`
  - `Google TTS`
  - `Sarvam Bulbul`

### OBS / 방송 연동

- Electron: `obs-websocket-js`
- Python MCP: `obs-websocket-py`

### 저장소 / 보안

- Electron `safeStorage`
- macOS `security` CLI
- Python `keyring`
- 공유 vault 인덱스 파일
  - `~/.friday-jarvis/credentials.json`
- 민감 작업 audit log
  - `~/.friday-jarvis/audit.log`

### 검증 / 진단

- Node syntax check
- Node tests
- Python smoke tests
- Python end-to-end smoke script
- LiveKit token generator
- MCP SSE health check
- Desktop LLM configuration smoke
- Browser login smoke
- OBS TCP reachability check

## 배포 / 업데이트

- Electron 앱은 이제 패키징 가능한 구조를 가집니다.
- Assistant UI는 Next standalone 산출물로 빌드되어 앱 리소스 안에 함께 포함됩니다.
- 패키징된 앱은 자체 로컬 UI 서버를 띄운 뒤 Electron 설정 창에 연결합니다.
- 같은 Next 코드베이스로 공개용 다운로드 랜딩 페이지도 만들 수 있습니다.
  - `NEXT_PUBLIC_JARVIS_SITE_MODE=download` 이면 루트 `/`가 다운로드 사이트처럼 동작합니다.
  - `/download` 경로는 항상 공개용 다운로드 페이지를 제공합니다.
- `electron-updater` + `electron-builder` 기반 자동 업데이트 흐름을 지원합니다.
- 배포 / 릴리스 절차는 [DISTRIBUTION.md](docs/DISTRIBUTION.md) 에 정리되어 있습니다.

## FastMCP 표면

현재 Python MCP 서버는 다음 표면을 제공합니다.

### Tool Groups

- Web tools 5개
  - `get_world_news`
  - `search_web`
  - `fetch_url`
  - `open_browser`
  - `automate_login`
- System tools 6개
  - `get_current_time`
  - `get_system_info`
  - `run_shell_command`
  - `list_directory`
  - `read_file`
  - `write_file`
- Utility tools 4개
  - `format_json`
  - `word_count`
  - `base64_encode`
  - `base64_decode`
- Media tools 7개
  - `capture_screen`
  - `ocr_image`
  - `obs_start_recording`
  - `obs_stop_recording`
  - `obs_start_streaming`
  - `obs_stop_streaming`
  - `text_to_speech`
- File / credential tools 8개
  - `store_credential`
  - `get_credential`
  - `list_saved_credentials`
  - `delete_saved_credential`
  - `copy_file`
  - `move_file`
  - `delete_file`
  - `create_directory`

### Prompt Templates

- `summarize`
- `explain_code`
- `translate`
- `analyze_sentiment`

### Resources

- `friday://info`
- `friday://capabilities`

## 사용자 입력에서 출력까지

### 1. Electron 팝업 텍스트 입력 경로

1. 사용자가 팝업 창에 텍스트를 입력합니다.
2. 렌더러는 `assistant:submit-command` IPC로 메인 프로세스에 명령을 전달합니다.
3. `AssistantService`가 최근 대화 히스토리와 현재 입력을 보고 intent를 분류합니다.
4. 분류 결과에 따라 다음 중 하나로 보냅니다.
   - 일반 대화
   - 앱 열기
   - 앱 내부 작업
   - 브라우저 작업
   - 브라우저 로그인
   - 화면 요약
   - 화면 학습 보조
   - OBS 작업
   - 파일 읽기 / 쓰기 / 목록
   - 스트림 준비
   - Spotify 작업
5. 일반 대화는 fast/complex LLM tier 중 하나를 선택해 응답을 생성합니다.
6. 로컬 작업은 브라우저 서비스, 파일 서비스, OBS 서비스, 화면 OCR 서비스, 데스크톱 자동화 어댑터 등으로 실행됩니다.
7. 작업이 끝나면 `polishCommandReply`가 결과를 자연스러운 자비스 말투로 다듬습니다.
8. 결과는 팝업 UI에 텍스트로 표시됩니다.
9. 사용자가 응답 읽기를 켜 두었으면 TTS 서비스가 클라우드 TTS를 시도하고, 실패하면 브라우저 `speechSynthesis`로 fallback 합니다.

### 2. Electron 설정창 웨이크워드 / 1회성 음성 입력 경로

1. 사용자가 설정창에서 웨이크워드를 켜거나 1회성 음성 버튼을 누릅니다.
2. 렌더러는 `SpeechRecognition` / `webkitSpeechRecognition`으로 마이크 입력을 받습니다.
3. 웨이크워드 `jarvis` 또는 `자비스`를 감지하면 팝업을 띄우고 후속 명령을 기다리거나 바로 실행합니다.
4. 인식된 텍스트는 결국 `assistant:submit-command`로 들어가므로, 이후 파이프라인은 팝업 텍스트 입력과 동일합니다.
5. 응답은 설정창 메시지 로그와 음성 출력으로 돌아옵니다.

### 3. Electron 직접 툴 호출 경로

설정창은 일반 대화 라우팅을 거치지 않고 특정 도구를 바로 부를 수 있습니다.

- 앱 목록 조회
- 앱 열기
- 화면 OCR
- 화면 학습 보조
- 브라우저 열기 / 검색 / 읽기 / 로그인
- 자격증명 저장 / 목록 / 삭제
- OBS 연결 / 상태 / 시작 / 종료 / 씬 전환
- 파일 읽기 / 쓰기 / 목록

이 경로는 디버깅, 고급 설정, 즉시 실행 버튼 성격에 가깝습니다.

### 4. LiveKit 음성 에이전트 경로

1. 사용자가 LiveKit 룸에 접속합니다.
2. 마이크 오디오는 STT provider로 전달됩니다.
   - 기본 조합은 `Groq STT + OpenAI STT fallback`
3. 텍스트로 변환된 사용자 발화는 `AgentSession`으로 들어갑니다.
4. `FridayAgent`는 선택된 LLM provider를 사용해 응답을 생성합니다.
5. LLM은 필요할 때 Python FastMCP 서버를 SSE로 호출합니다.
6. MCP 서버는 웹, 파일, OBS, OCR, 시스템, 자격증명 등의 도구를 실행합니다.
7. 실행 결과는 다시 LLM 컨텍스트로 돌아갑니다.
8. 최종 응답은 TTS provider로 음성 합성되어 LiveKit 세션에 재생됩니다.
   - macOS에서는 유료 TTS 키가 없어도 `say` fallback으로 바로 말할 수 있습니다.

### 5. 브라우저 자동화 내부 경로

1. 브라우저 요청은 먼저 간단한 heuristic plan 또는 LLM planner를 거쳐 step list로 바뀝니다.
2. `BrowserService`가 Playwright persistent context를 확보합니다.
3. 가능하면 저장된 Chrome 프로필 또는 미러링된 시스템 프로필을 사용합니다.
4. 실패하면 Playwright 번들 브라우저로 fallback 합니다.
5. `open_url`, `search_google`, `search_youtube`, `click_text`, `click_search_result`, `read_page`를 순서대로 실행합니다.
6. 마지막 페이지 스냅샷과 실행 로그가 assistant에 반환됩니다.

### 6. 자격증명 경로

1. Electron 또는 Python 도구가 서비스명 / URL 기준으로 site key를 정규화합니다.
2. 메타데이터는 `~/.friday-jarvis/credentials.json`에 저장됩니다.
3. 실제 비밀번호는 OS secure store에 저장됩니다.
   - Electron: `safeStorage` + macOS `security`
   - Python: `keyring` + macOS `security`
4. 브라우저 로그인이나 MCP credential tool이 같은 저장소를 공유합니다.

## Electron 오케스트레이터가 이해하는 주요 라우트

- `chat`
- `browser`
- `browser_login`
- `screen_summary`
- `screen_academic`
- `obs_connect`
- `obs_status`
- `obs_start`
- `obs_stop`
- `obs_scene`
- `file_read`
- `file_write`
- `file_list`
- `stream_prep`
- `app_open`
- `app_action`
- `app_list`
- `spotify_play`

## 지금 실현 가능한 역할

아래 역할들은 현재 코드 기준으로 실제 구현되어 있는 역할입니다. 다만 표면과 플랫폼에 따라 범위가 다릅니다.

| 역할 | 어디서 동작 | 현재 가능한 일 |
| --- | --- | --- |
| 일반 대화형 자비스 | Electron 팝업, Electron 설정창, LiveKit voice | 한국어/영어 대화, 짧은 추천, 후속 질문, 자연스러운 보좌관 응답 |
| LLM 라우터 / 플래너 | Electron | 요청을 채팅/브라우저/앱/파일/OBS/화면 분석 등으로 분기 |
| 데스크톱 앱 런처 | Electron | 설치된 앱 목록 조회, 앱 열기, 최근 앱 컨텍스트 기억 |
| 범용 앱 조작자 | Electron, macOS 중심 | 앱 포커스, 텍스트 입력, 키 입력, 단축키 실행, 메뉴 클릭 |
| Spotify 보조자 | Electron, macOS | Spotify 열기, 검색, 다음 곡, 이전 곡, 일시정지, 재생 재개 |
| Finder 보조자 | Electron, macOS | 경로 열기, 새 창 열기, Finder 검색 |
| Notes 보조자 | Electron, macOS | 새 노트 생성, 노트 검색 |
| Chrome 보조자 | Electron, macOS | 지정 대상 열기, 새 탭, 뒤로/앞으로, 새로고침 |
| 워크스페이스 메시지 보조자 | Electron, macOS | Slack/Discord 대상 전환, 메시지 전송, 후속 질문으로 메시지 슬롯 채우기 |
| Discord DM 읽기 보조자 | Electron, macOS | 현재 화면에 보이는 1:1 DM OCR 읽기 |
| 브라우저 조작자 | Electron, Electron direct tools, MCP/voice 일부 | URL 열기, Google/YouTube 검색, 검색 결과 클릭, 현재 페이지 읽기 |
| 브라우저 로그인 보조자 | Electron, MCP/voice | 저장된 자격증명으로 로그인 페이지에 아이디/비밀번호 입력 |
| 화면 읽기 보조자 | Electron, MCP/voice | 화면 캡처, OCR, 요약 |
| 화면 학습 / 튜터 역할 | Electron | 현재 화면 OCR을 바탕으로 문제 풀이, 문장 설명, 공부 방향 안내 |
| 파일 보조자 | Electron, MCP/voice | 파일 읽기, 쓰기, 디렉터리 목록, 복사, 이동, 삭제, 폴더 생성 |
| OBS 보조자 | Electron, MCP/voice | Electron에서 OBS 연결/상태/스트림 시작/중지/씬 전환, Python MCP에서 녹화/스트리밍 시작/중지 |
| 스트림 준비 보조자 | Electron | OBS 열기, Steam 열기, Twitch 열기, OBS 상태 점검 |
| 뉴스 / 정보 브리퍼 | MCP/voice | 월드 뉴스 RSS 수집, 웹 검색, URL fetch |
| 시스템 유틸리티 보조자 | MCP/voice | 현재 시간, 시스템 정보, 셸 명령 실행, JSON 포맷팅, 단어 수, Base64 인코딩/디코딩 |
| 보안 자격증명 매니저 | Electron, MCP/voice | 로그인 정보 저장, 조회, 목록, 삭제, 브라우저 로그인에 재사용 |
| 음성 세션 에이전트 | LiveKit voice | STT → LLM → MCP tool → TTS 전체 루프 |

## 표면별 기능 차이

### Electron 팝업 / 설정창

- 가장 실사용성이 높은 표면입니다.
- 로컬 앱 조작, 브라우저 조작, OCR, OBS, 파일 작업, TTS 설정, 자격증명 관리가 여기에 집중되어 있습니다.
- LLM은 fast tier와 complex tier로 나뉘어 있습니다.

### LiveKit voice agent

- 실시간 음성 세션용 표면입니다.
- `friday` MCP 도구를 폭넓게 사용할 수 있습니다.
- Electron 전용 앱 자동화보다는 Python MCP 도구 축에 가깝습니다.

### FastMCP server

- 음성 에이전트가 쓰는 백엔드이자, 별도 MCP 클라이언트가 붙을 수 있는 도구 서버입니다.
- 웹 / 시스템 / 파일 / OCR / OBS / 자격증명 / 유틸리티 도구를 제공합니다.

## 플랫폼 지원 범위

### macOS

- 가장 많이 구현되어 있습니다.
- 앱 카탈로그 검색
- AppleScript/System Events 기반 앱 조작
- Finder / Notes / Chrome / Spotify / Discord 워크플로
- macOS Keychain 연동
- `say` 기반 시스템 음성
- `screencapture` 기반 화면 캡처

### Windows

- 현재는 기본 열기 동작 위주입니다.
- 앱 열기
- URL 열기
- 고급 앱 내부 자동화는 아직 충분히 연결되지 않았습니다.

### Linux

- 현재는 URL 열기 중심입니다.
- 데스크톱 앱 제어는 제한적입니다.

## 민감 작업 가드레일

다음 계열 작업은 기본적으로 바로 열리지 않도록 가드가 있습니다.

- 셸 명령 실행
- 브라우저 자동 로그인
- 저장된 자격증명 삭제
- 파일 복사 / 이동 / 삭제 / 디렉터리 생성

민감 작업은 다음 조건을 만족해야 실행됩니다.

1. 도구 호출 시 `confirmed=True`
2. 환경 변수 `FRIDAY_ENABLE_SENSITIVE_TOOLS=1`

민감 작업 로그는 `~/.friday-jarvis/audit.log`에 남습니다.

## 실행

### Python

```bash
uv sync
uv run friday
uv run friday_voice
```

또는:

```bash
python main.py server
python main.py voice
python main.py token --room friday-dev --identity jyh-local
python main.py doctor
```

### Electron

```bash
npm install
npm run install:browsers
npm run dev
```

## 검증

```bash
npm run check
npm run test:node
.venv/bin/python -m unittest -v tests/test_friday_smoke.py
npm run e2e:smoke
```

현재 검증 계층은 다음을 포함합니다.

- Electron 주요 서비스 syntax check
- BrowserService / CredentialStore / OBS / assistant tier routing Node tests
- Python voice preflight smoke tests
- MCP SSE 서버 연결 smoke
- Desktop LLM 설정 smoke
- 브라우저 로그인 smoke
- OBS TCP reachability check

## 주요 엔트리

- MCP 서버: [server.py](/Users/JYH/Desktop/Jarvis%20Prototype/server.py)
- 음성 에이전트: [agent_friday.py](/Users/JYH/Desktop/Jarvis%20Prototype/agent_friday.py)
- 통합 실행기: [main.py](/Users/JYH/Desktop/Jarvis%20Prototype/main.py)
- Electron 메인: [main.cjs](/Users/JYH/Desktop/Jarvis%20Prototype/src/main/main.cjs)
- 명령 오케스트레이터: [assistant-service.cjs](/Users/JYH/Desktop/Jarvis%20Prototype/src/main/assistant-service.cjs)
- 브라우저 자동화: [browser-service.cjs](/Users/JYH/Desktop/Jarvis%20Prototype/src/main/browser-service.cjs)
- 데스크톱 자동화 어댑터: [platform-adapters.cjs](/Users/JYH/Desktop/Jarvis%20Prototype/src/main/platform-adapters.cjs)
- 화면 OCR: [screen-service.cjs](/Users/JYH/Desktop/Jarvis%20Prototype/src/main/screen-service.cjs)
- OBS 서비스: [obs-service.cjs](/Users/JYH/Desktop/Jarvis%20Prototype/src/main/obs-service.cjs)
- TTS 서비스: [tts-service.cjs](/Users/JYH/Desktop/Jarvis%20Prototype/src/main/tts-service.cjs)
- 공용 자격증명 저장소: [credential-store.cjs](/Users/JYH/Desktop/Jarvis%20Prototype/src/main/credential-store.cjs)

## 주요 환경 변수

전체 목록과 예시는 [.env.example](/Users/JYH/Desktop/Jarvis%20Prototype/.env.example)를 기준으로 보는 것이 가장 정확합니다. 여기에는 실제로 자주 만지는 축만 정리합니다.

### Voice / MCP

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `FRIDAY_STT_PROVIDER`
- `FRIDAY_STT_FALLBACK_PROVIDER`
- `FRIDAY_LLM_PROVIDER`
- `FRIDAY_LLM_MODEL`
- `FRIDAY_LLM_BASE_URL`
- `FRIDAY_LLM_API_KEY`
- `FRIDAY_TTS_PROVIDER`
- `GROQ_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`
- `SARVAM_API_KEY`

### Electron LLM / local backend

- `JARVIS_FAST_LLM_PROVIDER`
- `JARVIS_FAST_LLM_MODEL`
- `JARVIS_FAST_ROUTER_MODEL`
- `JARVIS_FAST_PLANNER_MODEL`
- `JARVIS_COMPLEX_LLM_PROVIDER`
- `JARVIS_COMPLEX_LLM_MODEL`
- `JARVIS_COMPLEX_LLM_URL`
- `JARVIS_COMPLEX_LLM_API_KEY`
- `OLLAMA_URL`

`JARVIS_FAST_LLM_PROVIDER`, `JARVIS_COMPLEX_LLM_PROVIDER`는 `auto`, `gemini`, `openai-compatible`, `ollama`를 받을 수 있고, `auto`일 때는 구성된 키를 기준으로 `Gemini -> OpenAI-compatible -> Ollama` 순서로 선택합니다.

### Electron TTS / media / OBS

- `FRIDAY_TTS_PROVIDER`
- `FRIDAY_TTS_FALLBACK_PROVIDER`
- `ELEVENLABS_API_KEY`
- `CARTESIA_API_KEY`
- `NAVER_CLOVA_CLIENT_ID`
- `NAVER_CLOVA_CLIENT_SECRET`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `OBS_HOST`
- `OBS_PORT`
- `OBS_PASSWORD`

## 현재 README에서 강조하는 기준

이 README는 “장기적으로 하고 싶은 것”이 아니라 “지금 코드에 연결되어 있는 것”을 기준으로 작성되어 있습니다.

- Electron 팝업은 텍스트 명령 중심으로 바로 사용 가능합니다.
- Electron 설정창은 웨이크워드/1회성 음성 입력, TTS 설정, 직접 툴 실행, 자격증명 관리까지 담당합니다.
- LiveKit voice agent는 별도 환경 키와 LiveKit 세션이 준비되면 음성 세션으로 동작합니다.
- macOS에서는 LiveKit voice agent의 음성 출력이 `macOS say`로 fallback 가능해서 유료 TTS 없이도 말하기 테스트가 가능합니다.
- macOS가 가장 구현 범위가 넓고, Windows/Linux는 기본 동작 위주입니다.
