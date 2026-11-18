"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_BROWSER_SEARCH_LENGTH, browserHandoffTarget } from "../../../../../src/main/assistant/browser-handoff.cjs";
import { MAX_REVIEW_ADDRESS_LENGTH } from "@/lib/browser-review";
import { useWorkspaceLocale } from "@/lib/workspace-language";

type Mode = "address" | "search";
type Status = "pending" | "opened" | "input" | "failed" | "permission";

export function BrowserHandoff({ computerControl }: { computerControl: boolean | null }) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const [mode, setMode] = useState<Mode>("address");
  const [inputs, setInputs] = useState({ address: "", search: "" });
  const [status, setStatus] = useState<Status | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const pending = useRef<symbol | null>(null);
  const address = mode === "address";
  const input = inputs[mode];
  const ready = computerControl === true && status !== "pending";

  useEffect(() => {
    if (computerControl) field.current?.focus();
    else setStatus(null);
    return () => { pending.current = null; };
  }, [computerControl]);

  function select(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setStatus(null);
    if (ready) field.current?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const invoke = window.assistantAPI?.invokeTool;
    if (!ready || !invoke || pending.current) return;
    const request = { mode, input };
    if (!browserHandoffTarget(request)) {
      setStatus("input");
      field.current?.focus();
      return;
    }
    const attempt = Symbol();
    pending.current = attempt;
    setStatus("pending");
    try {
      const result = await invoke("browser:handoff", request) as { ok: boolean; reason?: string };
      if (pending.current !== attempt) return;
      setStatus(result.ok ? "opened" : result.reason === "BROWSER_INPUT" ? "input"
        : result.reason === "BROWSER_PERMISSION" ? "permission" : "failed");
    } catch {
      if (pending.current === attempt) setStatus("failed");
    } finally {
      if (pending.current === attempt) pending.current = null;
    }
  }

  const messages: Record<Status, string> = {
    pending: t("브라우저를 여는 중…", "Opening browser…"),
    opened: t("기본 브라우저에 열기를 요청했습니다.", "Sent to your default browser."),
    input: address ? t("사용자 이름이나 비밀번호가 없는 HTTP 또는 HTTPS 주소를 입력하세요.",
      "Enter an HTTP or HTTPS address without a username or password.")
      : t("검색어를 한 줄로 200자 이내로 입력하세요.", "Enter a one-line search of up to 200 characters."),
    failed: t("브라우저를 열지 못했습니다. 기본 브라우저 설정을 확인하고 다시 시도하세요.",
      "Couldn’t open the browser. Check your default browser and try again."),
    permission: t("로그인과 컴퓨터 제어 상태를 확인하세요.", "Check that you’re signed in and Computer control is on."),
  };

  return (
    <div className="jarvis-text-tool">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("브라우저 작업", "Browser action")}>
        <button type="button" className="jarvis-secondary-button" aria-pressed={address}
          disabled={status === "pending"} onClick={() => select("address")}>{t("웹 주소", "Web address")}</button>
        <button type="button" className="jarvis-secondary-button" aria-pressed={!address}
          disabled={status === "pending"} onClick={() => select("search")}>{t("Google 검색", "Google search")}</button>
      </div>
      {computerControl !== true && <p role="status" className="jarvis-result-detail">
        {computerControl === null ? t("이 도구는 Jarvis 데스크톱에서 사용할 수 있습니다.", "This tool is available in Jarvis Desktop.")
          : t("툴바에서 컴퓨터 제어를 켜세요.", "Turn on Computer control in the toolbar.")}
      </p>}
      <form className="grid gap-3" onSubmit={submit}>
        <label className="grid gap-2 text-sm">
          {address ? t("페이지 주소", "Page address") : t("검색어", "Search query")}
          <input ref={field} className="jarvis-text-tool-control" type="text" inputMode={address ? "url" : "search"}
            value={input} maxLength={address ? MAX_REVIEW_ADDRESS_LENGTH : MAX_BROWSER_SEARCH_LENGTH}
            placeholder={address ? "https://" : undefined} autoComplete="off" autoCapitalize="none"
            spellCheck={!address} disabled={computerControl !== true} readOnly={status === "pending"}
            aria-invalid={status === "input"} onChange={(event) => {
              setInputs({ ...inputs, [mode]: event.target.value });
              setStatus(null);
            }} />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="jarvis-result-detail">
            {address ? t("기본 브라우저에서 엽니다.", "Opens in your default browser.")
              : t("검색어를 Google에 보냅니다.", "Sends the query to Google.")}
          </p>
          <button type="submit" className="jarvis-secondary-button ml-auto" disabled={!ready || !input.trim()}>
            {address ? t("브라우저에서 열기", "Open in browser") : t("Google에서 검색", "Search on Google")}
          </button>
        </div>
      </form>
      {status && <p className="jarvis-result-detail" role={status === "opened" || status === "pending" ? "status" : "alert"}>
        {messages[status]}
      </p>}
    </div>
  );
}
