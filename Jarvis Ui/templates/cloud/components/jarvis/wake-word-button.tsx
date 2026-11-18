"use client";

import { EarIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useJarvisVoice } from "@/components/jarvis/voice-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getRecognitionConstructor, installWakeLanguage, localWakeAvailability, type WakeAvailability, type WakeEngine } from "@/lib/wake-word";
import { useWorkspaceLocale } from "@/lib/workspace-language";

export function WakeWordButton() {
  const voice = useJarvisVoice();
  const locale = useWorkspaceLocale();
  const ko = locale.startsWith("ko");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const active = Boolean(voice.wakeEngine);
  const title = ko ? "호출어" : "Wake word";
  const label = active ? (ko ? "호출어 듣기 중지" : "Stop wake word") : title;

  return <>
    <TooltipIconButton ref={trigger} type="button" variant="ghost" side="bottom"
      className={cn("jarvis-icon-button", active && "jarvis-icon-active")}
      aria-label={label} aria-pressed={active} aria-haspopup={active ? undefined : "dialog"} tooltip={label}
      onClick={() => { if (active) voice.stop(); else setOpen(true); }}>
      <EarIcon className="size-4" aria-hidden="true" />
    </TooltipIconButton>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        showCloseButton={false} onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}>
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {ko ? "“자비스”라고 부른 뒤 명령을 말하세요. 대화를 나가면 듣기가 멈춥니다."
              : "Say “Jarvis” before your command. Listening stops when you leave this conversation."}
          </DialogDescription>
        </DialogHeader>
        <WakeRecognitionChoices key={locale} locale={locale} start={(engine) => {
          setOpen(false);
          voice.armWake(engine);
        }} />
        <DialogFooter><DialogClose asChild>
          <Button type="button" variant="ghost">{ko ? "닫기" : "Close"}</Button>
        </DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function WakeRecognitionChoices({ locale, start }: { locale: string; start: (engine: WakeEngine) => void }) {
  const ko = locale.startsWith("ko");
  const [availability, setAvailability] = useState<WakeAvailability | "checking">("checking");
  const [installFailed, setInstallFailed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const canUseBrowser = Boolean(getRecognitionConstructor());
  useEffect(() => {
    let current = true;
    void localWakeAvailability(locale).then((state) => { if (current) setAvailability(state); });
    return () => { current = false; };
  }, [locale]);
  const localStatus = availability === "checking" ? (ko ? "기기 인식을 확인하는 중…" : "Checking on-device recognition…")
    : availability === "downloading" ? (ko ? "언어 팩을 준비 중입니다." : "The language pack is being prepared.")
      : availability === "unavailable" ? (ko ? "이 환경에서는 기기 인식을 사용할 수 없습니다." : "On-device recognition is unavailable here.")
        : "";

  async function installLanguage() {
    setInstalling(true);
    setInstallFailed(false);
    const installed = await installWakeLanguage(locale);
    setInstallFailed(!installed);
    setAvailability(await localWakeAvailability(locale));
    setInstalling(false);
  }

  return <div className="grid gap-4 text-sm">
    <div className="grid gap-2">
      {localStatus && <p role="status" className="text-muted-foreground">{localStatus}</p>}
      {availability === "available" && <Button type="button" onClick={() => start("device")}>
        {ko ? "기기에서 듣기 시작" : "Start on-device listening"}
      </Button>}
      {availability === "downloadable" && <Button type="button" variant="outline"
        disabled={installing} onClick={() => void installLanguage()}>
        {installing ? (ko ? "언어 팩을 준비하는 중…" : "Preparing language pack…")
          : (ko ? "기기 인식 언어 팩 받기" : "Download on-device language pack")}
      </Button>}
      {availability === "downloading" && <Button type="button" variant="outline" onClick={() => {
        void localWakeAvailability(locale).then(setAvailability);
      }}>
        {ko ? "언어 팩 상태 확인" : "Check language pack"}
      </Button>}
      {installFailed && <p role="alert" className="text-muted-foreground">
        {ko ? "언어 팩을 준비하지 못했습니다." : "Couldn’t prepare the language pack."}
      </p>}
    </div>
    <div className="grid gap-2 border-t border-border pt-3">
      {canUseBrowser ? <>
        <p className="text-muted-foreground">
          {ko ? "브라우저 인식은 듣는 동안 마이크 음성을 브라우저의 인식 서비스로 보낼 수 있습니다."
            : "Browser recognition may send microphone audio to its speech service while listening."}
        </p>
        <Button type="button" variant="outline" onClick={() => start("browser")}>
          {ko ? "브라우저 인식으로 듣기 시작" : "Start with browser recognition"}
        </Button>
      </> : <p role="status" className="text-muted-foreground">
        {ko ? "이 환경에서는 브라우저 음성 인식을 사용할 수 없습니다." : "Browser speech recognition is unavailable here."}
      </p>}
    </div>
  </div>;
}
