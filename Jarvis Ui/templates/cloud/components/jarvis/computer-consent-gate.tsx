"use client";

import { useEffect, useState } from "react";

const COMPUTER_CONSENT_KEY = "jarvis-computer-control-consent-v1";

export function ComputerConsentGate() {
  const [ready, setReady] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setAccepted(window.localStorage.getItem(COMPUTER_CONSENT_KEY) === "accepted");
    setReady(true);
  }, []);

  if (!ready || accepted) {
    return null;
  }

  function acceptConsent() {
    if (!checked) {
      return;
    }

    window.localStorage.setItem(COMPUTER_CONSENT_KEY, "accepted");
    setAccepted(true);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-5 backdrop-blur-xl">
      <section
        aria-modal="true"
        aria-labelledby="computer-consent-title"
        role="dialog"
        className="w-full max-w-xl rounded-[32px] border border-white/15 bg-background/95 p-6 text-foreground shadow-[0_32px_120px_rgba(0,0,0,0.45)] md:p-8"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground">
          Computer Control
        </p>
        <h2 id="computer-consent-title" className="mt-3 text-2xl font-semibold tracking-tight">
          Jarvis 컴퓨터 작업 동의
        </h2>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Jarvis는 사용자의 요청을 수행하기 위해 브라우저, 앱, 키보드 입력, 화면 읽기,
          파일 작업을 실행할 수 있습니다. 이 동의 이후에는 사용자가 요청한 컴퓨터 작업을
          동의된 작업으로 보고 진행합니다.
        </p>
        <label className="mt-5 flex gap-3 rounded-2xl border border-border/70 bg-card/70 p-4 text-sm leading-6">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-foreground"
            checked={checked}
            onChange={(event) => setChecked(event.currentTarget.checked)}
          />
          <span>
            민감한 정보 입력, 결제, 구매 같은 최종 행동은 실행 직전에 다시 확인받는
            조건으로 동의합니다.
          </span>
        </label>
        <button
          type="button"
          disabled={!checked}
          onClick={acceptConsent}
          className="mt-5 w-full rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-45"
        >
          동의하고 시작
        </button>
      </section>
    </div>
  );
}
