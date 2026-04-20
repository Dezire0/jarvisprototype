# Jarvis Desktop 상세 기술 특성 분석 (Technical Analysis)

본 문서는 Jarvis Desktop 프로젝트의 코드베이스를 기반으로 한 상세한 기술적 특성과 아키텍처 구조를 분석한 보고서입니다.

---

## 1. 아키텍처 및 설계 원칙 (Architecture)
- **Modular Service Pattern**: 각 기능(브라우저, OS 자동화, 음성, 기억 등)을 독립된 `.cjs` 서비스 모듈로 분리하여 관리합니다. 이는 유지보수성과 확장성을 극대화합니다.
- **Electron Main-Renderer Separation**: 무거운 연산과 OS 권한이 필요한 작업은 Main Process에서 처리하고, 사용자 인터페이스는 Next.js로 구축된 고유의 Renderer에서 처리하는 하이브리드 구조입니다.
- **Bilingual Core**: 한국어와 영어 두 언어를 완벽하게 지원하도록 설계되었으며, `detectLanguageCode`를 통해 사용자의 언어 환경에 맞는 프롬프팅을 자동으로 수행합니다.

## 2. 지능형 에이전트 엔진 (AI Engine)
- **Multi-Model Routing (`ollama-service.cjs`)**: 
  - Gemini, OpenAI API, Local Ollama를 하나의 인터페이스로 통합했습니다.
  - 서버 트래픽 상황이나 설정에 따라 `fast`(Flash 모델)와 `complex`(Pro 모델) 계층으로 나누어 모델을 선택적으로 호출합니다.
- **Autonomous ReAct Loop**: 
  - 단순히 명령을 수행하는 것이 아니라, `Action -> Observation -> Thought` 과정을 거쳐 복잡한 문제를 단계별로 해결합니다.
  - 실행 중 오류가 발생하면 스스로 인지하고 다른 도구를 사용하거나 방법을 수정하는 '자가 치유(Self-healing)' 능력을 갖추고 있습니다.
- **Long-term Memory System**: `memory-store.cjs`를 통해 사용자의 습관, 선호도, 신원 정보를 별도의 JSON 스토어에 관리하여 대화의 맥락을 수개월 이상 유지합니다.

## 3. 강력한 자동화 및 인식 기술 (Automation & Perception)
- **Native macOS Bridge (`os-automation.cjs`, `platform-adapters.cjs`)**:
  - **AppleScript & Swift**: 단순 키보드 입력을 넘어, Swift 스크립트를 통해 창의 ID를 추적하고 네이티브 수준에서 UI 요소를 제어합니다.
  - **Vision OCR**: macOS의 네이티브 Vision 프레임워크를 호출하여 화면의 텍스트를 실시간으로 읽어들임으로써, API가 없는 앱도 제어할 수 있는 '눈' 역할을 합니다.
- **Headless Browser Agent**: Playwright 기반의 브라우저 서비스를 통해 웹에서의 정보 수집과 작업을 백그라운드에서 조용히 수행합니다.

## 4. 보안 및 데이터 관리 (Security)
- **PII Guard (`pii-manager.cjs`)**: 비밀번호나 주소 같은 민감 정보는 절대 AI에게 직접 학습시키지 않고, 안전한 로컬 저장소에 암호화하여 저장합니다. 필요할 때만 에이전트가 `ask_pii` 도구를 통해 호출합니다.
- **Secure Storage**: Electron의 `safeStorage` API를 활용하여 로컬에 저장되는 세션 토큰과 자격 증명을 운영체제 수준에서 암호화합니다.

## 5. 사용자 경험 특성 (UX/DX)
- **Premium Design System**: 사이드바는 Tailwind CSS와 Framer Motion을 활용하여 매끄러운 애니메이션과 다크 모드를 지원하는 최신 웹 감성을 제공합니다.
- **Zero-Config Updates**: GitHub Actions와 연동된 `updater-service.cjs`가 앱 실행 시마다 델타 업데이트를 체크하여 사용자가 항상 최신 기능을 사용할 수 있게 합니다.
- **Voice-First Design**: STT와 TTS 서비스가 통합되어 있어, 키보드 없이도 목소리만으로 컴퓨터를 완벽하게 제어할 수 있는 접근성을 제공합니다.
