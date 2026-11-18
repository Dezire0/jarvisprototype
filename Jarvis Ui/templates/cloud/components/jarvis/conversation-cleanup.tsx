"use client";

import { useAssistantRuntime } from "@assistant-ui/react";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ChatHistory, ThreadHistory } from "@/lib/chat-history";
import { useWorkspaceLocale } from "@/lib/workspace-language";

export function ConversationCleanup({
  history, currentId, requested, trigger, onClose, onDeleted,
}: {
  history: ChatHistory;
  currentId: string | null;
  requested?: ThreadHistory;
  trigger: HTMLElement | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const runtime = useAssistantRuntime();
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  useSyncExternalStore(history.subscribe, history.getRevision, history.getRevision);
  const entries = history.localThreads().sort((a, b) => b.updatedAt - a.updatedAt);
  const [selected, setSelected] = useState<string[]>(() => requested ? [requested.remoteId] : []);
  const [review, setReview] = useState<ThreadHistory[] | null>(() => requested ? [requested] : null);
  const [error, setError] = useState<"changed" | "storage-changed" | "running" | "save" | "refresh" | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const chosen = entries.filter((thread) => selected.includes(thread.remoteId));
  const allSelected = entries.length > 0 && chosen.length === entries.length;
  const title = (thread: ThreadHistory) => thread.title || t("새 채팅", "New Chat");
  const currentSelected = review?.some((thread) => thread.remoteId === currentId);

  useLayoutEffect(() => { if (review) cancel.current?.focus(); }, [review]);

  async function confirm() {
    if (!review || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    const ids = review.map((thread) => thread.remoteId);
    const findRuntimeIds = () => Object.values(runtime.threads.getState().threadItems)
      .filter((thread) => ids.includes(thread.remoteId ?? thread.id))
      .map((thread) => thread.id);
    let persisted = false;
    try {
      await runtime.threads.getLoadThreadsPromise();
      const running = findRuntimeIds().some((id) => {
        try { return runtime.threads.getById(id).getState().isRunning; }
        catch { return false; }
      });
      if (running) {
        setError("running");
        return;
      }
      const outcome = await history.removeReviewed(review);
      if (outcome !== "saved") {
        setReview(null);
        setError(outcome);
        return;
      }
      persisted = true;
      onDeleted();
      for (const id of findRuntimeIds()) await runtime.threads.getItemById(id).delete();
      onClose();
    } catch {
      if (persisted) setReview(null);
      setError(persisted ? "refresh" : "save");
      return;
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          if (trigger?.isConnected && !trigger.matches(":disabled")) {
            event.preventDefault();
            trigger.focus();
          }
        }}>
        <DialogHeader className="text-left">
          <DialogTitle>{t("대화 관리", "Manage conversations")}</DialogTitle>
          <DialogDescription>{t("이 기기에 저장된 대화 기록입니다.", "Conversation history stored on this device.")}</DialogDescription>
        </DialogHeader>
        {review ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">
              {t(`삭제할 대화 ${review.length}개`, `Conversations to delete · ${review.length}`)}
            </p>
            <ul className="max-h-44 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {review.map((thread) => <li key={thread.remoteId} className="break-words px-3 py-2 text-sm">{title(thread)}</li>)}
            </ul>
            {currentSelected && <p className="jarvis-result-detail">
              {t("현재 대화의 초안도 지워지고 새 채팅이 열립니다.", "This also clears the current draft and opens a new chat.")}
            </p>}
            <p className="jarvis-result-detail">
              {t("클라우드 사본은 동기화 검색에서 다시 열 수 있습니다.",
                "Cloud copies can be reopened through synced search.")}
            </p>
          </div>
        ) : (
          <fieldset className="grid gap-2" disabled={!entries.length}>
            <legend className="mb-2 text-sm font-medium">{t("삭제할 대화 선택", "Choose conversations to delete")}</legend>
            {!entries.length && <p className="jarvis-result-detail">{t("저장된 대화가 없습니다.", "No saved conversations.")}</p>}
            {entries.length > 0 && <>
              <label className="flex items-center gap-3 px-3 py-1 text-sm">
                <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : entries.map((thread) => thread.remoteId))} />
                {t("모두 선택", "Select all")}
              </label>
              <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {entries.map((thread) => (
                  <li key={thread.remoteId}>
                    <label className="flex items-center gap-3 px-3 py-2 text-sm">
                      <input type="checkbox" checked={selected.includes(thread.remoteId)} onChange={(event) => {
                        setSelected(event.target.checked ? [...selected, thread.remoteId] : selected.filter((id) => id !== thread.remoteId));
                        setError(null);
                      }} />
                      <span className="min-w-0 break-words">{title(thread)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>}
          </fieldset>
        )}
        {error && <p className="jarvis-result-detail" role="alert">
          {error === "changed" ? t("대화가 바뀌었습니다. 다시 확인하세요.", "A conversation changed. Review your selection again.")
            : error === "storage-changed" ? t("다른 화면에서 기록을 바꿨습니다. 앱을 다시 열어 검토하세요.",
              "History changed in another window. Reopen the app before reviewing it again.")
            : error === "running" ? t("선택한 대화의 답변이 끝난 뒤 다시 시도하세요.", "Wait for the selected replies to finish, then retry.")
              : error === "refresh" ? t("기록을 삭제했습니다. 앱을 다시 열어 목록을 갱신하세요.", "History was deleted. Reopen the app to refresh the list.")
                : t("대화를 삭제하지 못했습니다. 다시 시도하세요.", "Couldn’t delete the conversations. Try again.")}
        </p>}
        <DialogFooter>
          {review ? <>
            <Button ref={cancel} type="button" variant="outline" disabled={saving} onClick={() => {
              if (requested) onClose();
              else { setReview(null); setError(null); }
            }}>{t("취소", "Cancel")}</Button>
            <Button type="button" variant="destructive" disabled={saving} onClick={() => void confirm()}>
              {saving ? t("삭제 중…", "Deleting…") : t("이 기기에서 삭제", "Delete on this device")}
            </Button>
          </> : <Button type="button" disabled={!chosen.length} onClick={() => { setReview(chosen); setError(null); }}>
            {t("삭제 전 확인", "Review deletion")}{chosen.length ? ` (${chosen.length})` : ""}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
