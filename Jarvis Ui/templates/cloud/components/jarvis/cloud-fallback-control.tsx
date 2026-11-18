"use client";

import { useState, useSyncExternalStore } from "react";
import { useChatHistory } from "@/app/jarvis-runtime-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useWorkspaceLocale } from "@/lib/workspace-language";

export function CloudFallbackControl() {
  const history = useChatHistory();
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  useSyncExternalStore(history.subscribe, history.getRevision, history.getRevision);
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  if (!history.cloudFallbackAvailable) return null;

  function changeOpen(next: boolean) {
    if (next) {
      setAllowed(history.allowCloudFallback);
      setError(false);
    }
    setOpen(next);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(false);
    const saved = await history.saveCloudFallback(allowed);
    setSaving(false);
    if (saved) setOpen(false);
    else setError(true);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <div className="jarvis-composer-destination">
        <DialogTrigger asChild>
          <button type="button" className="jarvis-composer-alternate">
            {history.allowCloudFallback
              ? t("Jarvis Cloud 대체 허용", "Jarvis Cloud fallback on")
              : t("설정한 모델 연결만 사용", "Configured connection only")}
          </button>
        </DialogTrigger>
      </div>
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader className="text-left">
          <DialogTitle>{t("Jarvis Cloud 대체 연결", "Jarvis Cloud fallback")}</DialogTitle>
          <DialogDescription className="break-keep">
            {t(
              "설정한 모델 연결에 실패하면 현재 요청과 최근 대화 메시지 최대 10개를 Jarvis Cloud로 보냅니다. 선택한 설정은 이 기기에서 보내는 새 요청에 적용됩니다.",
              "If your configured model fails, Jarvis Cloud can receive this request and up to ten recent text messages. Your choice applies to new requests on this device.",
            )}
          </DialogDescription>
        </DialogHeader>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 shrink-0 accent-foreground"
            checked={allowed} onChange={(event) => setAllowed(event.target.checked)} disabled={saving} />
          {t("Jarvis Cloud 대체 연결 허용", "Allow Jarvis Cloud fallback")}
        </label>
        {error && <p className="jarvis-auth-error" role="alert">
          {t("설정을 저장하지 못했습니다. 이 세션에서는 대체 연결이 꺼져 있습니다. 다시 저장해 주세요.",
            "Couldn’t save your choice. Fallback is off for this session. Try saving again.")}
        </p>}
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="ghost">{t("닫기", "Close")}</Button></DialogClose>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? t("저장 중…", "Saving…") : t("저장", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
