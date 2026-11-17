"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LocalToolsLink } from "./local-tools-link";
import { ThemeToggle } from "./theme-toggle";

const COMPUTER_CONSENT_KEY = "jarvis-computer-control-consent-v1";

export function ComputerConsentGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setAccepted(window.localStorage.getItem(COMPUTER_CONSENT_KEY) === "accepted");
    setReady(true);
  }, []);

  if (!ready) return null;
  if (accepted) return children;

  const isKo = navigator.language.startsWith("ko");

  function acceptConsent() {
    if (!checked) {
      return;
    }

    window.localStorage.setItem(COMPUTER_CONSENT_KEY, "accepted");
    setAccepted(true);
  }

  return (
    <div className="jarvis-auth-shell">
      <header className="jarvis-toolbar">
        <span className="font-semibold">Jarvis</span>
        <div className="flex items-center gap-1">
          <LocalToolsLink />
          <ThemeToggle />
        </div>
      </header>
      <main className="jarvis-auth-panel" aria-labelledby="computer-consent-title">
        <h1 id="computer-consent-title">
          {isKo ? "컴퓨터 작업 동의" : "Computer control"}
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          {isKo
            ? "Jarvis는 요청한 작업에 브라우저, 앱, 키보드, 화면, 파일을 사용할 수 있습니다."
            : "Jarvis can use your browser, apps, keyboard, screen and files to carry out your requests."}
        </p>
        <label className="mt-5 flex gap-3 text-sm leading-6">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-foreground"
            checked={checked}
            onChange={(event) => setChecked(event.currentTarget.checked)}
          />
          <span>
            {isKo
              ? "컴퓨터 작업을 허용합니다. 민감한 정보 입력과 결제·구매는 실행 전에 다시 확인합니다."
              : "I allow computer control, with separate confirmation before sensitive data entry, payments or purchases."}
          </span>
        </label>
        <button
          type="button"
          disabled={!checked}
          onClick={acceptConsent}
          className="jarvis-send mt-5 w-full rounded-lg px-5 py-3 text-sm font-semibold disabled:opacity-45"
        >
          {isKo ? "동의하고 시작" : "Agree and continue"}
        </button>
      </main>
    </div>
  );
}
