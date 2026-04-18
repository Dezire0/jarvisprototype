# Friday-Based Architecture

## 기준점

이 프로젝트의 현재 기준 구조는 루트의 `friday/`, `server.py`, `agent_friday.py`, `src/`입니다. 예전 레퍼런스 복사본은 더 이상 실행 경로에 포함되지 않습니다.

핵심 축은 다음 두 가지입니다.

1. `MCP 서버`
   Python 도구를 FastMCP로 노출하는 백엔드
2. `Electron 데스크톱 셸`
   대화, 설정, 앱 자동화, 브라우저 자동화를 묶는 로컬 실행 레이어
3. `Extensions 레이어`
   웹훅, 스킬, 커넥터를 통해 앱별 힌트와 외부 자동화를 확장하는 레이어

음성 에이전트는 별도 엔트리포인트에서 MCP 서버를 호출하는 구조로 붙습니다.

## 전체 구조

```text
Microphone / Text Input
        │
        ├── Electron Desktop Window
        │      ├─ typed command UI
        │      ├─ call-style voice loop
        │      ├─ speech output
        │      ├─ local desktop automation
        │      └─ optional floating popup
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

### 3. Extensions Layer

- 위치: `src/main/extensions-service.cjs`, `extensions/*.json`
- 역할:
  - connector alias로 앱 이름 보정
  - skill 힌트를 앱 플래너에 주입
  - webhook 트리거를 일반 라우팅 전에 실행

### 4. Model Layer

- Electron 쪽:
  - Ollama 기반 로컬 모델
  - 라우터 모델, 일반 대화 모델, 플래너 모델을 분리 가능
- Python 음성 에이전트 쪽:
  - LiveKit Agents 기반
  - STT / LLM / TTS 공급자 교체 가능

### 5. Automation Layer

- 앱 실행/입력/단축키
- Playwright 브라우저 자동화
- 화면 캡처 및 OCR
- OBS WebSocket 제어
- 파일 시스템 읽기/쓰기
- 공용 자격증명 vault 사용

### 6. MCP Layer

- 위치: `friday/`, `server.py`
- 역할:
  - Python 도구를 MCP 형식으로 노출
  - Electron과 같은 자격증명/툴 모델을 공유

## 왜 이렇게 구성했는가

- `friday` 구조를 유지하면 도구 서버와 음성 에이전트 역할이 명확하게 분리됩니다.
- Electron 셸을 추가하면 브라우저 기반 플레이그라운드 없이도 바로 로컬 데스크톱에서 실사용 흐름을 만들 수 있습니다.
- 나중에 사용자 정의 AI 모델로 교체하더라도, UI와 도구 계층을 그대로 재사용할 수 있습니다.
- 자격증명 메타데이터를 `~/.friday-jarvis/credentials.json`으로 통일하면 Electron과 Python 자동화가 같은 로그인 정보를 재사용할 수 있습니다.

## 현재 우선순위

1. Jarvis 대화 품질과 브라우저 다단계 계획 정확도 향상
2. 앱 내부 제어 성공률 향상
3. 음성 공급자 설정 UX 단순화
4. OCR 중심 화면 이해를 더 풍부한 멀티모달 분석으로 확장
