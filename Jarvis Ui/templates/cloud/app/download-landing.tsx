"use client";

import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  LockKeyhole,
  Mic,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type DownloadLink = {
  platform: "Windows" | "macOS" | "Linux";
  format: string;
  href: string;
  tagline: string;
  hint: string;
};

type AgreementState = {
  terms: boolean;
  privacy: boolean;
  permissions: boolean;
};

const DOWNLOADS: DownloadLink[] = [
  {
    platform: "Windows",
    format: ".exe",
    href: process.env.NEXT_PUBLIC_JARVIS_WINDOWS_DOWNLOAD_URL?.trim() || "",
    tagline: "빠른 설치 마법사",
    hint: "일반 사용자에게 가장 쉬운 방식입니다. 설치 후 시작 메뉴에서 바로 실행할 수 있습니다.",
  },
  {
    platform: "macOS",
    format: ".dmg",
    href: process.env.NEXT_PUBLIC_JARVIS_MAC_DOWNLOAD_URL?.trim() || "",
    tagline: "macOS 데스크톱 앱",
    hint: "처음 실행할 때 자동화, 마이크, 접근성 권한 안내가 보일 수 있습니다.",
  },
  {
    platform: "Linux",
    format: ".AppImage",
    href: process.env.NEXT_PUBLIC_JARVIS_LINUX_DOWNLOAD_URL?.trim() || "",
    tagline: "포터블 배포본",
    hint: "추가 스토어 없이 바로 실행 가능한 휴대용 패키지입니다.",
  },
];

const RELEASE_NOTES_URL =
  process.env.NEXT_PUBLIC_JARVIS_RELEASE_NOTES_URL?.trim() || "";

const CONSENT_STORAGE_KEY = "jarvis-install-consent-v1";

const STEPS = [
  {
    eyebrow: "Step 01",
    title: "기기를 선택하세요",
    detail: "설치 파일 형식과 첫 실행 가이드를 OS에 맞게 준비합니다.",
  },
  {
    eyebrow: "Step 02",
    title: "설치 조건을 확인하세요",
    detail: "브라우저, 음성, 자동화 기능에 필요한 런타임과 권한을 미리 안내합니다.",
  },
  {
    eyebrow: "Step 03",
    title: "설치 전 동의를 완료하세요",
    detail: "이용 약관, 개인정보 처리, 기기 제어 권한에 대한 안내를 읽고 진행합니다.",
  },
  {
    eyebrow: "Step 04",
    title: "다운로드 후 설치를 시작하세요",
    detail: "설치 파일을 내려받고 첫 실행 체크리스트에 따라 설정을 마무리합니다.",
  },
] as const;

function detectPlatform(): DownloadLink["platform"] | "" {
  if (typeof navigator === "undefined") {
    return "";
  }

  const source = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();

  if (source.includes("mac")) {
    return "macOS";
  }

  if (source.includes("win")) {
    return "Windows";
  }

  if (source.includes("linux")) {
    return "Linux";
  }

  return "";
}

function getInstallChecklist(platform: DownloadLink["platform"] | "") {
  if (platform === "macOS") {
    return [
      "`.dmg`를 열고 Jarvis를 Applications로 이동합니다.",
      "처음 실행 후 `개인정보 보호 및 보안`에서 마이크와 자동화 권한을 허용합니다.",
      "브라우저 로그인 세션을 유지하려면 기본 브라우저 프로필 사용을 권장합니다.",
    ];
  }

  if (platform === "Windows") {
    return [
      "`.exe` 설치 마법사를 실행하고 설치 경로를 선택합니다.",
      "처음 실행 후 마이크 접근과 자동화 권한 팝업을 허용합니다.",
      "브라우저 제어를 안정적으로 쓰려면 Chrome 또는 Edge 로그인 상태를 유지합니다.",
    ];
  }

  return [
    "`.AppImage` 파일에 실행 권한을 부여한 뒤 실행합니다.",
    "브라우저 자동화와 음성 기능을 위해 필요한 시스템 권한을 확인합니다.",
    "배포판에 따라 추가 의존성이 필요한 경우 릴리즈 노트를 먼저 확인합니다.",
  ];
}

function getPlatformRequirements(platform: DownloadLink["platform"] | "") {
  if (platform === "macOS") {
    return [
      {
        title: "macOS 13 이상 권장",
        body: "Apple Silicon, Intel 모두 가능하지만 최신 보안 권한 UI 기준으로 Ventura 이상이 가장 안정적입니다.",
      },
      {
        title: "마이크 + 자동화 권한",
        body: "음성 대화, 앱 실행, 브라우저 제어 기능은 마이크와 시스템 자동화 허용이 필요합니다.",
      },
      {
        title: "브라우저 프로필 유지",
        body: "로그인된 실제 브라우저 창을 쓰도록 설계하면 로봇 인증과 임시 세션 문제를 줄일 수 있습니다.",
      },
    ];
  }

  if (platform === "Windows") {
    return [
      {
        title: "Windows 11 권장",
        body: "Windows 10도 가능하지만 최신 웹 자동화와 음성 장치 처리 기준으로 11이 더 안정적입니다.",
      },
      {
        title: "관리자 권한 불필요",
        body: "기본 설치는 일반 권한으로 진행하되, 일부 시스템 제어는 처음 한 번 보안 확인이 뜰 수 있습니다.",
      },
      {
        title: "Chrome 또는 Edge 권장",
        body: "로그인된 브라우저 프로필을 유지하면 검색, 재생, 웹 작업 명령의 정확도가 올라갑니다.",
      },
    ];
  }

  return [
    {
      title: "최신 배포판 권장",
      body: "AppImage 호환성과 브라우저 의존성을 위해 최근 Ubuntu 계열 또는 호환 배포판이 가장 편합니다.",
    },
    {
      title: "실행 권한 필요",
      body: "다운로드 후 실행 권한을 부여해야 하며, 일부 환경에서는 sandbox 관련 설정이 필요할 수 있습니다.",
    },
    {
      title: "브라우저/오디오 환경 확인",
      body: "음성 및 브라우저 자동화는 설치된 오디오 스택과 브라우저 경로 설정에 영향을 받습니다.",
    },
  ];
}

function StepBadge({
  active,
  complete,
  index,
}: {
  active: boolean;
  complete: boolean;
  index: number;
}) {
  if (complete) {
    return (
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black text-white">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }

  return (
    <span
      className={[
        "inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm font-medium transition",
        active
          ? "border-black bg-black text-white"
          : "border-black/10 bg-white text-black/60",
      ].join(" ")}
    >
      {index + 1}
    </span>
  );
}

export function DownloadLanding() {
  const [selectedPlatform, setSelectedPlatform] = useState<DownloadLink["platform"] | "">("");
  const [activeStep, setActiveStep] = useState(0);
  const [agreements, setAgreements] = useState<AgreementState>({
    terms: false,
    privacy: false,
    permissions: false,
  });

  const selectedDownload =
    DOWNLOADS.find((item) => item.platform === selectedPlatform) || null;
  const hasDownload = DOWNLOADS.some((item) => Boolean(item.href));
  const allConsentsAccepted =
    agreements.terms && agreements.privacy && agreements.permissions;
  const requirements = useMemo(
    () => getPlatformRequirements(selectedPlatform),
    [selectedPlatform],
  );
  const installChecklist = useMemo(
    () => getInstallChecklist(selectedPlatform),
    [selectedPlatform],
  );

  useEffect(() => {
    const detectedPlatform = detectPlatform();
    if (detectedPlatform) {
      setSelectedPlatform(detectedPlatform);
    } else if (DOWNLOADS[0]) {
      setSelectedPlatform(DOWNLOADS[0].platform);
    }

    try {
      const storedValue = window.localStorage.getItem(CONSENT_STORAGE_KEY);
      if (!storedValue) {
        return;
      }

      const parsed = JSON.parse(storedValue) as Partial<AgreementState>;
      setAgreements((current) => ({
        terms: Boolean(parsed.terms ?? current.terms),
        privacy: Boolean(parsed.privacy ?? current.privacy),
        permissions: Boolean(parsed.permissions ?? current.permissions),
      }));
    } catch (_error) {
      // Ignore corrupted local consent state and continue with fresh defaults.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(agreements));
  }, [agreements]);

  const stepReady = [
    Boolean(selectedPlatform),
    Boolean(selectedPlatform),
    allConsentsAccepted,
    allConsentsAccepted && Boolean(selectedDownload?.href),
  ];

  const canMoveNext = stepReady[activeStep];
  const canDownload = allConsentsAccepted && Boolean(selectedDownload?.href);

  return (
    <main className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      <header className="sticky top-0 z-30 border-b border-black/6 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4 sm:px-10 lg:px-12">
          <div className="flex items-center gap-3">
            <img
              src="/jarvis-logo-badge.png"
              alt="Jarvis"
              className="h-10 w-10 rounded-[0.95rem] bg-black object-cover shadow-[0_14px_28px_rgba(0,0,0,0.18)]"
            />
            <div>
              <p className="text-[0.68rem] font-semibold tracking-[0.28em] text-black/45 uppercase">
                Jarvis
              </p>
              <p className="text-sm font-medium text-black/80">
                Install Preview
              </p>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-black/58 md:flex">
            <a href="#overview" className="transition hover:text-black">
              Overview
            </a>
            <a href="#wizard" className="transition hover:text-black">
              Install Wizard
            </a>
            <a href="#terms" className="transition hover:text-black">
              Terms
            </a>
          </nav>

          <a
            href="#wizard"
            className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-2.5 text-sm font-medium text-white transition hover:bg-black/88"
          >
            Install
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </header>

      <section
        id="overview"
        className="relative overflow-hidden border-b border-black/6 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.92),rgba(245,245,247,0.72)_42%,rgba(233,233,237,0.72)_100%)]"
      >
        <div className="absolute left-1/2 top-16 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-black/[0.06] blur-3xl" />
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-6 py-18 sm:px-10 lg:grid-cols-[1.12fr_0.88fr] lg:px-12 lg:py-24">
          <div className="relative space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-4 py-2 text-xs font-medium tracking-[0.2em] text-black/55 uppercase shadow-sm backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Installation Experience
            </div>

            <div className="space-y-5">
              <p className="text-sm font-medium tracking-[0.18em] text-black/45 uppercase">
                Download. Review. Agree. Install.
              </p>
              <h1 className="max-w-4xl text-5xl leading-none font-semibold tracking-[-0.055em] text-black sm:text-6xl lg:text-7xl">
                설치 전에 필요한 모든 걸, 한 화면에서 끝냅니다.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-black/62">
                Jarvis는 단순한 런처가 아니라 음성, 브라우저, 데스크톱
                자동화를 함께 다루는 앱입니다. 그래서 설치 전 단계도 더
                명확하고 더 안전해야 합니다. 지금 페이지는 다운로드 링크가 아니라
                실제 설치 준비 화면으로 동작합니다.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <a
                href="#wizard"
                className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/88"
              >
                설치 시작
                <ChevronRight className="h-4 w-4" />
              </a>
              {RELEASE_NOTES_URL ? (
                <a
                  href={RELEASE_NOTES_URL}
                  className="inline-flex items-center rounded-full border border-black/10 bg-white/70 px-6 py-3 text-sm font-medium text-black/78 transition hover:border-black/18 hover:bg-white"
                >
                  릴리즈 노트 보기
                </a>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[2rem] border border-black/8 bg-white/72 p-5 shadow-[0_16px_48px_rgba(0,0,0,0.06)] backdrop-blur">
                <p className="text-xs font-semibold tracking-[0.22em] text-black/40 uppercase">
                  Platform
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
                  Desktop
                </p>
                <p className="mt-2 text-sm leading-6 text-black/58">
                  macOS, Windows, Linux 설치 파일을 한 페이지에서 분기합니다.
                </p>
              </div>
              <div className="rounded-[2rem] border border-black/8 bg-white/72 p-5 shadow-[0_16px_48px_rgba(0,0,0,0.06)] backdrop-blur">
                <p className="text-xs font-semibold tracking-[0.22em] text-black/40 uppercase">
                  Consent
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
                  Preflight
                </p>
                <p className="mt-2 text-sm leading-6 text-black/58">
                  설치 전 권한, 약관, 데이터 처리 방식을 먼저 확인합니다.
                </p>
              </div>
              <div className="rounded-[2rem] border border-black/8 bg-white/72 p-5 shadow-[0_16px_48px_rgba(0,0,0,0.06)] backdrop-blur">
                <p className="text-xs font-semibold tracking-[0.22em] text-black/40 uppercase">
                  Setup
                </p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
                  Guided
                </p>
                <p className="mt-2 text-sm leading-6 text-black/58">
                  설치 후 첫 실행 권한 설정까지 체크리스트로 안내합니다.
                </p>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-x-12 top-12 h-44 rounded-full bg-black/[0.08] blur-3xl" />
            <div className="relative overflow-hidden rounded-[2.5rem] bg-[#0a0a0d] p-7 text-white shadow-[0_40px_100px_rgba(10,10,12,0.28)]">
              <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center gap-4">
                  <img
                    src="/jarvis-logo-badge.png"
                    alt="Jarvis mark"
                    className="h-18 w-18 rounded-[1.5rem] border border-white/10 bg-black object-cover"
                  />
                  <div>
                    <p className="text-xs font-medium tracking-[0.24em] text-white/45 uppercase">
                      Jarvis Desktop
                    </p>
                    <p className="mt-2 text-3xl font-semibold tracking-[-0.05em]">
                      설치 전용 가이드
                    </p>
                  </div>
                </div>

                <div className="mt-8 grid gap-4">
                  <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5">
                    <div className="flex items-start gap-3">
                      <MonitorSmartphone className="mt-1 h-5 w-5 text-white/80" />
                      <div>
                        <p className="text-sm font-semibold">앱 설치에 맞춘 분기</p>
                        <p className="mt-2 text-sm leading-6 text-white/62">
                          운영체제별 파일 형식, 권한 흐름, 첫 실행 체크리스트를
                          한 번에 정리합니다.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="mt-1 h-5 w-5 text-white/80" />
                      <div>
                        <p className="text-sm font-semibold">동의 이후 다운로드 해제</p>
                        <p className="mt-2 text-sm leading-6 text-white/62">
                          약관과 권한 안내를 읽은 사용자만 설치 파일 버튼이
                          활성화되도록 설계했습니다.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5">
                    <div className="flex items-start gap-3">
                      <Mic className="mt-1 h-5 w-5 text-white/80" />
                      <div>
                        <p className="text-sm font-semibold">음성 + 브라우저 + 자동화</p>
                        <p className="mt-2 text-sm leading-6 text-white/62">
                          Jarvis의 실제 강점이 무엇인지 설치 전부터 사용자가
                          오해 없이 이해할 수 있게 만듭니다.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-6 py-12 sm:px-10 lg:grid-cols-3 lg:px-12">
        <div className="rounded-[2rem] bg-white p-7 shadow-[0_12px_48px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-semibold tracking-[0.22em] text-black/42 uppercase">
            Natural Control
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
            앱 이름을 말하면 앱이 먼저 이해되는 흐름
          </h2>
          <p className="mt-4 text-sm leading-7 text-black/60">
            “유튜브에서 음악 틀어줘” 같은 문장을 단어 조각이 아니라 의도 단위로
            해석하도록 설계된 Jarvis 경험을 설치 전부터 설명합니다.
          </p>
        </div>
        <div className="rounded-[2rem] bg-white p-7 shadow-[0_12px_48px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-semibold tracking-[0.22em] text-black/42 uppercase">
            Hybrid Runtime
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
            로컬 제어와 클라우드 모델을 함께 쓰는 구조
          </h2>
          <p className="mt-4 text-sm leading-7 text-black/60">
            빠른 작업은 가벼운 모델로, 복잡한 작업은 더 강한 모델이나 로컬
            백엔드로 넘기는 하이브리드 전략을 유지합니다.
          </p>
        </div>
        <div className="rounded-[2rem] bg-white p-7 shadow-[0_12px_48px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-semibold tracking-[0.22em] text-black/42 uppercase">
            Safe Setup
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
            설치 전에 권한과 데이터 흐름을 먼저 공개
          </h2>
          <p className="mt-4 text-sm leading-7 text-black/60">
            자동화, 음성, 브라우저 연동은 편리하지만 민감합니다. 그래서 동의
            없는 다운로드보다 사전 고지가 우선입니다.
          </p>
        </div>
      </section>

      <section id="wizard" className="mx-auto w-full max-w-7xl px-6 py-6 sm:px-10 lg:px-12">
        <div className="rounded-[2.5rem] bg-white p-6 shadow-[0_18px_60px_rgba(0,0,0,0.08)] sm:p-8 lg:p-10">
          <div className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr]">
            <aside className="space-y-6">
              <div>
                <p className="text-xs font-semibold tracking-[0.24em] text-black/42 uppercase">
                  Install Wizard
                </p>
                <h2 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-black">
                  다운로드 전에 설치를 정리합니다.
                </h2>
                <p className="mt-4 text-base leading-8 text-black/60">
                  이 흐름은 실제 설치 파일을 실행하기 전 단계입니다. 사용자는
                  운영체제를 선택하고, 요구사항을 읽고, 동의를 마친 뒤에만
                  다운로드 버튼을 누를 수 있습니다.
                </p>
              </div>

              <div className="space-y-3">
                {STEPS.map((step, index) => (
                  <button
                    type="button"
                    key={step.title}
                    onClick={() => setActiveStep(index)}
                    className={[
                      "flex w-full items-start gap-4 rounded-[1.6rem] border px-4 py-4 text-left transition",
                      activeStep === index
                        ? "border-black bg-black text-white"
                        : "border-black/8 bg-[#f8f8fa] text-black hover:bg-[#f1f1f4]",
                    ].join(" ")}
                  >
                    <StepBadge
                      active={activeStep === index}
                      complete={index < activeStep && stepReady[index]}
                      index={index}
                    />
                    <div>
                      <p
                        className={[
                          "text-[0.68rem] font-semibold tracking-[0.2em] uppercase",
                          activeStep === index ? "text-white/55" : "text-black/42",
                        ].join(" ")}
                      >
                        {step.eyebrow}
                      </p>
                      <p className="mt-2 text-base font-semibold">{step.title}</p>
                      <p
                        className={[
                          "mt-2 text-sm leading-6",
                          activeStep === index ? "text-white/72" : "text-black/58",
                        ].join(" ")}
                      >
                        {step.detail}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="rounded-[1.8rem] bg-[#0c0c10] p-6 text-white">
                <p className="text-xs font-semibold tracking-[0.22em] text-white/46 uppercase">
                  Selected Platform
                </p>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
                  {selectedDownload?.platform || "Not selected"}
                </p>
                <p className="mt-2 text-sm text-white/60">
                  {selectedDownload?.hint ||
                    "운영체제를 선택하면 설치 포맷과 첫 실행 가이드가 여기에 표시됩니다."}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {DOWNLOADS.map((item) => (
                    <span
                      key={item.platform}
                      className={[
                        "rounded-full border px-3 py-1 text-xs",
                        selectedPlatform === item.platform
                          ? "border-white/20 bg-white/12 text-white"
                          : "border-white/10 text-white/48",
                      ].join(" ")}
                    >
                      {item.platform} {item.format}
                    </span>
                  ))}
                </div>
              </div>
            </aside>

            <div className="rounded-[2rem] bg-[#f7f7f9] p-6 sm:p-8">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <p className="text-xs font-semibold tracking-[0.22em] text-black/42 uppercase">
                    {STEPS[activeStep].eyebrow}
                  </p>
                  <h3 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-black">
                    {STEPS[activeStep].title}
                  </h3>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-black/60">
                    {STEPS[activeStep].detail}
                  </p>
                </div>

                <div className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-black/58">
                  {activeStep + 1} / {STEPS.length}
                </div>
              </div>

              {activeStep === 0 ? (
                <div className="mt-8 grid gap-4 md:grid-cols-3">
                  {DOWNLOADS.map((item) => {
                    const available = Boolean(item.href);
                    const selected = selectedPlatform === item.platform;

                    return (
                      <button
                        type="button"
                        key={item.platform}
                        onClick={() => setSelectedPlatform(item.platform)}
                        className={[
                          "rounded-[1.8rem] border p-5 text-left transition",
                          selected
                            ? "border-black bg-black text-white shadow-[0_16px_34px_rgba(0,0,0,0.14)]"
                            : "border-black/8 bg-white text-black hover:border-black/16",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-2xl font-semibold tracking-[-0.04em]">
                              {item.platform}
                            </p>
                            <p
                              className={[
                                "mt-2 text-sm",
                                selected ? "text-white/68" : "text-black/50",
                              ].join(" ")}
                            >
                              {item.tagline}
                            </p>
                          </div>
                          <span
                            className={[
                              "rounded-full border px-3 py-1 text-xs",
                              selected
                                ? "border-white/18 bg-white/10 text-white"
                                : "border-black/10 text-black/55",
                            ].join(" ")}
                          >
                            {item.format}
                          </span>
                        </div>
                        <p
                          className={[
                            "mt-5 text-sm leading-6",
                            selected ? "text-white/75" : "text-black/60",
                          ].join(" ")}
                        >
                          {available
                            ? item.hint
                            : "다운로드 링크가 아직 연결되지 않았습니다. 공개 전 URL을 설정해야 합니다."}
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {activeStep === 1 ? (
                <div className="mt-8 grid gap-4">
                  {requirements.map((item) => (
                    <div
                      key={item.title}
                      className="rounded-[1.6rem] border border-black/8 bg-white p-5"
                    >
                      <p className="text-lg font-semibold tracking-[-0.03em]">
                        {item.title}
                      </p>
                      <p className="mt-2 text-sm leading-7 text-black/60">
                        {item.body}
                      </p>
                    </div>
                  ))}
                  <div className="rounded-[1.6rem] border border-black/8 bg-black p-5 text-white">
                    <div className="flex items-start gap-3">
                      <WandSparkles className="mt-1 h-5 w-5 text-white/76" />
                      <div>
                        <p className="text-lg font-semibold tracking-[-0.03em]">
                          첫 실행 팁
                        </p>
                        <p className="mt-2 text-sm leading-7 text-white/68">
                          Jarvis는 실제 로그인된 브라우저 프로필을 사용할수록 더
                          자연스럽게 동작합니다. 임시 브라우저보다 사용 중인 실제
                          브라우저 세션을 우선 연결하는 방향이 가장 좋습니다.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeStep === 2 ? (
                <div id="terms" className="mt-8 space-y-4">
                  <div className="rounded-[1.8rem] border border-black/8 bg-white p-6">
                    <div className="flex items-start gap-3">
                      <LockKeyhole className="mt-1 h-5 w-5 text-black/72" />
                      <div>
                        <p className="text-lg font-semibold tracking-[-0.03em]">
                          설치 전 안내
                        </p>
                        <p className="mt-2 text-sm leading-7 text-black/60">
                          Jarvis는 음성, 브라우저 자동화, 앱 실행, 로컬 기기 제어를
                          포함할 수 있습니다. 연결된 모델 공급자(OpenAI, Google,
                          Groq 등)가 있는 경우 일부 요청은 외부 API를 통해
                          처리됩니다.
                        </p>
                      </div>
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-start gap-4 rounded-[1.6rem] border border-black/8 bg-white p-5">
                    <input
                      type="checkbox"
                      checked={agreements.terms}
                      onChange={(event) =>
                        setAgreements((current) => ({
                          ...current,
                          terms: event.target.checked,
                        }))
                      }
                      className="mt-1 h-4 w-4 rounded border-black/25"
                    />
                    <div>
                      <p className="text-base font-semibold">이용 약관 동의</p>
                      <p className="mt-2 text-sm leading-7 text-black/60">
                        본 소프트웨어가 베타 상태일 수 있음을 이해하고, 설치 후
                        발생하는 권한 요청과 로컬 자동화 동작을 허용하는 범위 내에서
                        사용하겠습니다.
                      </p>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-start gap-4 rounded-[1.6rem] border border-black/8 bg-white p-5">
                    <input
                      type="checkbox"
                      checked={agreements.privacy}
                      onChange={(event) =>
                        setAgreements((current) => ({
                          ...current,
                          privacy: event.target.checked,
                        }))
                      }
                      className="mt-1 h-4 w-4 rounded border-black/25"
                    />
                    <div>
                      <p className="text-base font-semibold">개인정보 및 데이터 처리 동의</p>
                      <p className="mt-2 text-sm leading-7 text-black/60">
                        음성 전사, LLM 응답, 검색 요청 등은 연결된 공급자 설정에 따라
                        로컬 또는 외부 서비스에서 처리될 수 있음을 이해했습니다.
                      </p>
                    </div>
                  </label>

                  <label className="flex cursor-pointer items-start gap-4 rounded-[1.6rem] border border-black/8 bg-white p-5">
                    <input
                      type="checkbox"
                      checked={agreements.permissions}
                      onChange={(event) =>
                        setAgreements((current) => ({
                          ...current,
                          permissions: event.target.checked,
                        }))
                      }
                      className="mt-1 h-4 w-4 rounded border-black/25"
                    />
                    <div>
                      <p className="text-base font-semibold">시스템 권한 안내 확인</p>
                      <p className="mt-2 text-sm leading-7 text-black/60">
                        마이크, 접근성, 자동화, 브라우저 제어 등 민감한 권한은 사용자가
                        직접 허용해야 하며, 거부하면 일부 기능이 제한될 수 있음을
                        확인했습니다.
                      </p>
                    </div>
                  </label>
                </div>
              ) : null}

              {activeStep === 3 ? (
                <div className="mt-8 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
                  <div className="rounded-[1.8rem] border border-black/8 bg-white p-6">
                    <p className="text-xs font-semibold tracking-[0.22em] text-black/40 uppercase">
                      Ready to Download
                    </p>
                    <p className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
                      {selectedDownload?.platform || "플랫폼 선택 필요"}
                    </p>
                    <p className="mt-3 text-sm leading-7 text-black/60">
                      {selectedDownload?.hint ||
                        "먼저 운영체제를 선택하면 설치 파일과 안내가 표시됩니다."}
                    </p>

                    <div className="mt-6 flex flex-wrap gap-3">
                      {canDownload && selectedDownload ? (
                        <a
                          href={selectedDownload.href}
                          className="inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/88"
                        >
                          <Download className="h-4 w-4" />
                          {selectedDownload.platform} 다운로드
                        </a>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-black/10 bg-[#f3f3f6] px-5 py-3 text-sm font-medium text-black/42">
                          {selectedDownload?.href
                            ? "동의를 완료하면 다운로드가 활성화됩니다."
                            : "다운로드 URL이 아직 연결되지 않았습니다."}
                        </span>
                      )}

                      {RELEASE_NOTES_URL ? (
                        <a
                          href={RELEASE_NOTES_URL}
                          className="inline-flex items-center rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-black/72 transition hover:border-black/18"
                        >
                          릴리즈 노트
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-[1.8rem] border border-black/8 bg-black p-6 text-white">
                    <p className="text-xs font-semibold tracking-[0.22em] text-white/42 uppercase">
                      First Launch Checklist
                    </p>
                    <div className="mt-5 space-y-4">
                      {installChecklist.map((item, index) => (
                        <div
                          key={item}
                          className="flex items-start gap-4 rounded-[1.3rem] border border-white/10 bg-white/[0.04] p-4"
                        >
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-black">
                            {index + 1}
                          </span>
                          <p className="text-sm leading-7 text-white/70">{item}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-black/8 pt-6">
                <div className="text-sm text-black/52">
                  {hasDownload
                    ? "다운로드 링크가 연결된 플랫폼만 실제 설치를 진행할 수 있습니다."
                    : "환경 변수에 다운로드 URL을 넣어야 실제 공개 설치가 가능합니다."}
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveStep((current) => Math.max(0, current - 1))}
                    disabled={activeStep === 0}
                    className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-black/70 transition hover:border-black/18 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    이전
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveStep((current) =>
                        Math.min(STEPS.length - 1, current + 1),
                      )
                    }
                    disabled={activeStep === STEPS.length - 1 || !canMoveNext}
                    className="inline-flex items-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-black/88 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    다음
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-6 py-12 sm:px-10 lg:grid-cols-[0.9fr_1.1fr] lg:px-12">
        <div className="rounded-[2rem] bg-white p-7 shadow-[0_12px_48px_rgba(0,0,0,0.06)]">
          <p className="text-xs font-semibold tracking-[0.22em] text-black/42 uppercase">
            What You Agree To
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
            설치 동의는 단순한 체크박스가 아닙니다.
          </h2>
          <p className="mt-4 text-sm leading-7 text-black/60">
            이 페이지는 실제로 무엇이 설치되고 어떤 권한이 필요한지 먼저 설명합니다.
            사용자가 나중에 놀라지 않도록, 가장 민감한 부분을 설치 전에 공개합니다.
          </p>
        </div>
        <div className="grid gap-4">
          <div className="rounded-[1.8rem] bg-white p-6 shadow-[0_12px_48px_rgba(0,0,0,0.06)]">
            <p className="text-lg font-semibold tracking-[-0.03em]">
              브라우저 자동화 안내
            </p>
            <p className="mt-2 text-sm leading-7 text-black/60">
              Jarvis는 웹 검색, 로그인 후 작업, 재생 제어를 위해 브라우저와 상호작용할
              수 있습니다. 임시 브라우저보다 실제 사용자 프로필 기반 연결이 더 안전하고
              정확합니다.
            </p>
          </div>
          <div className="rounded-[1.8rem] bg-white p-6 shadow-[0_12px_48px_rgba(0,0,0,0.06)]">
            <p className="text-lg font-semibold tracking-[-0.03em]">
              음성 및 모델 공급자 안내
            </p>
            <p className="mt-2 text-sm leading-7 text-black/60">
              STT, TTS, LLM은 로컬 또는 연결된 외부 서비스 설정에 따라 동작합니다.
              설치 이후 사용자가 어떤 공급자를 붙였는지에 따라 데이터 경로와 비용이
              달라질 수 있습니다.
            </p>
          </div>
          <div className="rounded-[1.8rem] bg-white p-6 shadow-[0_12px_48px_rgba(0,0,0,0.06)]">
            <p className="text-lg font-semibold tracking-[-0.03em]">
              베타 상태 및 업데이트
            </p>
            <p className="mt-2 text-sm leading-7 text-black/60">
              일부 기능은 실험적일 수 있으며, 공개 배포 후에는 업데이트를 통해 계속
              개선됩니다. 배포 채널에 따라 서명 및 노타라이즈 상태가 달라질 수 있습니다.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-black/6 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-black/48 sm:px-10 lg:flex-row lg:items-center lg:justify-between lg:px-12">
          <p>
            Jarvis install landing. Download links unlock only after platform
            selection and consent.
          </p>
          <div className="flex flex-wrap gap-5">
            <a href="#overview" className="transition hover:text-black">
              Overview
            </a>
            <a href="#wizard" className="transition hover:text-black">
              Install Wizard
            </a>
            <a href="#terms" className="transition hover:text-black">
              Terms
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
