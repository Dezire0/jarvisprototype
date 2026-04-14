# Friday-Based Architecture

## 기준점

이 프로젝트는 `friday-tony-stark-demo-main/`의 구조를 기준으로 삼습니다.

즉, 핵심은 다음 두 축입니다.

1. `MCP 서버`
   실제 툴을 등록하고 실행하는 백엔드
2. `음성 에이전트`
   STT, LLM, TTS를 묶어서 MCP 툴을 호출하는 실시간 어시스턴트

현재 프로젝트는 여기에 `Electron 데스크톱 셸`을 추가한 형태입니다.

## 전체 구조

```text
Microphone / Text Input
        │
        ├── Electron Popup
        │      ├─ typed command UI
        │      ├─ speech output
        │      ├─ local desktop automation
        │      └─ settings window
        │
        └── Voice Agent (LiveKit)
               ├─ STT
               ├─ LLM
               ├─ TTS
               └─ MCP tool calls
                       │
                       ▼
                  FastMCP Server
                       ├─ web tools
                       ├─ system tools
                       ├─ file tools
                       ├─ OCR/media tools
                       └─ OBS tools
```

## 레이어

### 1. Desktop Shell

- 위치: `src/main/*`, `src/renderer/*`
- 역할: 팝업 UI, 고급 설정 UI, Electron IPC, 로컬 자동화 연결
- 특징:
  - 검은색 미니멀 팝업
  - 중앙 기준으로 뜨고 드래그 이동 가능
  - 대화, 명령 수행, 추천을 한 흐름으로 연결

### 2. Assistant Orchestrator

- 위치: `src/main/assistant-service.cjs`
- 역할:
  - 한국어/영어 언어 판별
  - 대화/명령 라우팅
  - 브라우저/앱 작업 계획 생성
  - 결과를 자연스러운 응답으로 마무리
- 방향:
  - `friday`의 “짧고 유능한 보좌관” 느낌을 유지
  - 하지만 실제 데스크톱 사용에 맞게 대화형 UX를 강화

### 3. Model Layer

- Electron 쪽:
  - Ollama 기반 로컬 모델
  - 라우터 모델, 일반 대화 모델, 플래너 모델을 분리 가능
- Python 음성 에이전트 쪽:
  - LiveKit Agents 기반
  - STT / LLM / TTS 공급자 교체 가능

### 4. Automation Layer

- 앱 실행/입력/단축키
- Playwright 브라우저 자동화
- 화면 캡처 및 OCR
- OBS WebSocket 제어
- 파일 시스템 읽기/쓰기

### 5. MCP Layer

- 위치: `friday/`, `server.py`
- 역할:
  - Python 도구를 MCP 형식으로 노출
  - `friday` 레퍼런스의 SSE 기반 구조를 유지

## 왜 이렇게 구성했는가

- `friday` 구조를 유지하면 음성 에이전트와 도구 서버 역할이 명확하게 분리됩니다.
- Electron 셸을 추가하면 브라우저 기반 플레이그라운드 없이도 바로 로컬 데스크톱에서 실사용 흐름을 만들 수 있습니다.
- 나중에 사용자 정의 AI 모델로 교체하더라도, UI와 도구 계층을 그대로 재사용할 수 있습니다.

## 현재 우선순위

1. Friday 스타일의 역할 분리를 유지하면서 Jarvis 대화 품질을 더 안정화
2. 앱 내부 제어와 브라우저 다단계 실행 정확도 향상
3. 음성 공급자 설정 UX 단순화
4. 화면 이해를 OCR 기반에서 더 풍부한 멀티모달 분석으로 확장
