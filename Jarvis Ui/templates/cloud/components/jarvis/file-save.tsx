"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_FILE_SAVE_BYTES, type FileSaveDraft } from "@/lib/file-save";
import { useWorkspaceLocale } from "@/lib/workspace-language";

type SaveFailure = "cancelled" | "conflict" | "invalid" | "unsupported" | "permission" | "busy" | "failed";
type SaveResponse = { ok: true; data: { path: string } } | { ok: false; reason: SaveFailure };

export function FileSave({ initial, computerControl, onSaved }: {
  initial: FileSaveDraft;
  computerControl: boolean | null;
  onSaved: (path: string) => void;
}) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const [path, setPath] = useState(initial.path);
  const [content, setContent] = useState(initial.content);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const active = useRef(false);
  const pathInput = useRef<HTMLInputElement>(null);
  const overLimit = new TextEncoder().encode(content).length > MAX_FILE_SAVE_BYTES;

  useEffect(() => {
    active.current = true;
    pathInput.current?.focus();
    return () => { active.current = false; };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!computerControl || !path.trim() || overLimit || saving || !window.assistantAPI?.invokeTool) return;
    setSaving(true);
    setFailure(null);
    try {
      const result = await window.assistantAPI.invokeTool("file:write", {
        path, content, language: ko ? "ko" : "en",
      }) as SaveResponse;
      if (!active.current) return;
      if (result.ok) onSaved(result.data.path);
      else setFailure(result.reason);
    } catch {
      if (active.current) setFailure("permission");
    } finally {
      if (active.current) setSaving(false);
    }
  }

  const feedback = {
    cancelled: t("저장을 취소했습니다.", "Save cancelled."),
    conflict: t("파일이 변경됐습니다. 다시 확인한 뒤 저장하세요.", "The file changed. Review it and try saving again."),
    invalid: t("파일 경로와 텍스트 내용을 확인하세요.", "Check the file path and text."),
    unsupported: t("직접 소유한 일반 파일을 선택하세요.", "Choose a regular file you own."),
    permission: t("툴바에서 컴퓨터 제어를 확인하세요.", "Check Computer control in the toolbar."),
    busy: t("진행 중인 저장을 먼저 완료하세요.", "Wait for the current save to finish."),
    failed: t("파일을 저장하지 못했습니다. 경로와 쓰기 권한을 확인하세요.", "Couldn’t save the file. Check the path and write permissions."),
  };

  return (
    <form className="jarvis-text-tool" onSubmit={save}>
      <p className="jarvis-result-detail">
        {t("텍스트를 기기에 저장합니다. 기존 파일을 바꾸려면 시스템 창에서 확인하세요.",
          "Save text on this device. Confirm replacements in the system dialog.")}
      </p>
      {computerControl === null && <p role="status" className="jarvis-result-detail">
        {t("파일 저장은 Jarvis 데스크톱에서 사용할 수 있습니다.", "File saving is available in Jarvis Desktop.")}
      </p>}
      {computerControl === false && <p role="status" className="jarvis-result-detail">{feedback.permission}</p>}
      <label className="grid gap-2 text-sm">
        {t("파일 경로", "File path")}
        <input className="jarvis-text-tool-control" ref={pathInput} type="text" value={path}
          autoComplete="off" spellCheck={false} maxLength={4096} disabled={saving}
          onChange={(event) => { setPath(event.target.value); setFailure(null); }} />
      </label>
      <label className="grid gap-2 text-sm">
        {t("파일 내용", "File content")}
        <textarea className="jarvis-text-tool-control" value={content} disabled={saving}
          onChange={(event) => { setContent(event.target.value); setFailure(null); }} />
      </label>
      {overLimit && <p role="alert" className="jarvis-result-detail">
        {t("텍스트는 64KiB까지 저장할 수 있습니다.", "Text files can be up to 64 KiB.")}
      </p>}
      {failure && <p role={failure === "cancelled" ? "status" : "alert"} className="jarvis-result-detail">{feedback[failure]}</p>}
      <div className="flex justify-end">
        <button type="submit" className="jarvis-secondary-button" disabled={!computerControl || !path.trim() || overLimit || saving}>
          {saving ? t("저장 중…", "Saving…") : t("저장", "Save")}
        </button>
      </div>
    </form>
  );
}
