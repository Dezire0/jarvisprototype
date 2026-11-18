"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { localDataCategories, reviewLocalData, type LocalDataCategory, type LocalDataReview } from "@/lib/local-workspace";
import type { LocalWorkspace } from "@/lib/use-local-workspace";
import { useWorkspaceLocale } from "@/lib/workspace-language";

export function LocalDataPanel({ local, onCleared }: { local: LocalWorkspace; onCleared: () => void }) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const { workspace, workspaceReady, nativeStorage, clearingData, latestWorkspace, clearLocalData } = local;
  const [selection, setSelection] = useState<LocalDataCategory[]>([]);
  const [review, setReview] = useState<LocalDataReview | null>(null);
  const [result, setResult] = useState<"saved" | "failed" | "changed" | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const receipt = useRef<HTMLParagraphElement>(null);
  const restoreReviewFocus = useRef(false);
  const labels = { tasks: t("할 일", "Tasks"), notes: t("메모", "Notes"), activity: t("최근 활동", "Recent activity") };
  const count = (amount: number) => ko ? `${amount}개` : amount.toLocaleString();
  const canReview = workspaceReady && selection.some((category) => workspace[category].length);

  useLayoutEffect(() => {
    if (result) receipt.current?.focus();
    else if (review) cancel.current?.focus();
    else if (restoreReviewFocus.current) reviewButton.current?.focus();
    restoreReviewFocus.current = false;
  }, [review, result]);

  function startReview() {
    const next = reviewLocalData(latestWorkspace(), selection);
    setResult(next.length ? null : "changed");
    if (next.length) setReview(next);
  }

  async function confirm() {
    if (!review || clearingData) return;
    setResult(null);
    const outcome = await clearLocalData(review);
    setResult(outcome);
    if (outcome !== "failed") setReview(null);
    if (outcome === "saved") {
      setSelection([]);
      onCleared();
    }
  }

  return (
    <div className="jarvis-text-tool">
      <p className="jarvis-result-detail">
        {nativeStorage
          ? t("이 데스크톱 프로필에서 공유하는 도구 데이터입니다.", "Tool data shared by this desktop profile.")
          : t("현재 사이트의 브라우저에 저장된 도구 데이터입니다.", "Tool data stored in this browser for this site.")}
      </p>
      {review ? (
        <>
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">{t("삭제할 데이터", "Data to delete")}</h3>
            <dl className="grid gap-2 text-sm">
              {review.map(({ category, entries }) => (
                <div key={category} className="flex justify-between gap-4">
                  <dt>{labels[category]}</dt>
                  <dd className="tabular-nums text-muted-foreground">{count(entries.length)}</dd>
                </div>
              ))}
            </dl>
            <p className="jarvis-result-detail">{t("삭제한 데이터는 복구할 수 없습니다.", "Deletion is permanent.")}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button ref={cancel} type="button" variant="outline" disabled={clearingData} onClick={() => {
              restoreReviewFocus.current = true;
              setReview(null);
              setResult(null);
            }}>{t("취소", "Cancel")}</Button>
            <Button type="button" variant="destructive" disabled={clearingData} onClick={() => void confirm()}>
              {clearingData ? t("삭제 중…", "Deleting…") : t("선택한 데이터 삭제", "Delete selected data")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <fieldset className="grid gap-2" disabled={!workspaceReady}>
            <legend className="mb-2 text-sm font-medium">{t("삭제할 항목 선택", "Choose data to delete")}</legend>
            {localDataCategories.map((category) => (
              <label key={category} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm">
                <input type="checkbox" className="size-4" checked={selection.includes(category) && workspace[category].length > 0}
                  disabled={!workspace[category].length} onChange={(event) => {
                    setSelection(event.target.checked ? [...selection, category] : selection.filter((item) => item !== category));
                    setResult(null);
                  }} />
                <span>{labels[category]}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{count(workspace[category].length)}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end">
            <Button ref={reviewButton} type="button" disabled={!canReview} onClick={startReview}>
              {t("삭제 전 확인", "Review deletion")}
            </Button>
          </div>
        </>
      )}
      {result && <p ref={receipt} tabIndex={-1} className="jarvis-result-detail" role={result === "saved" ? "status" : "alert"}>
        {result === "saved" ? t("선택한 데이터를 삭제했습니다.", "Deleted the selected data.")
          : result === "changed" ? t("데이터가 바뀌었습니다. 삭제할 항목을 다시 확인하세요.", "The data changed. Review your selection again.")
            : t("삭제 결과를 저장하지 못했습니다. 다시 시도하세요.", "Couldn’t save the deletion. Try again.")}
      </p>}
    </div>
  );
}
