"use client";

import { useAui } from "@assistant-ui/react";
import { useEffect, useRef, useState } from "react";
import type { ScreenReviewMode } from "@/lib/screen-review";
import { useWorkspaceLocale } from "@/lib/workspace-language";

type ScreenResult = { ok: true; data: { text: string; truncated: boolean } } | { ok: false; reason: string };
type Capture = { kind: "idle" | "reading" | "empty" } |
  { kind: "text"; truncated: boolean } | { kind: "error"; message: string };

export function ScreenReview({ mode, computerControl, onAttached }: {
  mode: ScreenReviewMode;
  computerControl: boolean | null;
  onAttached: () => void;
}) {
  const aui = useAui();
  const isKo = useWorkspaceLocale().startsWith("ko");
  const t = (ko: string, en: string) => isKo ? ko : en;
  const [capture, setCapture] = useState<Capture>({ kind: "idle" });
  const [draft, setDraft] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState(false);
  const active = useRef(false);
  const readButton = useRef<HTMLButtonElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (computerControl) readButton.current?.focus();
  }, [computerControl]);

  useEffect(() => {
    if (capture.kind === "text") textArea.current?.focus();
  }, [capture.kind]);

  async function readScreen() {
    const read = window.assistantAPI?.invokeTool;
    if (!read || !computerControl || capture.kind === "reading" || attaching) return;
    setCapture({ kind: "reading" });
    setDraft("");
    setAttachError(false);
    try {
      const result = await read("screen:ocr") as ScreenResult;
      if (!active.current) return;
      if (!result.ok) {
        const message = result.reason === "OCR_NOT_INSTALLED"
          ? t("화면 글자를 읽으려면 Tesseract를 설치하세요.", "Install Tesseract to read screen text.")
          : result.reason === "SCREEN_CAPTURE_FAILED"
            ? t("화면을 캡처하지 못했습니다. 시스템의 화면 기록 설정을 확인하세요.",
                "Couldn’t capture the screen. Check system screen recording settings.")
            : t("화면 글자를 읽지 못했습니다. Tesseract와 언어 데이터를 확인하세요.",
                "Couldn’t read screen text. Check Tesseract and its language data.");
        setCapture({ kind: "error", message });
        return;
      }
      const { text, truncated } = result.data;
      setDraft(text);
      setCapture(text.trim() ? { kind: "text", truncated } : { kind: "empty" });
    } catch {
      if (active.current) setCapture({
        kind: "error",
        message: t("화면을 읽지 못했습니다. 컴퓨터 제어 설정을 확인하세요.", "Couldn’t read the screen. Check Computer control settings."),
      });
    }
  }

  async function attach() {
    if (!draft.trim() || attaching) return;
    setAttaching(true);
    setAttachError(false);
    const composer = aui.thread().composer();
    try {
      await composer.addAttachment(new File([draft], t("화면 텍스트.txt", "Screen text.txt"), { type: "text/plain" }));
      if (!active.current) return;
      if (!composer.getState().text.trim() && mode !== "read") {
        composer.setText(mode === "study"
          ? t("첨부한 화면 텍스트를 읽고 개념을 설명해 주세요.", "Explain the concepts in the attached screen text.")
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
    <div className="jarvis-screen-review">
      <p className="jarvis-result-detail">
        {t("기본 화면의 글자를 기기에서 읽습니다. 내용을 확인하고 첨부한 뒤 전송하면 모델에 전달됩니다.",
          "Jarvis reads text from the primary display on this device. Review and attach it, then send it to your model.")}
      </p>
      {computerControl === null && <p role="status" className="jarvis-result-detail">
        {t("화면 읽기는 Jarvis 데스크톱에서 사용할 수 있습니다.", "Screen reading is available in Jarvis Desktop.")}
      </p>}
      {computerControl === false && <p role="status" className="jarvis-result-detail">
        {t("툴바에서 컴퓨터 제어를 켜세요.", "Turn on Computer control in the toolbar.")}
      </p>}
      {capture.kind === "reading" && <p role="status" className="jarvis-result-detail">
        {t("화면 글자를 읽는 중…", "Reading screen text…")}
      </p>}
      {capture.kind === "empty" && <p role="status" className="jarvis-result-detail">
        {t("화면에서 읽을 수 있는 텍스트를 찾지 못했습니다.", "No readable text was found on the screen.")}
      </p>}
      {capture.kind === "error" && <p role="alert" className="jarvis-result-detail">{capture.message}</p>}
      {capture.kind === "text" && (
        <label className="grid gap-2 text-sm">
          <span>{t("인식한 텍스트", "Recognized text")}</span>
          {capture.truncated && <span className="text-muted-foreground">
            {t("텍스트 일부만 표시됩니다.", "Only part of the recognized text is shown.")}
          </span>}
          <textarea ref={textArea} className="jarvis-screen-text" value={draft} maxLength={16000}
            onChange={(event) => setDraft(event.target.value)} />
        </label>
      )}
      {attachError && <p role="alert" className="jarvis-result-detail">
        {t("텍스트를 첨부하지 못했습니다. 첨부 목록을 확인하고 다시 시도하세요.",
          "Couldn’t attach the text. Check the current attachments and try again.")}
      </p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button ref={readButton} type="button" className="jarvis-secondary-button" onClick={() => void readScreen()}
          disabled={!computerControl || capture.kind === "reading" || attaching}>
          {capture.kind === "text" ? t("다시 읽기", "Read again") : t("텍스트 읽기", "Read text")}
        </button>
        {capture.kind === "text" && <button type="button" className="jarvis-secondary-button"
          onClick={() => void attach()} disabled={attaching || !draft.trim()}>
          {t("대화에 첨부", "Attach to draft")}
        </button>}
      </div>
    </div>
  );
}
