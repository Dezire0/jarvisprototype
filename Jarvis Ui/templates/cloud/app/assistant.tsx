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
import { ToolDirectory, toolName, type ToolId } from "@/components/jarvis/tool-directory";
import { LocalTools, TimerCompletionNotice, type ToolSection } from "@/components/jarvis/local-tools";
import { WeatherPanel } from "@/components/jarvis/weather-panel";
import { TextReview } from "@/components/jarvis/text-review";
import { FileSave } from "@/components/jarvis/file-save";
import { FolderBrowser } from "@/components/jarvis/folder-browser";
import { isFolderCommand } from "@/lib/folder-command";
import { AppPicker } from "@/components/jarvis/app-picker";
import { resolveAppPickerCommand } from "@/lib/app-picker-command";
import { SpotifyPanel } from "@/components/jarvis/spotify-panel";
import { resolveSpotifyCommand } from "@/lib/spotify-command";
import { GamesLibrary } from "@/components/jarvis/games-library";
import { resolveGameCommand, type GameView } from "@/lib/game-command";
import { ProjectCreation } from "@/components/jarvis/project-creation";
import { isProjectCommand } from "@/lib/project-command";
import { ObsControls } from "@/components/jarvis/obs-controls";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { resolveComposerCommand, runLocalCommand, type ComposerCommandHandler, type Result } from "@/lib/local-workspace";
import { speakLocalResult } from "@/lib/local-speech";
import { useLocalWorkspace } from "@/lib/use-local-workspace";
import { resolveScreenReviewCommand, type ScreenReviewMode } from "@/lib/screen-review";
import { resolveBrowserReviewCommand } from "@/lib/browser-review";
import { resolveFileSaveCommand, type FileSaveDraft } from "@/lib/file-save";
import { isObsCommand } from "@/lib/obs-commands";
import { useWorkspaceLocale } from "@/lib/workspace-language";
import { ChevronLeftIcon, WrenchIcon } from "lucide-react";
import { useAuiState } from "@assistant-ui/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { JarvisRuntimeProvider } from "./jarvis-runtime-provider";

export const Assistant = () => <JarvisRuntimeProvider><AssistantWorkspace /></JarvisRuntimeProvider>;

function AssistantWorkspace() {
  const threadId = useAuiState((state) => state.threadListItem.id);
  const [tools, setTools] = useState<({ fromDirectory?: true } & (
    { section: "index" } |
    { section: ToolSection } |
    { section: "screen" | "browser"; mode: ScreenReviewMode; threadId: string } |
    { section: "file-save"; draft: FileSaveDraft; threadId: string } |
    { section: "folder"; threadId: string } |
    { section: "obs" | "project-create" } |
    { section: "games"; initial: GameView; query?: string } |
    { section: "spotify" | "apps"; query?: string }
  )) | null>(null);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const lastTool = useRef<ToolId | null>(null);
  const toolContent = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
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
  const currentTool = tools?.section;
  const toolTitle = currentTool && currentTool !== "index" ? toolName(currentTool, isKo) : toolsLabel;

  useLayoutEffect(() => {
    if (toolContent.current) toolContent.current.scrollTop = 0;
    if (currentTool && currentTool !== "index") heading.current?.focus();
  }, [currentTool]);

  useEffect(() => {
    if ((tools?.section === "screen" || tools?.section === "browser" || tools?.section === "file-save" || tools?.section === "folder") && tools.threadId !== threadId) setTools(null);
  }, [tools, threadId]);

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
    lastTool.current = null;
    setDirectoryQuery("");
    setTools({ section: section ?? "index" });
  }

  function selectTool(section: ToolId) {
    lastTool.current = section;
    const fromDirectory = true as const;
    switch (section) {
      case "screen":
      case "browser":
        setTools({ section, mode: "read", threadId, fromDirectory });
        break;
      case "file-save":
        setTools({ section, draft: { path: "", content: "" }, threadId, fromDirectory });
        break;
      case "folder":
        setTools({ section, threadId, fromDirectory });
        break;
      case "games":
        setTools({ section, initial: "library", fromDirectory });
        break;
      default:
        setTools({ section, fromDirectory });
    }
  }

  const runComposerCommand: ComposerCommandHandler = (text, { hasAttachmentsOrQuote, allowSpeech }) => {
    if (isFolderCommand(text, hasAttachmentsOrQuote)) {
      localRun.current++;
      setLocalResult(null);
      toolsTrigger.current = inputRef.current;
      setTools({ section: "folder", threadId });
      return "local";
    }
    const appPickerCommand = resolveAppPickerCommand(text, hasAttachmentsOrQuote);
    if (appPickerCommand) {
      localRun.current++;
      setLocalResult(null);
      toolsTrigger.current = inputRef.current;
      setTools({ section: "apps", query: appPickerCommand.query });
      return "local";
    }
    const spotifyCommand = resolveSpotifyCommand(text, hasAttachmentsOrQuote);
    if (spotifyCommand) {
      localRun.current++;
      setLocalResult(null);
      toolsTrigger.current = inputRef.current;
      setTools({ section: "spotify", query: spotifyCommand.query });
      return "local";
    }
    const gameCommand = resolveGameCommand(text, hasAttachmentsOrQuote);
    if (gameCommand) {
      localRun.current++;
      setLocalResult(null);
      toolsTrigger.current = inputRef.current;
      setTools({ section: "games", initial: gameCommand.view, query: gameCommand.query });
      return "local";
    }
    if (isProjectCommand(text, hasAttachmentsOrQuote)) {
      localRun.current++;
      setLocalResult(null);
      toolsTrigger.current = inputRef.current;
      setTools({ section: "project-create" });
      return "local";
    }
    if (isObsCommand(text, hasAttachmentsOrQuote)) {
      localRun.current++;
      setLocalResult(null);
      toolsTrigger.current = inputRef.current;
      setTools({ section: "obs" });
      return "local";
    }
    const fileDraft = resolveFileSaveCommand(text, hasAttachmentsOrQuote);
    if (fileDraft) {
      localRun.current++;
      setLocalResult(null);
      toolsTrigger.current = inputRef.current;
      setTools({ section: "file-save", draft: fileDraft, threadId });
      return "local";
    }
    const browserMode = resolveBrowserReviewCommand(text, hasAttachmentsOrQuote);
    const mode = browserMode ?? resolveScreenReviewCommand(text, hasAttachmentsOrQuote);
    if (mode) {
      localRun.current++;
      setLocalResult(null);
      toolsTrigger.current = inputRef.current;
      setTools({ section: browserMode ? "browser" : "screen", mode, threadId });
      return "local";
    }
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
              ref={toolContent}
              aria-describedby={undefined}
              className="jarvis-tools-dialog block w-full gap-0 overflow-y-auto p-0 motion-reduce:animate-none sm:max-w-xl"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const trigger = toolsTrigger.current;
                if (trigger?.isConnected) trigger.focus();
                else inputRef.current?.focus();
              }}
            >
              <div className="jarvis-tools-titlebar">
                {tools?.fromDirectory && (
                  <button type="button" className="jarvis-icon-button"
                    aria-label={isKo ? "로컬 도구로 돌아가기" : "Back to local tools"}
                    onClick={() => setTools({ section: "index" })}>
                    <ChevronLeftIcon size={18} aria-hidden="true" />
                  </button>
                )}
                <DialogTitle ref={heading} tabIndex={-1} className="jarvis-tools-dialog-title">{toolTitle}</DialogTitle>
              </div>
              {tools?.section === "index" && <ToolDirectory query={directoryQuery} onQueryChange={setDirectoryQuery}
                lastTool={lastTool.current} computerControl={computerControl} onSelect={selectTool} />}
              {tools?.section === "weather" && <WeatherPanel inDialog canUseBrowserLocation={!local.nativeStorage} />}
              {(tools?.section === "screen" || tools?.section === "browser") && tools.threadId === threadId && (
                <TextReview key={tools.section} source={tools.section} mode={tools.mode} computerControl={computerControl} onAttached={() => {
                  toolsTrigger.current = inputRef.current;
                  setTools(null);
                }} />
              )}
              {tools?.section === "file-save" && tools.threadId === threadId && (
                <FileSave initial={tools.draft} computerControl={computerControl} onSaved={(path) => {
                  localRun.current++;
                  setLocalResult({ title: isKo ? "파일을 저장했습니다." : "File saved.", detail: path });
                  toolsTrigger.current = inputRef.current;
                  setTools(null);
                }} />
              )}
              {tools?.section === "folder" && tools.threadId === threadId && <FolderBrowser computerControl={computerControl} />}
              {tools?.section === "apps" && <AppPicker initialQuery={tools.query} computerControl={computerControl} />}
              {tools?.section === "spotify" && <SpotifyPanel initialQuery={tools.query} computerControl={computerControl} />}
              {tools?.section === "games" && <GamesLibrary initial={tools.initial} initialQuery={tools.query} computerControl={computerControl} />}
              {tools?.section === "project-create" && <ProjectCreation computerControl={computerControl} />}
              {tools?.section === "obs" && <ObsControls computerControl={computerControl} />}
              {tools && (tools.section === "timer" || tools.section === "tasks" || tools.section === "notes" ||
                tools.section === "command" || tools.section === "diagnostics" || tools.section === "activity") && (
                <LocalTools key={tools.section} local={local} embedded initialSection={tools.section} />
              )}
            </DialogContent>
          </Dialog>
        </JarvisVoiceProvider>
      </SidebarProvider>
    </JarvisExtensionsProvider>
  );
}
