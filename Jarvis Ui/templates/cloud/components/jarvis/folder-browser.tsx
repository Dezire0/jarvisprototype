"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkspaceLocale } from "@/lib/workspace-language";

type Entry = { id: number; name: string; kind: "file" | "directory" };
type Listing = { directory: string; revision: number; canGoUp: boolean; more: boolean; entries: Entry[] };
type Preview = { name: string; text: string; truncated: boolean };
type Result<T> = { ok: true; outcome: "cancelled" } | { ok: true; data: T } | { ok: false; reason: string };

export function FolderBrowser({ computerControl }: { computerControl: boolean | null }) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const [listing, setListing] = useState<Listing | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ticket = useRef(0);
  const running = useRef(false);
  const previewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!computerControl) { setListing(null); setPreview(null); setError(""); setBusy(false); }
    return () => { ticket.current++; running.current = false; };
  }, [computerControl]);

  useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);

  const errors: Record<string, string> = {
    FOLDER_CHANGED: t("파일이나 폴더가 바뀌었습니다. 목록을 새로 고치거나 폴더를 다시 선택하세요.",
      "The file or folder changed. Refresh the list or choose the folder again."),
    FOLDER_STALE: t("폴더를 다시 선택하세요.", "Choose the folder again."),
    FOLDER_PERMISSION: t("툴바에서 컴퓨터 제어를 확인하세요.", "Check Computer control in the toolbar."),
    FOLDER_BUSY: t("진행 중인 작업이 끝난 뒤 다시 시도하세요.", "Wait for the current operation to finish."),
    FOLDER_FAILED: t("파일이나 폴더를 읽지 못했습니다. 접근 권한을 확인하세요.", "Couldn’t read the file or folder. Check its permissions."),
    UNSUPPORTED_FILE_PREVIEW: t("UTF-8 텍스트 파일만 미리볼 수 있습니다.", "Preview is available for UTF-8 text files."),
  };

  async function run<T>(tool: string, payload: Record<string, unknown>, apply: (data: T) => void) {
    const invoke = window.assistantAPI?.invokeTool;
    if (!computerControl || running.current || !invoke) return;
    const current = ++ticket.current;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await invoke(tool, payload) as Result<T>;
      if (current !== ticket.current) return;
      if (!result.ok) setError(result.reason);
      else if ("data" in result) apply(result.data);
    } catch {
      if (current === ticket.current) setError("FOLDER_PERMISSION");
    } finally {
      if (current === ticket.current) { running.current = false; setBusy(false); }
    }
  }

  function showFolder(folder: Listing) {
    setListing(folder);
    setPreview(null);
  }

  function browse(action: "refresh" | "up" | "enter" | "preview", id?: number) {
    if (!listing) return;
    const payload = { action, revision: listing.revision, id };
    if (action === "preview") void run<Preview>("folder:act", payload, setPreview);
    else void run<Listing>("folder:act", payload, showFolder);
  }

  const disabled = !computerControl || busy;

  return (
    <div className="jarvis-text-tool">
      {!computerControl && <p className="jarvis-result-detail" role="status">
        {computerControl === null ? t("폴더 찾아보기는 Jarvis 데스크톱에서 사용할 수 있습니다.", "Folder browsing is available in Jarvis Desktop.")
          : t("툴바에서 컴퓨터 제어를 켜세요.", "Turn on Computer control in the toolbar.")}
      </p>}
      <div className="flex flex-wrap gap-2">
        <button className="jarvis-secondary-button" type="button" disabled={disabled} onClick={() =>
          void run<Listing>("folder:choose", { language: ko ? "ko" : "en" }, showFolder)}>
          {t("폴더 선택…", "Choose folder…")}
        </button>
        {listing && !preview && <>
          <button className="jarvis-secondary-button" type="button" disabled={disabled || !listing.canGoUp} onClick={() => browse("up")}>
            {t("상위 폴더", "Parent folder")}
          </button>
          <button className="jarvis-secondary-button" type="button" disabled={disabled} onClick={() => browse("refresh")}>
            {t("새로 고침", "Refresh")}
          </button>
        </>}
        {preview && <button className="jarvis-secondary-button" type="button" disabled={disabled} onClick={() => setPreview(null)}>
          {t("파일 목록", "File list")}
        </button>}
      </div>
      {listing && <p className="jarvis-result-detail break-all" dir="ltr">{listing.directory}</p>}
      {preview ? (
        <div className="grid min-w-0 gap-2">
          <h3 ref={previewHeading} tabIndex={-1} className="break-words text-sm font-semibold">{preview.name}</h3>
          {preview.truncated && <p className="jarvis-result-detail">{t("첫 16 KiB까지 표시합니다.", "Showing up to the first 16 KiB.")}</p>}
          <pre tabIndex={0} className="max-h-[45dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border p-3 text-sm">
            {preview.text || t("(빈 파일)", "(Empty file)")}
          </pre>
        </div>
      ) : listing && <>
        {listing.entries.length === 0 && <p role="status" className="jarvis-result-detail">
          {t("표시할 파일이나 폴더가 없습니다.", "No files or folders to show.")}
        </p>}
        {listing.entries.length > 0 && <ul className="grid max-h-[48dvh] overflow-auto border-y border-border">
          {listing.entries.map((entry) => {
            const directory = entry.kind === "directory";
            return <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border py-2 last:border-b-0" key={entry.id}>
              <span className="break-all text-sm">{entry.name}</span>
              <button type="button" className="jarvis-secondary-button" disabled={disabled}
                aria-label={directory ? t(entry.name + " 열기", "Open " + entry.name) : t(entry.name + " 미리보기", "Preview " + entry.name)}
                onClick={() => browse(directory ? "enter" : "preview", entry.id)}>
                {directory ? t("열기", "Open") : t("미리보기", "Preview")}
              </button>
            </li>;
          })}
        </ul>}
        {listing.more && <p className="jarvis-result-detail">{t("항목이 많아 일부만 표시합니다.", "Showing the first set of entries.")}</p>}
      </>}
      {busy && <p role="status" className="jarvis-result-detail">{t("기기에서 확인 중…", "Reading on this device…")}</p>}
      {error && <p role="alert" className="jarvis-result-detail">{errors[error] ?? errors.FOLDER_FAILED}</p>}
    </div>
  );
}
