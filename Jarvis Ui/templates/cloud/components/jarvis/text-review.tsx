"use client";

import { useAui } from "@assistant-ui/react";
import { useEffect, useRef, useState } from "react";
import { MAX_REVIEW_ADDRESS_LENGTH, normalizeReviewAddress } from "@/lib/browser-review";
import type { ScreenReviewMode } from "@/lib/screen-review";
import { useWorkspaceLocale } from "@/lib/workspace-language";

type PageSource = { title: string; origin: string };
type ReadResult = { ok: true; data: { text: string; truncated: boolean } & Partial<PageSource> } |
  { ok: false; reason: string };
type Capture = { kind: "idle" | "reading" } | { kind: "empty"; page?: PageSource } |
  { kind: "text"; truncated: boolean; page?: PageSource } | { kind: "error"; message: string };

export function TextReview({ source, mode, initialAddress, computerControl, onAttached }: {
  source: "screen" | "browser";
  mode: ScreenReviewMode;
  initialAddress?: string;
  computerControl: boolean | null;
  onAttached: () => void;
}) {
  const aui = useAui();
  const browser = source === "browser";
  const isKo = useWorkspaceLocale().startsWith("ko");
  const t = (ko: string, en: string) => isKo ? ko : en;
  const [capture, setCapture] = useState<Capture>({ kind: "idle" });
  const [addressMode, setAddressMode] = useState(initialAddress !== undefined);
  const [address, setAddress] = useState(initialAddress ?? "");
  const [draft, setDraft] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState(false);
  const active = useRef(false);
  const readVersion = useRef(0);
  const readButton = useRef<HTMLButtonElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (computerControl) (addressMode ? addressInput : readButton).current?.focus();
    else {
      setDraft("");
      setCapture({ kind: "idle" });
      setAttachError(false);
    }
    return () => { readVersion.current++; };
  }, [computerControl, addressMode]);

  useEffect(() => {
    if (capture.kind === "text") textArea.current?.focus();
  }, [capture.kind]);

  function selectAddressMode(next: boolean) {
    if (next === addressMode) return;
    setCapture({ kind: "idle" });
    setDraft("");
    setAttachError(false);
    setAddressMode(next);
  }

  async function readText() {
    const read = window.assistantAPI?.invokeTool;
    if (!read || !computerControl || capture.kind === "reading" || attaching) return;
    const target = addressMode ? normalizeReviewAddress(address) : null;
    if (addressMode && !target) {
      setCapture({ kind: "error", message: t("사용자 이름이나 비밀번호가 없는 HTTP 또는 HTTPS 주소를 입력하세요.",
        "Enter an HTTP or HTTPS address without a username or password.") });
      addressInput.current?.focus();
      return;
    }
    setCapture({ kind: "reading" });
    setDraft("");
    setAttachError(false);
    const version = ++readVersion.current;
    try {
      const result = (target
        ? await read("browser:read-address", { address: target })
        : await read(browser ? "browser:read" : "screen:ocr")) as ReadResult;
      if (!active.current || version !== readVersion.current) return;
      if (!result.ok) {
        const instructions: Record<string, string> = browser ? {
          BROWSER_NO_PAGE: t("열린 페이지가 없습니다. 웹 주소를 선택해 페이지를 읽으세요.",
            "There is no open page. Choose Web address to read one."),
          BROWSER_PAGE_CHANGED: t("읽는 동안 페이지가 바뀌었습니다. 다시 읽어보세요.", "The page changed while reading. Try again."),
          BROWSER_UNSUPPORTED_PAGE: t("HTTP 또는 HTTPS 웹 페이지를 열어주세요.", "Open an HTTP or HTTPS web page."),
          BROWSER_PERMISSION: t("툴바에서 컴퓨터 제어를 켜세요.", "Turn on Computer control in the toolbar."),
          BROWSER_INVALID_ADDRESS: t("HTTP 또는 HTTPS 주소를 확인하고 다시 시도하세요.", "Check the HTTP or HTTPS address and try again."),
          BROWSER_UNAVAILABLE: t("브라우저를 시작하지 못했습니다. Chrome 또는 Playwright Chromium 설치를 확인하세요.",
            "Couldn’t start a browser. Check that Chrome or Playwright Chromium is installed."),
          BROWSER_HTTP_ERROR: t("웹 서버가 오류를 반환했습니다. 주소를 확인하세요.", "The website returned an error. Check the address."),
          BROWSER_ADDRESS_FAILED: t("주소를 열지 못했습니다. 연결과 주소를 확인하세요.", "Couldn’t open the address. Check the connection and address."),
          BROWSER_BUSY: t("다른 페이지를 읽는 중입니다. 잠시 후 다시 시도하세요.", "Another page is loading. Try again shortly."),
        } : {
          OCR_NOT_INSTALLED: t("화면 글자를 읽으려면 Tesseract를 설치하세요.", "Install Tesseract to read screen text."),
          SCREEN_CAPTURE_FAILED: t("화면을 캡처하지 못했습니다. 시스템의 화면 기록 설정을 확인하세요.",
            "Couldn’t capture the screen. Check system screen recording settings."),
        };
        const message = instructions[result.reason] ?? (browser
          ? t("웹 페이지를 읽지 못했습니다. 다시 시도하세요.", "Couldn’t read the page. Try again.")
          : t("화면 글자를 읽지 못했습니다. Tesseract와 언어 데이터를 확인하세요.",
            "Couldn’t read screen text. Check Tesseract and its language data."));
        setCapture({ kind: "error", message });
        return;
      }
      const { text, truncated, title, origin } = result.data;
      const page = browser && origin ? { title: title ?? "", origin } : undefined;
      setDraft(text);
      setCapture(text.trim() ? { kind: "text", truncated, page } : { kind: "empty", page });
    } catch {
      if (active.current && version === readVersion.current) setCapture({
        kind: "error",
        message: browser
          ? t("웹 페이지를 읽지 못했습니다. 컴퓨터 제어 설정을 확인하세요.", "Couldn’t read the page. Check Computer control settings.")
          : t("화면을 읽지 못했습니다. 컴퓨터 제어 설정을 확인하세요.", "Couldn’t read the screen. Check Computer control settings."),
      });
    }
  }

  async function attach() {
    if (!computerControl || !draft.trim() || attaching) return;
    setAttaching(true);
    setAttachError(false);
    const composer = aui.thread().composer();
    try {
      const name = browser ? t("웹 페이지 텍스트.txt", "Web page text.txt") : t("화면 텍스트.txt", "Screen text.txt");
      await composer.addAttachment(new File([draft], name, { type: "text/plain" }));
      if (!active.current) return;
      if (!composer.getState().text.trim() && mode !== "read") {
        composer.setText(mode === "study"
          ? t("첨부한 화면 텍스트를 읽고 개념을 설명해 주세요.", "Explain the concepts in the attached screen text.")
          : browser ? t("첨부한 웹 페이지 텍스트를 요약해 주세요.", "Summarize the attached web page text.")
            : t("첨부한 화면 텍스트를 요약해 주세요.", "Summarize the attached screen text."));
      }
      onAttached();
    } catch {
      if (active.current) setAttachError(true);
    } finally {
      if (active.current) setAttaching(false);
    }
  }

  return (
    <div className="jarvis-text-tool">
      {browser && <div className="flex flex-wrap gap-2" role="group" aria-label={t("페이지 위치", "Page source")}>
        <button type="button" className="jarvis-secondary-button" aria-pressed={!addressMode}
          onClick={() => selectAddressMode(false)} disabled={capture.kind === "reading" || attaching}>
          {t("현재 페이지", "Current page")}
        </button>
        <button type="button" className="jarvis-secondary-button" aria-pressed={addressMode}
          onClick={() => selectAddressMode(true)} disabled={capture.kind === "reading" || attaching}>
          {t("웹 주소", "Web address")}
        </button>
      </div>}
      <p className="jarvis-result-detail">
        {browser
          ? addressMode
            ? t("새 브라우저 세션에서 페이지를 읽습니다. 검토한 글을 첨부하고 보내면 모델에 전달됩니다.",
              "Read the page in a fresh browser session. Review and attach the text, then send it to your model.")
            : t("Jarvis 브라우저의 현재 페이지를 읽습니다. 첨부한 글은 전송할 때 모델에 전달됩니다.",
              "Read text from the current page in the Jarvis browser. Review and attach the text, then send it to your model.")
          : t("기본 화면의 글자를 기기에서 읽습니다. 내용을 확인하고 첨부한 뒤 전송하면 모델에 전달됩니다.",
            "Jarvis reads text from the primary display on this device. Review and attach it, then send it to your model.")}
      </p>
      {computerControl === null && <p role="status" className="jarvis-result-detail">
        {browser ? t("웹 페이지 읽기는 Jarvis 데스크톱에서 사용할 수 있습니다.", "Page reading is available in Jarvis Desktop.")
          : t("화면 읽기는 Jarvis 데스크톱에서 사용할 수 있습니다.", "Screen reading is available in Jarvis Desktop.")}
      </p>}
      {computerControl === false && <p role="status" className="jarvis-result-detail">
        {t("툴바에서 컴퓨터 제어를 켜세요.", "Turn on Computer control in the toolbar.")}
      </p>}
      {addressMode && <form className="grid gap-2" onSubmit={(event) => {
        event.preventDefault();
        void readText();
      }}>
        <label className="grid gap-2 text-sm">
          <span>{t("페이지 주소", "Page address")}</span>
          <input ref={addressInput} type="text" inputMode="url" autoCapitalize="none" spellCheck={false}
            className="jarvis-text-tool-control" value={address} maxLength={MAX_REVIEW_ADDRESS_LENGTH}
            placeholder="https://" onChange={(event) => setAddress(event.target.value)}
            disabled={!computerControl || capture.kind === "reading" || attaching} />
        </label>
        <button type="submit" className="jarvis-secondary-button justify-self-end"
          disabled={!computerControl || capture.kind === "reading" || attaching || !address.trim()}>
          {t("열어서 읽기", "Open and read")}
        </button>
      </form>}
      {capture.kind === "reading" && <p role="status" className="jarvis-result-detail">
        {browser ? t("웹 페이지를 읽는 중…", "Reading page…") : t("화면 글자를 읽는 중…", "Reading screen text…")}
      </p>}
      {capture.kind === "empty" && <p role="status" className="jarvis-result-detail">
        {browser ? t("페이지에서 읽을 수 있는 글을 찾지 못했습니다.", "No readable text was found on the page.")
          : t("화면에서 읽을 수 있는 텍스트를 찾지 못했습니다.", "No readable text was found on the screen.")}
      </p>}
      {capture.kind === "error" && <p role="alert" className="jarvis-result-detail">{capture.message}</p>}
      {(capture.kind === "text" || capture.kind === "empty") && capture.page && (
        <div className="grid gap-1">
          {capture.page.title && <p className="break-words text-sm font-medium">{capture.page.title}</p>}
          <p className="jarvis-result-detail break-all">{capture.page.origin}</p>
        </div>
      )}
      {capture.kind === "text" && (
        <label className="grid gap-2 text-sm">
          <span>{browser ? t("페이지 텍스트", "Page text") : t("인식한 텍스트", "Recognized text")}</span>
          {capture.truncated && <span className="text-muted-foreground">
            {t("텍스트 일부만 표시됩니다.", "Only part of the recognized text is shown.")}
          </span>}
          <textarea ref={textArea} className="jarvis-text-tool-control" value={draft} maxLength={16000}
            onChange={(event) => setDraft(event.target.value)} />
        </label>
      )}
      {attachError && <p role="alert" className="jarvis-result-detail">
        {t("텍스트를 첨부하지 못했습니다. 첨부 목록을 확인하고 다시 시도하세요.",
          "Couldn’t attach the text. Check the current attachments and try again.")}
      </p>}
      {(!addressMode || capture.kind === "text") && <div className="flex flex-wrap justify-end gap-2">
        {!addressMode && <button ref={readButton} type="button" className="jarvis-secondary-button" onClick={() => void readText()}
          disabled={!computerControl || capture.kind === "reading" || attaching}>
          {capture.kind === "text" ? t("다시 읽기", "Read again")
            : browser ? t("페이지 읽기", "Read page") : t("텍스트 읽기", "Read text")}
        </button>}
        {capture.kind === "text" && <button type="button" className="jarvis-secondary-button"
          onClick={() => void attach()} disabled={!computerControl || attaching || !draft.trim()}>
          {t("대화에 첨부", "Attach to draft")}
        </button>}
      </div>}
    </div>
  );
}
