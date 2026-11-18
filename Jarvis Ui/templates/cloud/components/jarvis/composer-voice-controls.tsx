"use client";

import { ChevronDownIcon, MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useJarvisVoice } from "@/components/jarvis/voice-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { macWakeAvailability } from "@/lib/mac-wake-speech";
import { getRecognitionConstructor, installWakeLanguage, localWakeAvailability, type WakeAvailability, type WakeEngine } from "@/lib/wake-word";
import { useWorkspaceLocale } from "@/lib/workspace-language";

export function ComposerVoiceControls() {
  const voice = useJarvisVoice();
  const locale = useWorkspaceLocale();
  const ko = locale.startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const [open, setOpen] = useState(false);
  const [showWake, setShowWake] = useState(false);
  const wakePanel = useId();
  const mic = useRef<HTMLButtonElement>(null);
  const focusMicOnClose = useRef(false);
  const wakeActive = Boolean(voice.wakeEngine);
  const active = wakeActive || voice.continuous ||
    voice.status === "starting" || voice.status === "listening" || voice.status === "processing";
  const wakeStop = t("호출어 듣기 중지", "Stop wake word");
  const continuousLabel = voice.continuous
    ? t("연속 듣기 중지", "Stop continuous voice")
    : t("연속 듣기 시작", "Start continuous voice");
  const label = wakeActive ? wakeStop
    : voice.continuous ? continuousLabel
      : active ? t("음성 입력 중지", "Stop voice input")
        : t("음성 입력 시작", "Start voice input");
  const title = t("음성 옵션", "Voice options");

  function applyMode(action: () => void) {
    focusMicOnClose.current = true;
    action();
    setOpen(false);
  }

  return <div className="jarvis-voice-controls">
    <TooltipIconButton ref={mic} type="button" variant="ghost" side="bottom"
      className={cn("jarvis-icon-button", active && "jarvis-icon-active")}
      aria-label={label} aria-pressed={active} tooltip={label}
      disabled={!voice.supported && !active}
      onClick={active ? voice.stop : voice.startOnce}>
      {active ? <SquareIcon className="size-3 fill-current" aria-hidden="true" />
        : <MicIcon className="size-4" aria-hidden="true" />}
    </TooltipIconButton>
    <Dialog open={open} onOpenChange={(next) => {
      if (next) setShowWake(false);
      setOpen(next);
    }}>
      <DialogTrigger asChild>
        <TooltipIconButton type="button" variant="ghost" side="bottom" className="jarvis-icon-button jarvis-voice-options"
          aria-label={title} tooltip={title}>
          <ChevronDownIcon className="size-4" aria-hidden="true" />
        </TooltipIconButton>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto motion-reduce:animate-none sm:max-w-sm"
        showCloseButton={false} onCloseAutoFocus={(event) => {
          if (focusMicOnClose.current && mic.current && !mic.current.disabled) {
            event.preventDefault();
            mic.current.focus();
          }
          focusMicOnClose.current = false;
        }}>
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("현재 대화에서만 듣습니다.", "Listening stops when you leave this conversation.")}</DialogDescription>
        </DialogHeader>
        <div className="jarvis-voice-mode">
          <h3>{t("연속 듣기", "Continuous voice")}</h3>
          <p>{t("보낸 명령의 응답을 마치면 다시 듣습니다.", "Listen again after each reply.")}</p>
          <Button type="button" variant="outline" disabled={!voice.supported && !voice.continuous}
            onClick={() => applyMode(voice.toggleContinuous)}>{continuousLabel}</Button>
        </div>
        <div className="jarvis-voice-mode">
          <h3>{t("호출어", "Wake word")}</h3>
          <p>{t("“자비스”라고 부른 뒤 명령을 말하세요.", "Say “Jarvis” before your command.")}</p>
          {wakeActive ? (
            <Button type="button" variant="outline" onClick={() => applyMode(voice.stop)}>{wakeStop}</Button>
          ) : (
            <Button type="button" variant="outline" aria-expanded={showWake} aria-controls={wakePanel}
              onClick={() => setShowWake((shown) => !shown)}>{t("호출어 인식 방식 선택", "Choose wake recognition")}</Button>
          )}
          <div id={wakePanel} hidden={!showWake || wakeActive}>
            {showWake && !wakeActive && <WakeRecognitionChoices key={locale} locale={locale}
              start={(engine) => applyMode(() => voice.armWake(engine))} />}
          </div>
        </div>
        <DialogFooter><DialogClose asChild>
          <Button type="button" variant="ghost">{t("닫기", "Close")}</Button>
        </DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function WakeRecognitionChoices({ locale, start }: { locale: string; start: (engine: WakeEngine) => void }) {
  const ko = locale.startsWith("ko");
  const [availability, setAvailability] = useState<WakeAvailability | "checking">("checking");
  const [macAvailable, setMacAvailable] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const canUseBrowser = Boolean(getRecognitionConstructor());
  useEffect(() => {
    let current = true;
    void Promise.all([macWakeAvailability(locale), localWakeAvailability(locale)]).then(([mac, state]) => {
      if (current) {
        setMacAvailable(mac);
        setAvailability(state);
      }
    });
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
      {!macAvailable && localStatus && <p role="status" className="text-muted-foreground">{localStatus}</p>}
      {macAvailable && <Button type="button" onClick={() => start("mac")}>
        {ko ? "이 Mac에서 듣기 시작" : "Start listening on this Mac"}
      </Button>}
      {!macAvailable && availability === "available" && <Button type="button" onClick={() => start("device")}>
        {ko ? "기기에서 듣기 시작" : "Start on-device listening"}
      </Button>}
      {!macAvailable && availability === "downloadable" && <Button type="button" variant="outline"
        disabled={installing} onClick={() => void installLanguage()}>
        {installing ? (ko ? "언어 팩을 준비하는 중…" : "Preparing language pack…")
          : (ko ? "기기 인식 언어 팩 받기" : "Download on-device language pack")}
      </Button>}
      {!macAvailable && availability === "downloading" && <Button type="button" variant="outline" onClick={() => {
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
