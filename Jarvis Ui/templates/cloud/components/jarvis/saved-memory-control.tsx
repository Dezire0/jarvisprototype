"use client";

import { BookOpenIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspaceLocale } from "@/lib/workspace-language";

const categories = ["personal", "threads", "projects", "documents"] as const;
export type SavedMemoryReview = {
  revision: string;
  categories: Record<typeof categories[number], {
    count: number;
    entries: { title: string; excerpt: string }[];
  }>;
};

export function SavedMemoryControl({ accountId, useSavedMemory }: { accountId: string; useSavedMemory: boolean }) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<SavedMemoryReview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"read" | "clear" | null>(null);
  const [feedback, setFeedback] = useState<"read" | "clear" | "changed" | "saved" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const ticket = useRef(0);
  const clearing = useRef(false);
  const labels = {
    personal: t("개인 기억", "Personal memory"),
    threads: t("이전 대화 기억", "Conversation recall"),
    projects: t("프로젝트 기억", "Project context"),
    documents: t("문서 발췌", "Document excerpts"),
  };
  const title = t("저장된 기억", "Saved memory");

  useEffect(() => {
    setAvailable(Boolean(window.assistantAPI?.reviewSavedMemory && window.assistantAPI?.clearSavedMemory));
    return () => { ticket.current++; };
  }, []);
  useLayoutEffect(() => { if (confirming) cancel.current?.focus(); }, [confirming]);

  async function refresh() {
    const read = window.assistantAPI?.reviewSavedMemory;
    if (!read) return;
    const current = ++ticket.current;
    setBusy("read");
    try {
      const snapshot = await read(accountId);
      if (ticket.current === current) setReview(snapshot);
    } catch {
      if (ticket.current === current) setFeedback("read");
    } finally {
      if (ticket.current === current) setBusy(null);
    }
  }

  async function clear() {
    const apply = window.assistantAPI?.clearSavedMemory;
    if (!apply || !review || clearing.current) return;
    const current = ++ticket.current;
    clearing.current = true;
    setBusy("clear");
    setFeedback(null);
    try {
      const next = await apply(accountId, review.revision);
      if (ticket.current !== current) return;
      setConfirming(false);
      setReview(next);
      setFeedback(next ? "saved" : "changed");
      if (!next) void refresh();
    } catch {
      if (ticket.current === current) setFeedback("clear");
    } finally {
      clearing.current = false;
      if (ticket.current === current) setBusy(null);
    }
  }

  if (!available) return null;
  const total = review ? categories.reduce((sum, category) => sum + review.categories[category].count, 0) : 0;
  return <>
    <button ref={trigger} type="button" className="jarvis-sidebar-control" aria-haspopup="dialog" onClick={() => {
      setFeedback(null);
      setReview(null);
      setOpen(true);
      void refresh();
    }}>
      <BookOpenIcon className="size-4 shrink-0" aria-hidden="true" />
      <span>{title}</span>
    </button>
    <Dialog open={open} onOpenChange={(next) => {
      if (!next && !clearing.current) {
        ticket.current++;
        setConfirming(false);
        setOpen(false);
      }
    }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          if (!trigger.current?.isConnected) return;
          event.preventDefault();
          trigger.current.focus();
        }}>
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {useSavedMemory ? t("이 계정이 기기에 저장한 기억입니다.", "Memory stored on this device for this account.")
              : t("이 계정의 저장된 기억 사용이 꺼져 있습니다.", "Use of saved memory is off for this account.")}
          </DialogDescription>
        </DialogHeader>
        {busy === "read" && <p role="status" className="jarvis-result-detail">
          {t("기억을 불러오는 중…", "Loading memory…")}
        </p>}
        {review && (
          confirming ? (
            <div className="grid gap-2">
              <p className="text-sm font-medium">{t("이 기기에서 지울 기억", "Memory to clear on this device")}</p>
              <dl className="grid gap-2 text-sm">
                {categories.map((category) => <div key={category} className="flex justify-between gap-4">
                  <dt>{labels[category]}</dt>
                  <dd className="tabular-nums text-muted-foreground">{review.categories[category].count}</dd>
                </div>)}
              </dl>
              <p className="jarvis-result-detail">
                {t("삭제한 기억은 복구할 수 없습니다. 대화 기록은 별도로 관리됩니다.",
                  "This permanently clears saved memory. Conversation history has separate controls.")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {categories.map((category) => {
                const { count, entries } = review.categories[category];
                if (!count) return <div key={category} className="flex justify-between gap-3 px-3 py-2.5 text-sm text-muted-foreground">
                  <span>{labels[category]}</span><span className="tabular-nums">0</span>
                </div>;
                return <details key={category} className="group px-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2">
                      <ChevronRightIcon className="size-3.5 group-open:rotate-90" aria-hidden="true" />
                      {labels[category]}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </summary>
                  <ul className="divide-y divide-border border-t border-border">
                    {entries.map((entry, index) => <li key={index} className="break-words py-2 text-sm">
                      <p className="font-medium">{entry.title || t("제목 없음", "Untitled")}</p>
                      {entry.excerpt && <p className="text-muted-foreground">{entry.excerpt}</p>}
                    </li>)}
                  </ul>
                  {entries.length < count && <p className="jarvis-result-detail pb-2">
                    {t(`${count}개 중 ${entries.length}개 미리보기`, `Showing ${entries.length} of ${count}`)}
                  </p>}
                </details>;
              })}
            </div>
          )
        )}
        {review && !total && !feedback && <p role="status" className="jarvis-result-detail">
          {t("저장된 기억이 없습니다.", "No saved memory.")}
        </p>}
        {feedback && <p role={feedback === "saved" ? "status" : "alert"} className="jarvis-result-detail">
          {feedback === "saved" ? t("이 계정의 저장된 기억을 지웠습니다.", "Cleared saved memory for this account.")
            : feedback === "changed" ? t("저장된 기억이 바뀌었습니다. 다시 확인하세요.", "Saved memory changed. Review it again.")
              : feedback === "clear" ? t("기억을 지우지 못했습니다. 다시 시도하세요.", "Couldn’t clear saved memory. Try again.")
                : t("기억을 불러오지 못했습니다. 다시 시도하세요.", "Couldn’t load saved memory. Try again.")}
        </p>}
        <DialogFooter>
          {confirming ? <>
            <Button ref={cancel} type="button" variant="outline" disabled={Boolean(busy)}
              onClick={() => { setConfirming(false); setFeedback(null); }}>{t("취소", "Cancel")}</Button>
            <Button type="button" variant="destructive" disabled={Boolean(busy)} onClick={() => void clear()}>
              {busy === "clear" ? t("지우는 중…", "Clearing…") : t("이 기기에서 지우기", "Clear on this device")}
            </Button>
          </> : <>
            <Button type="button" variant="outline" disabled={Boolean(busy)}
              onClick={() => { setFeedback(null); void refresh(); }}>{t("새로고침", "Refresh")}</Button>
            {total > 0 && <Button type="button" variant="outline" disabled={Boolean(busy)}
              onClick={() => { setFeedback(null); setConfirming(true); }}>{t("저장된 기억 지우기", "Clear saved memory")}</Button>}
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
