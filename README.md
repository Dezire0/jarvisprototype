# F.R.I.D.A.Y. Structure, J.A.R.V.I.S. Desktop Shell

이 프로젝트는 이제 루트 구조를 사용자가 붙여준 `friday-tony-stark-demo-main/` 기준으로 맞춘 상태입니다.

즉, 기준 구조는 아래처럼 갑니다.

```text
.
├── server.py
├── agent_friday.py
├── main.py
├── pyproject.toml
├── friday/
│   ├── config.py
│   ├── prompts/
│   ├── resources/
│   └── tools/
└── src/
    ├── main/
    └── renderer/
```

차이는 하나만 있습니다.

- 원본 `friday`는 MCP 서버와 음성 에이전트 중심 구조입니다.
- 이 프로젝트는 그 위에 Electron 기반 `Jarvis` 팝업 셸을 추가로 얹었습니다.

## 실행 구성

| 구성 요소 | 실행 명령 | 설명 |
|---|---|---|
| MCP 서버 | `uv run friday` | `server.py` 기준 FastMCP 서버 |
| 음성 에이전트 | `uv run friday_voice` | `agent_friday.py` 기준 LiveKit 음성 에이전트 |
| 데스크톱 셸 | `npm run dev` | Electron 팝업 UI와 로컬 자동화 |

## 원본과의 차이점

이 프로젝트는 사용자가 제공한 원본 `friday` 구조를 기준으로 다시 맞췄지만, 기능 방향은 완전히 동일하지는 않습니다.

### 원본 `friday`와 다른 점

- 원본 `friday`
  주로 `MCP 서버 + LiveKit 음성 에이전트` 구조에 집중되어 있습니다.
- 현재 프로젝트
  같은 구조를 루트 기준으로 유지하면서, 그 위에 `Electron 팝업 데스크톱 셸`과 `로컬 자동화 레이어`를 추가했습니다.

즉 차이는 이렇습니다.

- 원본은 음성 에이전트 중심입니다.
- 현재 프로젝트는 음성 에이전트 구조를 유지하면서도, 실제 데스크톱 앱처럼 바로 띄워서 쓰는 방향까지 확장되어 있습니다.

### 기존 원본보다 추가된 부분

- 미니멀 팝업 UI
- 앱 실행과 앱 내부 제어
- 브라우저 자동화
- 파일 읽기/쓰기
- 화면 OCR 기반 요약
- OBS 제어
- 한국어/영어 혼합 명령 처리

## 장점

- `friday` 스타일 구조를 유지해서 서버, 음성 에이전트, 도구 레이어 역할이 명확합니다.
- Electron 팝업이 있어서 브라우저 플레이그라운드 없이 바로 로컬 앱처럼 쓸 수 있습니다.
- 텍스트 명령과 음성 구조를 같이 가져갈 수 있습니다.
- 앱 실행, 브라우저 이동, 파일 작업처럼 실제 작업으로 연결되는 부분이 원본보다 넓습니다.
- 로컬 모델 기반으로 대화 흐름을 실험할 수 있어서 초기 개발 비용이 낮습니다.

## 단점

- 구조가 원본보다 커졌기 때문에 설정해야 할 부분이 더 많습니다.
- `friday_voice`는 LiveKit과 여러 API 키가 필요해서 바로 실행하기는 번거롭습니다.
- 화면 이해는 아직 OCR 중심이라서, 진짜 시각 기반 컴퓨터 사용 에이전트 수준은 아닙니다.
- 앱 자동화와 브라우저 자동화는 정해진 패턴에는 강하지만, 모든 UI를 눈으로 보고 자유롭게 처리하는 수준은 아닙니다.
- 대화 품질은 연결한 로컬 모델이나 API 상태에 영향을 많이 받습니다.

## 화면을 읽고 직접적으로 작업을 대신할 수 있나

짧게 말하면, `부분적으로는 가능하지만 완전 자동은 아닙니다.`

### 현재 가능한 것

- 화면을 OCR로 읽고 텍스트를 뽑아낼 수 있습니다.
- 뽑은 텍스트를 바탕으로 화면 요약, 설명, 학습 보조, 문장 교정 방향 제안이 가능합니다.
- 사용자가 이어서 명령하면 그 내용을 바탕으로 브라우저 작업, 앱 실행, 파일 작업으로 넘어갈 수 있습니다.
- 일부 정해진 앱에서는 검색, 입력, 새 항목 생성, 단축키 실행 같은 후속 작업을 이어서 처리할 수 있습니다.

### 현재 어려운 것

- 화면을 “진짜 사람처럼 시각적으로 이해”해서 모든 버튼과 배치를 자유롭게 판단하는 것은 아닙니다.
- 아무 지시 없이 화면만 보고 모든 업무를 완전히 대신 처리하는 수준은 아닙니다.
- 복잡한 웹앱이나 예외적인 UI에서는 OCR만으로는 정확도가 떨어질 수 있습니다.

### 실제로는 어디까지 대체 가능한가

현재 단계에서는 아래처럼 `반복적이고 패턴이 있는 작업`은 대체 가능성이 있습니다.

- 현재 화면의 핵심 내용 읽기
- 보이는 텍스트를 기준으로 다음 작업 추천
- 이미 알고 있는 앱 열기
- 브라우저에서 검색 후 이동
- Notes, Finder, Spotify, Slack/Discord 같은 일부 앱에서 정해진 흐름 처리

반대로 아래는 아직 제한적입니다.

- 화면을 보고 완전히 자율적으로 복잡한 업무를 끝까지 처리
- 임의의 앱 UI를 모두 시각적으로 해석해서 클릭/드래그/폼 작성
- 사람 개입 없이 예외 상황까지 모두 처리하는 범용 GUI 에이전트

## 대화 가능한가

네, 가능합니다.

### 현재 가능한 대화

- 일상 대화
- 간단한 질문 답변
- 추천과 다음 단계 제안
- 한국어/영어 각각에 맞춘 응답
- 이전 대화의 최근 맥락을 짧게 이어가는 흐름

### 현재 대화의 성격

- 단순 명령창이 아니라, 대화하다가 바로 작업으로 넘어가는 형태를 목표로 합니다.
- 예를 들어 먼저 추천을 받고, 그다음 앱을 열고, 이어서 브라우저 작업을 시키는 식으로 흐름을 이어갈 수 있습니다.

### 한계

- 대화 품질은 연결된 모델에 따라 차이가 큽니다.
- 클라우드 최상급 챗봇처럼 항상 깊고 안정적인 답변을 보장하는 것은 아닙니다.
- 장기 기억이 있는 완전한 개인 비서 수준은 아직 아닙니다. 현재는 최근 맥락 중심입니다.

## 현재 루트 기준 파일

- 메인 MCP 엔트리: [server.py](/Users/JYH/Desktop/Jarvis%20Prototype/server.py)
- 메인 음성 에이전트: [agent_friday.py](/Users/JYH/Desktop/Jarvis%20Prototype/agent_friday.py)
- 루트 패키지: [friday/__init__.py](/Users/JYH/Desktop/Jarvis%20Prototype/friday/__init__.py)
- Electron 메인: [src/main/main.cjs](/Users/JYH/Desktop/Jarvis%20Prototype/src/main/main.cjs)
- 팝업 UI: [src/renderer/popup.html](/Users/JYH/Desktop/Jarvis%20Prototype/src/renderer/popup.html)

호환용으로 아래 파일도 남겨두었습니다.

- [jarvis_server.py](/Users/JYH/Desktop/Jarvis%20Prototype/jarvis_server.py)
- [jarvis_agent.py](/Users/JYH/Desktop/Jarvis%20Prototype/jarvis_agent.py)

이 두 파일은 새 구조를 호출하는 얇은 래퍼입니다.

## Friday 기준 구조 설명

### 1. `server.py`

`friday-tony-stark-demo-main/server.py` 처럼, MCP 서버를 시작하는 루트 엔트리입니다.

### 2. `agent_friday.py`

`friday-tony-stark-demo-main/agent_friday.py` 처럼, LiveKit 기반 음성 에이전트 엔트리입니다.

### 3. `friday/`

원본 레퍼런스처럼 설정, 프롬프트, 리소스, 툴을 모아둔 Python 패키지입니다.

## 빠른 시작

### Python 쪽

```bash
uv sync
uv run friday
uv run friday_voice
```

### Electron 데스크톱 셸

```bash
npm install
npm run install:browsers
npm run dev
```

팝업 열기:

```bash
Cmd/Ctrl + Shift + Space
```

고급 설정 열기:

```bash
Cmd/Ctrl + ,
```

## 지금 가능한 것

- 자연스러운 대화
- 앱 실행과 앱 내부 제어
- 브라우저 열기와 검색
- 화면 OCR과 화면 요약
- 파일 읽기/쓰기
- OBS 상태 읽기와 기본 제어
- TTS 기반 음성 응답

## 주요 차이점

원본 `friday` 레퍼런스와 비교했을 때, 현재 프로젝트는 아래가 추가되어 있습니다.

- Electron 팝업 UI
- 로컬 데스크톱 자동화 레이어
- 다국어 텍스트 명령 오케스트레이션
- 고급 설정 화면

## 환경 변수

### Friday 스타일 음성/MCP

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `SARVAM_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `DEEPGRAM_API_KEY`
- `GROQ_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_API_KEY`

### Electron / 로컬 모델 / 보조 기능

- `JARVIS_MODEL`
- `JARVIS_CHAT_MODEL`
- `JARVIS_ROUTER_MODEL`
- `JARVIS_PLANNER_MODEL`
- `OLLAMA_URL`
- `JARVIS_HEADLESS`
- `NAVER_CLOVA_CLIENT_ID`
- `NAVER_CLOVA_CLIENT_SECRET`
- `ELEVENLABS_API_KEY`
- `CARTESIA_API_KEY`

## 점검 명령

```bash
npm run check
python3 -m compileall friday server.py agent_friday.py jarvis_server.py jarvis_agent.py
```
