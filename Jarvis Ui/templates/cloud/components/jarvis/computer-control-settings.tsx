"use client";

import { useEffect, useState } from "react";
import { LaptopMinimalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useWorkspaceLocale } from "@/lib/workspace-language";

export function ComputerControlSettings({ enabled, onChange }: {
  enabled: boolean | null;
  onChange: (enabled: boolean) => void;
}) {
  const isKo = useWorkspaceLocale().startsWith("ko");
  const t = (ko: string, en: string) => isKo ? ko : en;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"read" | "write" | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const read = window.assistantAPI?.getComputerControl;
    if (!read) {
      setError("read");
      return;
    }
    void read().then(
      (current) => { if (active) onChange(current); },
      () => { if (active) setError("read"); },
    );
    return () => { active = false; };
  }, [onChange, readAttempt]);

  async function change() {
    const save = window.assistantAPI?.setComputerControl;
    if (busy || !save || enabled === null) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await save(!enabled));
      setOpen(false);
    } catch {
      setError("write");
    } finally {
      setBusy(false);
    }
  }

  const label = t("컴퓨터 제어", "Computer control");
  const status = enabled === null ? "…" : enabled ? t("켬", "On") : t("끔", "Off");
  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (busy) return;
      if (!next && error === "write") setError(null);
      setOpen(next);
    }}>
      <DialogTrigger asChild>
        <button type="button" className="jarvis-toolbar-link" aria-label={`${label} · ${status}`} title={label}>
          <LaptopMinimalIcon size={16} aria-hidden="true" />
          <span className="max-[540px]:sr-only">{label}</span>
          <span aria-hidden="true" className="text-muted-foreground">{status}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md" showCloseButton={false}>
        <DialogHeader className="text-left">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {t("켜면 Jarvis가 요청을 처리할 때 브라우저, 앱, 화면, 파일을 사용할 수 있습니다. 이 설정은 이 데스크톱 프로필에 저장됩니다.",
              "When enabled, Jarvis can use the browser, apps, screen and files for your requests. This choice is saved in this desktop profile.")}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm leading-6 text-foreground">
          {t("꺼진 상태에서도 대화, 직접 선택한 첨부 파일, 타이머와 메모를 사용할 수 있습니다.",
            "Chat, files you attach, timers and notes are available with computer control off.")}
        </p>
        {error && <p role="alert" className="jarvis-auth-error">
          {error === "read"
            ? t("설정을 불러오지 못했습니다.", "Couldn’t read the setting.")
            : t("변경 내용을 저장하지 못했습니다. 다시 시도하세요.", "Couldn’t save the change. Try again.")}
        </p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            {t("닫기", "Close")}
          </Button>
          {error === "read" ? (
            <Button type="button" onClick={() => {
              setError(null);
              setReadAttempt((attempt) => attempt + 1);
            }}>
              {t("다시 읽기", "Try again")}
            </Button>
          ) : (
            <Button type="button" disabled={busy || enabled === null} onClick={() => void change()}>
              {busy ? t("저장 중…", "Saving…") : enabled ? t("끄기", "Turn off") : t("허용", "Allow")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
