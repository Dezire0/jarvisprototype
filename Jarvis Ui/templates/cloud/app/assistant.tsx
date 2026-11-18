"use client";

import { Thread } from "@/components/assistant-ui/thread";
import {
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { JarvisExtensionsProvider } from "@/components/jarvis/extensions-provider";
import { JarvisVoiceProvider } from "@/components/jarvis/voice-provider";
import { ComputerControlSettings } from "@/components/jarvis/computer-control-settings";
import { ModelSettings, MODEL_SETTINGS_SAVED, type ModelAvailability } from "@/components/jarvis/model-settings";
import { ThemeToggle } from "@/components/jarvis/theme-toggle";
import { LocalTools, TimerCompletionNotice, type ToolSection } from "@/components/jarvis/local-tools";
import { WeatherPanel } from "@/components/jarvis/weather-panel";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { resolveComposerCommand, runLocalCommand, type ComposerCommandHandler, type Result } from "@/lib/local-workspace";
import { speakLocalResult } from "@/lib/local-speech";
import { useLocalWorkspace } from "@/lib/use-local-workspace";
import { useWorkspaceLocale } from "@/lib/workspace-language";
import { WrenchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { JarvisRuntimeProvider } from "./jarvis-runtime-provider";

export const Assistant = () => <JarvisRuntimeProvider><AssistantWorkspace /></JarvisRuntimeProvider>;

function AssistantWorkspace() {
  const [tools, setTools] = useState<{ section?: ToolSection } | null>(null);
  const [computerControl, setComputerControl] = useState<boolean | null>(null);
  const [modelSettingsAvailable, setModelSettingsAvailable] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelAvailability, setModelAvailability] = useState<ModelAvailability | null>(null);
  const modelSettingsTrigger = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [localResult, setLocalResult] = useState<(Result & { timerDeadline?: number }) | null>(null);
  const toolsTrigger = useRef<HTMLElement | null>(null);
  const localRun = useRef(0);
  const local = useLocalWorkspace();
  const locale = useWorkspaceLocale();
  const isKo = locale.startsWith("ko");
  const toolsLabel = isKo ? "로컬 도구" : "Local tools";
  const weatherOpen = tools?.section === "weather";

  useEffect(() => {
    const read = window.assistantAPI?.getConversationModelSettings;
    setModelSettingsAvailable(Boolean(read));
    if (!read) return;

    let request = 0;
    const refresh = () => {
      const current = ++request;
      void read().then(({ availability }) => {
        if (current === request) setModelAvailability(availability);
      }).catch(() => {
        if (current === request) setModelAvailability(null);
      });
    };

    refresh();
    window.addEventListener(MODEL_SETTINGS_SAVED, refresh);
    return () => {
      request++;
      window.removeEventListener(MODEL_SETTINGS_SAVED, refresh);
    };
  }, [computerControl]);

  function openModelSettings(trigger: HTMLButtonElement) {
    modelSettingsTrigger.current = trigger;
    setModelSettingsOpen(true);
  }

  const modelSettingsAction = modelSettingsAvailable ? openModelSettings : undefined;

  function openTools(section: ToolSection | undefined, trigger: HTMLElement | null) {
    toolsTrigger.current = trigger;
    setTools({ section });
  }

  const runComposerCommand: ComposerCommandHandler = (text, { hasAttachmentsOrQuote, allowSpeech }) => {
    const command = resolveComposerCommand(text, hasAttachmentsOrQuote);
    if (!command) return "chat";
    const run = ++localRun.current;
    if (command.kind === "weather") {
      setLocalResult(null);
      openTools("weather", inputRef.current);
      return "local";
    }
    if (!local.workspaceReady) {
      setLocalResult({
        title: isKo ? "로컬 도구를 불러오는 중입니다." : "Local tools are still loading.",
        detail: isKo ? "잠시 후 다시 실행하세요." : "Try again in a moment.",
        failed: true,
      });
      return "retry";
    }

    const current = local.latestWorkspace();
    const { workspace, result } = runLocalCommand(command, current, Date.now(), crypto.randomUUID(), locale);
    const isTimerStart = command.kind === "timer" || command.kind === "resume";
    function finish(saved: boolean) {
      if (run !== localRun.current) return;
      const outcome = saved ? result : {
        title: isKo ? "기기에 저장하지 못했습니다" : "Couldn’t save on this device",
        detail: result.detail,
        failed: true,
      };
      const timerDeadline = saved && !result.failed && isTimerStart
        ? workspace.timer.endsAt ?? undefined
        : undefined;
      setLocalResult({ ...outcome, timerDeadline });
      if (saved && allowSpeech && workspace.speakResults && !result.failed) speakLocalResult(result.title, locale);
    }

    if (workspace === current) {
      finish(true);
    } else {
      setLocalResult({ title: isKo ? "기기에 저장하는 중…" : "Saving on this device…" });
      void local.saveWorkspace(workspace, current).then(finish);
    }
    return "local";
  };

  function dismissLocalResult() {
    localRun.current++;
    setLocalResult(null);
  }

  return (
    <JarvisExtensionsProvider>
      <SidebarProvider defaultOpen={false}>
        <JarvisVoiceProvider runLocalCommand={runComposerCommand}>
          <div className="aui-app-shell flex h-dvh w-full bg-background text-foreground">
            <ThreadListSidebar computerControlEnabled={computerControl === true} onOpenModelSettings={modelSettingsAction} />
            <main className="aui-app-main relative flex min-w-0 flex-1 flex-col">
              <header className="jarvis-toolbar">
                <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger className="jarvis-icon-button" aria-label={isKo ? "사이드바 열기 또는 닫기" : "Toggle sidebar"} />
                  <span className="truncate font-semibold">Jarvis</span>
                </div>
                <div className="flex items-center gap-1">
                  <ComputerControlSettings enabled={computerControl} onChange={setComputerControl} />
                  <button type="button" className="jarvis-toolbar-link" aria-haspopup="dialog"
                    onClick={(event) => openTools(undefined, event.currentTarget)}>
                    <WrenchIcon size={16} aria-hidden="true" />
                    {toolsLabel}
                  </button>
                  <ThemeToggle />
                </div>
              </header>
              {tools === null && local.workspace.timer.completedAt !== undefined && (
                <TimerCompletionNotice onOpen={(trigger) => openTools("timer", trigger)} />
              )}
              <div className="min-h-0 flex-1 overflow-hidden">
                <Thread
                  onOpenTools={openTools}
                  onOpenModelSettings={modelSettingsAction}
                  modelAvailability={modelAvailability}
                  inputRef={inputRef}
                  runLocalCommand={runComposerCommand}
                  localResult={localResult?.timerDeadline !== undefined && localResult.timerDeadline !== local.workspace.timer.endsAt
                    ? null
                    : localResult}
                  dismissLocalResult={dismissLocalResult}
                />
              </div>
            </main>
          </div>
          <ModelSettings open={modelSettingsOpen} onOpenChange={setModelSettingsOpen}
            restoreFocus={() => {
              const trigger = modelSettingsTrigger.current;
              if (trigger?.isConnected) trigger.focus();
              else inputRef.current?.focus();
            }} />
          <Dialog open={tools !== null} onOpenChange={(open) => { if (!open) setTools(null); }}>
            <DialogContent
              aria-describedby={undefined}
              className="jarvis-tools-dialog block w-full gap-0 overflow-y-auto p-0 motion-reduce:animate-none sm:max-w-xl"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const trigger = toolsTrigger.current;
                if (trigger?.isConnected) trigger.focus();
                else inputRef.current?.focus();
              }}
            >
              <DialogTitle className="jarvis-tools-dialog-title">
                {weatherOpen ? (isKo ? "날씨" : "Weather") : toolsLabel}
              </DialogTitle>
              {tools && (tools.section === "weather"
                ? <WeatherPanel inDialog canUseBrowserLocation={!local.nativeStorage} />
                : <LocalTools local={local} embedded initialSection={tools.section} />)}
            </DialogContent>
          </Dialog>
        </JarvisVoiceProvider>
      </SidebarProvider>
    </JarvisExtensionsProvider>
  );
}
