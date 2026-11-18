"use client";

import { DownloadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWorkspaceLocale } from "@/lib/workspace-language";

export type DesktopUpdateStatus = {
  state: "idle" | "disabled" | "checking" | "available" | "downloading" | "downloaded" | "error";
  enabled: boolean;
  checked?: boolean;
  mode: "native" | "installer" | "disabled";
  manualInstall?: boolean;
  version: string;
  availableVersion?: string;
  downloadedVersion?: string;
  progressPercent?: number;
};

export type DesktopUpdateResult = { ok: boolean; mode?: string; targetUrl?: string; targetPath?: string };

export function DesktopUpdateControl() {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const [version, setVersion] = useState("");
  const [desktop, setDesktop] = useState(false);
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<"check" | "install" | null>(null);
  const [notice, setNotice] = useState<"error" | "browser" | "installer" | "restart" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const operation = useRef<symbol | null>(null);
  const revision = useRef(0);

  function refresh() {
    const read = window.assistantAPI?.getAppState;
    if (!read) return;
    const request = ++revision.current;
    void read().then((state) => {
      if (request !== revision.current) return;
      setVersion(state.version);
      setStatus(state.updater);
    }).catch(() => {});
  }

  useEffect(() => {
    const api = window.assistantAPI;
    if (!api?.getAppState) return;
    setDesktop(true);
    const unsubscribe = api.onUpdateStatus?.((next) => {
      revision.current++;
      setStatus(next);
    });
    refresh();
    return () => {
      unsubscribe?.();
      revision.current++;
      operation.current = null;
    };
  }, []);

  if (!desktop) return null;
  const available = status?.state === "available" || status?.state === "downloaded";
  const busy = Boolean(pending || status?.state === "checking" || status?.state === "downloading" ||
    (status?.mode === "native" && status.state === "available"));
  const canInstall = available && (status?.mode === "installer" || status?.state === "downloaded");
  const newest = status?.downloadedVersion || status?.availableVersion;
  const percent = Math.min(100, Math.max(0, Math.round(status?.progressPercent || 0)));
  const installLabel = status?.manualInstall ? t("GitHub 릴리스 열기", "Open GitHub releases")
    : status?.mode === "native" ? t("재시작하여 설치", "Restart to install")
      : t("설치 프로그램 열기", "Open installer");
  const statusText: Record<DesktopUpdateStatus["state"], string> = {
    disabled: t("이 빌드에서는 업데이트를 확인할 수 없습니다.", "Update checks are unavailable in this build."),
    idle: status?.checked ? t("사용할 수 있는 새 버전이 없습니다.", "No newer compatible update found.")
      : t("업데이트를 확인할 수 있습니다.", "Ready to check for updates."),
    checking: t("업데이트 확인 중…", "Checking for updates…"),
    available: status?.mode === "native" ? t("다운로드를 준비하는 중…", "Preparing download…")
      : t("새 버전을 사용할 수 있습니다.", "A new version is available."),
    downloading: t("다운로드 중", "Downloading"),
    downloaded: t("업데이트 설치 준비가 완료되었습니다.", "The update is ready to install."),
    error: t("업데이트 중 오류가 발생했습니다. 다시 시도하세요.", "The update check or download failed. Try again."),
  };

  async function request(action: "check" | "install") {
    const api = window.assistantAPI;
    if (!api || operation.current || busy) return;
    const ticket = Symbol();
    const before = revision.current;
    operation.current = ticket;
    setPending(action);
    setNotice(null);
    try {
      if (action === "check") {
        const next = await api.checkForUpdates();
        if (operation.current === ticket && revision.current === before) setStatus(next);
        return;
      }
      const result = await api.installUpdate();
      if (operation.current === ticket) {
        setNotice(!result?.ok ? "error" : result.targetUrl ? "browser" : result.mode === "native" ? "restart" : "installer");
      }
    } catch {
      if (operation.current === ticket) {
        if (action === "install") setNotice("error");
        else if (revision.current === before) setStatus((current) => current && { ...current, state: "error" });
      }
    } finally {
      if (operation.current === ticket) {
        operation.current = null;
        setPending(null);
      }
    }
  }

  return <>
    <button ref={trigger} type="button" className="jarvis-sidebar-control" aria-haspopup="dialog"
      onClick={() => { setNotice(null); refresh(); setOpen(true); }}>
      <DownloadIcon className="size-4 shrink-0" aria-hidden="true" />
      <span>{t("업데이트", "Updates")}</span>
      {available && <span className="ml-auto text-xs text-muted-foreground">{t("새 버전", "New version")}</span>}
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        aria-describedby={undefined} onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}>
        <DialogHeader className="text-left"><DialogTitle>{t("업데이트", "Updates")}</DialogTitle></DialogHeader>
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt>{t("설치된 버전", "Installed version")}</dt>
            <dd className="tabular-nums text-muted-foreground">{status?.version || version || "—"}</dd>
          </div>
          {newest && (available || status?.state === "downloading") && <div className="flex justify-between gap-4">
            <dt>{t("새 버전", "New version")}</dt>
            <dd className="tabular-nums text-muted-foreground">{newest}</dd>
          </div>}
        </dl>
        <p role={status?.state === "error" ? "alert" : "status"} className="text-sm text-muted-foreground">
          {pending === "check" ? statusText.checking : statusText[status?.state ?? "disabled"]}
        </p>
        {status?.state === "downloading" && <progress className="h-2 w-full" value={percent || undefined} max={100}
          aria-label={t("다운로드 진행률", "Download progress")} />}
        {notice && <p role={notice === "error" ? "alert" : "status"} className="text-sm text-muted-foreground">
          {notice === "error" ? t("업데이트를 열 수 없습니다. 다시 시도하세요.", "Couldn’t open the update. Try again.")
            : notice === "browser" ? t("기본 브라우저에 릴리스 페이지 열기를 요청했습니다.", "Sent the releases page to your default browser.")
              : notice === "restart" ? t("앱에 재시작을 요청했습니다.", "Requested a restart.")
                : t("설치 프로그램 열기를 요청했습니다.", "Requested to open the installer.")}
        </p>}
        <DialogFooter>
          <Button type="button" variant={canInstall ? "outline" : "default"}
            disabled={!status?.enabled || busy} onClick={() => void request("check")}>
            {t("업데이트 확인", "Check for updates")}
          </Button>
          {canInstall && <Button type="button" disabled={busy} onClick={() => void request("install")}>{installLabel}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
