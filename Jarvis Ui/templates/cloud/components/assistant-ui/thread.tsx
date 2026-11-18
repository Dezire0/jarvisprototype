import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { useWorkspaceLocale } from "@/lib/workspace-language";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Reasoning } from "@/components/assistant-ui/reasoning";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import type { ModelAvailability } from "@/components/jarvis/model-settings";
import type { ToolSection } from "@/components/jarvis/local-tools";
import { useJarvisVoice } from "@/components/jarvis/voice-provider";
import { ComposerVoiceControls } from "@/components/jarvis/composer-voice-controls";
import { VoicePlaybackStatus, useVoiceOutput } from "@/components/jarvis/voice-output-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { voiceEngine, voiceEngineName, voiceLanguage, voiceTextLimit } from "@/lib/voice-output";
import { formatMemorySources } from "@/lib/chat-memory";
import { actionLabels, actionStatuses, type ExecutionRecord } from "@/lib/execution-record";
import { resolveScreenReviewCommand } from "@/lib/screen-review";
import { resolveBrowserReviewCommand } from "@/lib/browser-review";
import { resolveFileSaveCommand } from "@/lib/file-save";
import { isFolderCommand } from "@/lib/folder-command";
import { resolveAppPickerCommand } from "@/lib/app-picker-command";
import { resolveSpotifyCommand } from "@/lib/spotify-command";
import { resolveGameCommand } from "@/lib/game-command";
import { isProjectCommand } from "@/lib/project-command";
import { isObsCommand } from "@/lib/obs-commands";
import { LOCAL_COMMAND_EXAMPLE, resolveComposerCommand, type ComposerCommandHandler, type Result } from "@/lib/local-workspace";
import { useChatHistoryError, useJarvisAttachmentError, useJarvisTransportNotice, useTemporaryChat } from "@/app/jarvis-runtime-provider";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import * as Avatar from "@radix-ui/react-avatar";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  ListTodoIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  StickyNoteIcon,
  Volume2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type FC, type FormEvent, type Ref, type RefObject } from "react";



type CredentialPromptDetails = {
  kind?: string;
  site?: string;
  siteOrUrl?: string;
  loginUrl?: string;
  language?: string;
  askToSave?: boolean;
  submitDefault?: boolean;
};

type VerificationPromptDetails = {
  kind?: "captcha" | "verification" | string;
  site?: string;
  url?: string;
  language?: string;
  submitDefault?: boolean;
};

type SensitiveConfirmationDetails = {
  reason?: string;
  message?: string;
  targetLabel?: string;
};

type LocalFilePreview = { name: string; text: string; truncated: boolean };
type AssistantResultDetails = {
  filePreview?: LocalFilePreview | null;
  credentialPrompt?: CredentialPromptDetails | null;
  verificationPrompt?: VerificationPromptDetails | null;
  sensitiveConfirmation?: SensitiveConfirmationDetails | null;
  progressLabel?: string | null;
  progressSteps?: string[] | null;
  livePreview?: boolean | null;
  executorLabel?: string | null;
  executorMode?: string | null;
};

type LivePreviewSnapshot = {
  source?: string;
  imageDataUrl?: string;
  title?: string;
  url?: string;
};

function useKorean(language?: string) {
  const locale = useWorkspaceLocale();
  return language === "ko" || (language !== "en" && locale.startsWith("ko"));
}

type OpenModelSettings = (trigger: HTMLButtonElement) => void;

export const Thread: FC<{
  onOpenTools: (section: ToolSection, trigger: HTMLButtonElement) => void;
  onOpenModelSettings?: OpenModelSettings;
  modelAvailability: ModelAvailability | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  runLocalCommand: ComposerCommandHandler;
  localResult: Result | null;
  dismissLocalResult: () => void;
}> = ({ onOpenTools, onOpenModelSettings, modelAvailability, inputRef, runLocalCommand, localResult, dismissLocalResult }) => {
  const aui = useAui();
  const isEmpty = useAuiState((state) => state.thread.isEmpty);
  const hasDraft = useAuiState((state) => {
    const { text, attachments, quote } = state.thread.composer;
    return Boolean(text || attachments.length || quote);
  });
  const historyError = useChatHistoryError();
  const temporary = useTemporaryChat();
  const isKo = useKorean();
  const example = LOCAL_COMMAND_EXAMPLE[isKo ? "ko" : "en"];
  const modelHint = modelAvailability === "missing"
    ? (isKo ? "대화에 사용할 모델을 설정하세요." : "Choose a model for conversations.")
    : modelAvailability === "partial"
      ? (isKo ? "일부 대화 모델에 설정이 필요합니다." : "Some conversations still need a model configured.")
      : modelAvailability === "computer-control"
        ? (isKo ? "CLI 모델은 컴퓨터 제어가 필요합니다." : "CLI models require computer control.")
        : null;

  function fillExample() {
    const composer = aui.thread().composer();
    const { text, attachments, quote } = composer.getState();
    if (text || attachments.length || quote) return;
    composer.setText(example);
    inputRef.current?.focus();
  }


  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full min-h-0 flex-col"
      style={{ "--thread-max-width": "46rem" } as React.CSSProperties}
    >
      {temporary && (
        <div role="status" className="mx-auto w-full max-w-(--thread-max-width) px-4 py-3 text-sm">
          <p className="font-medium">{isKo ? "임시 채팅" : "Temporary chat"}</p>
          <p className="text-muted-foreground">
            {isKo
              ? "이 대화는 기록에 저장되지 않으며 이전 대화의 기억을 사용하지 않습니다."
              : "Jarvis won’t save this chat or use memory from other conversations."}
          </p>
        </div>
      )}
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-empty={isEmpty}
        className="jarvis-thread-viewport flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        <AuiIf condition={(state) => state.thread.isEmpty}>
          <div className="jarvis-start mx-auto w-full max-w-(--thread-max-width)">
            <h1>{isKo ? "무엇을 할까요?" : "What would you like to do?"}</h1>
          </div>
        </AuiIf>
        <ThreadPrimitive.Messages>
          {() => <ThreadMessage onOpenModelSettings={onOpenModelSettings} />}
        </ThreadPrimitive.Messages>
        <ThreadPrimitive.ViewportFooter
          data-empty={isEmpty}
          className="jarvis-composer-dock mx-auto w-full max-w-(--thread-max-width)"
        >
          {!isEmpty && <ThreadScrollToBottom />}
          <Composer runLocalCommand={runLocalCommand} inputRef={inputRef} />
          {historyError && !temporary && <p role="alert" className="jarvis-auth-error mt-2">
            {isKo ? "기기의 대화 기록에 접근하지 못했습니다. 현재 대화에서 필요한 내용을 복사하세요."
              : "Conversation history is unavailable on this device. Copy anything you need from this conversation."}
          </p>}
          {localResult && (
            <div className="jarvis-local-result" data-error={localResult.failed || undefined}>
              <div role={localResult.failed ? "alert" : "status"}>
                <p className="font-semibold">{localResult.title}</p>
                {localResult.detail && <p className="jarvis-result-detail">{localResult.detail}</p>}
              </div>
              <button type="button" className="jarvis-icon-button" onClick={dismissLocalResult}
                aria-label={isKo ? "로컬 실행 결과 닫기" : "Dismiss local result"}>
                <XIcon size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          <TransportFeedback focusInput={() => inputRef.current?.focus()} />
          {isEmpty && modelHint && onOpenModelSettings && (
            <div className="jarvis-start-model">
              <p role="status" className="text-muted-foreground">{modelHint}</p>
              <ModelSettingsLink onOpen={onOpenModelSettings} />
            </div>
          )}
          {isEmpty && (
            <div className="jarvis-start-actions items-center" role="group" aria-label={isKo ? "로컬 도구" : "Local tools"}>
              <button type="button" className="jarvis-secondary-button" aria-haspopup="dialog"
                onClick={(event) => onOpenTools("timer", event.currentTarget)}>
                <ClockIcon size={16} aria-hidden="true" />{isKo ? "타이머" : "Timer"}
              </button>
              <button type="button" className="jarvis-secondary-button" aria-haspopup="dialog"
                onClick={(event) => onOpenTools("tasks", event.currentTarget)}>
                <ListTodoIcon size={16} aria-hidden="true" />{isKo ? "할 일" : "Tasks"}
              </button>
              <button type="button" className="jarvis-secondary-button" aria-haspopup="dialog"
                onClick={(event) => onOpenTools("notes", event.currentTarget)}>
                <StickyNoteIcon size={16} aria-hidden="true" />{isKo ? "메모" : "Notes"}
              </button>
              {!hasDraft && (
                <button type="button" className="jarvis-start-link jarvis-start-example" onClick={fillExample}>
                  <span className="text-muted-foreground">{isKo ? "로컬 명령 예시" : "Example local command"}</span>
                  <span className="jarvis-start-link-text">{example}</span>
                </button>
              )}
            </div>
          )}
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

function ModelSettingsLink({ onOpen }: { onOpen: OpenModelSettings }) {
  const isKo = useKorean();
  return (
    <button type="button" className="jarvis-start-link jarvis-start-link-text" aria-haspopup="dialog"
      onClick={(event) => onOpen(event.currentTarget)}>
      {isKo ? "모델 설정" : "Model settings"}
    </button>
  );
}

function TransportFeedback({ focusInput }: { focusInput: () => void }) {
  const { notice, dismiss } = useJarvisTransportNotice();
  const aui = useAui();
  const input = useAuiState((state) => state.thread.composer.text);
  const busyDraft = useAuiState((state) => Boolean(state.thread.composer.attachments.length || state.thread.composer.quote));
  const isKo = useKorean();
  if (!notice) return null;

  const titles = {
    cancelled: isKo ? "응답을 중지했습니다." : "Response stopped.",
    "attachment-invalid": isKo ? "첨부 파일을 보내지 못했습니다." : "Couldn’t send the attachment.",
    "message-too-large": isKo ? "메시지 크기 제한을 초과했습니다." : "This message is too large.",
    "transport-unavailable": isKo ? "어시스턴트 응답을 받지 못했습니다." : "Couldn’t reach the assistant or finish its reply.",
  };
  const showRestore = Boolean(notice.text && notice.text !== input);
  const occupied = Boolean(input.trim()) || busyDraft;

  return (
    <div className="jarvis-local-result" data-error={notice.kind !== "cancelled" || undefined}>
      <div>
        <div role={notice.kind === "cancelled" ? "status" : "alert"}>
          <p className="font-semibold">{titles[notice.kind]}</p>
          {notice.hadAttachments && <p className="jarvis-result-detail">
            {isKo ? "다시 보내려면 첨부 파일을 선택하세요." : "Select the files again before sending."}
          </p>}
          {showRestore && occupied && <p className="jarvis-result-detail">
            {isKo ? "현재 입력을 비우면 보냈던 문장을 복원할 수 있습니다." : "Clear the current draft to restore the earlier message."}
          </p>}
        </div>
        {showRestore && <button type="button" className="jarvis-composer-alternate mt-2" disabled={occupied}
          onClick={() => {
            const composer = aui.thread().composer();
            const draft = composer.getState();
            if (draft.text.trim() || draft.attachments.length || draft.quote) return;
            composer.setText(notice.text);
            focusInput();
          }}>
          {isKo ? "초안 복원" : "Restore draft"}
        </button>}
      </div>
      <button type="button" className="jarvis-icon-button" onClick={dismiss}
        aria-label={isKo ? "전송 상태 닫기" : "Dismiss delivery status"}>
        <XIcon size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

const ThreadMessage: FC<{ onOpenModelSettings?: OpenModelSettings }> = ({ onOpenModelSettings }) => {
  const role = useAuiState((state) => state.message.role);
  const isEditing = useAuiState((state) => state.message.composer.isEditing);

  if (isEditing) {
    return <EditComposer />;
  }

  if (role === "user") {
    return <UserMessage />;
  }

  return <AssistantMessage onOpenModelSettings={onOpenModelSettings} />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full border-border/70 bg-card/90 p-4 text-foreground shadow-lg backdrop-blur disabled:invisible dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const Composer: FC<{
  runLocalCommand: ComposerCommandHandler;
  inputRef: Ref<HTMLTextAreaElement>;
}> = ({ runLocalCommand, inputRef }) => {
  const aui = useAui();
  const text = useAuiState((state) => state.composer.text);
  const { error: fileError, clear: clearFileError } = useJarvisAttachmentError();
  const hasFiles = useAuiState((state) => state.composer.attachments.length > 0);
  const hasPdf = useAuiState((state) => state.composer.attachments.some((file) => file.type === "pdf"));
  const fileLoading = useAuiState((state) => state.composer.attachments.some((file) => file.status.type === "running"));
  const fileUnreadable = useAuiState((state) => state.composer.attachments.some((file) => file.status.type === "incomplete"));
  const hasAttachmentsOrQuote = useAuiState((state) => Boolean(
    state.composer.attachments.length || state.composer.quote,
  ));
  const localCommand = resolveComposerCommand(text, hasAttachmentsOrQuote) ||
    resolveScreenReviewCommand(text, hasAttachmentsOrQuote) ||
    resolveBrowserReviewCommand(text, hasAttachmentsOrQuote) ||
    resolveFileSaveCommand(text, hasAttachmentsOrQuote) ||
    isFolderCommand(text, hasAttachmentsOrQuote) ||
    resolveAppPickerCommand(text, hasAttachmentsOrQuote) ||
    resolveSpotifyCommand(text, hasAttachmentsOrQuote) ||
    resolveGameCommand(text, hasAttachmentsOrQuote) ||
    isObsCommand(text, hasAttachmentsOrQuote) || isProjectCommand(text, hasAttachmentsOrQuote);
  const {
    status,
    transcript,
    error,
    reviewPending,
    continuous,
    wakeEngine,
    awaitingWakeCommand,
    waitingForReplyAudio,
  } = useJarvisVoice();

  const isKo = useKorean();
  const fileIssues = {
    format: isKo ? "텍스트 문서, PDF, PNG·JPEG·WebP 이미지를 첨부할 수 있습니다."
      : "Attach a text document, a PDF, or a PNG, JPEG, or WebP image.",
    limit: isKo ? "파일은 한 번에 4개, 총 4MiB까지 첨부할 수 있습니다. 이미지 한도는 2MiB, 텍스트 파일 한도는 64KiB입니다."
      : "Attach up to 4 files and 4 MiB total. Image files can be up to 2 MiB and text files up to 64 KiB.",
    read: isKo ? "파일을 읽지 못했습니다. 파일을 제거하고 다시 선택하세요."
      : "Couldn’t read the file. Remove it and choose the file again.",
    "pdf-password": isKo ? "암호로 보호된 PDF입니다. 잠금이 해제된 사본을 선택하세요."
      : "This PDF is password-protected. Choose an unlocked copy.",
    "pdf-no-text": isKo ? "선택할 수 있는 텍스트가 없는 PDF입니다. 텍스트가 포함된 사본을 선택하세요."
      : "This PDF has no selectable text. Choose a text-based copy.",
    "pdf-limit": isKo ? "PDF는 40쪽, 추출한 텍스트는 64KiB까지 읽을 수 있습니다. 필요한 페이지를 골라 첨부하세요."
      : "PDFs can have up to 40 pages and 64 KiB of extracted text. Attach the pages you need.",
    "pdf-timeout": isKo ? "PDF 읽기 시간이 초과됐습니다. 더 작은 파일을 선택하세요."
      : "Reading this PDF timed out. Choose a smaller file.",
  };
  const fileIssue = fileError ? fileIssues[fileError] : "";
  const wakeListening = wakeEngine && wakeEngine !== "browser"
    ? (isKo ? "기기에서 “자비스”를 듣는 중" : "Listening for “Jarvis” on this device")
    : (isKo ? "브라우저에서 “자비스”를 듣는 중" : "Listening for “Jarvis” with browser recognition");
  const listening = wakeEngine
    ? (awaitingWakeCommand ? (isKo ? "이어서 명령을 말하세요." : "Say your command.") : wakeListening)
    : (transcript || (continuous
      ? (isKo ? "연속으로 듣는 중" : "Listening continuously")
      : (isKo ? "듣는 중" : "Listening")));
  const voiceSummary = error || (status === "starting"
    ? (isKo ? "마이크 준비 중" : "Getting the microphone ready")
    : status === "listening"
      ? listening
      : status === "processing"
        ? (isKo ? "음성을 처리하는 중" : "Processing voice")
        : reviewPending && text
          ? (isKo ? "음성 입력을 초안에 추가했습니다." : "Voice input added to your draft.")
          : continuous || wakeEngine ? (waitingForReplyAudio
            ? (isKo ? "읽어준 뒤 다시 듣습니다." : "Listening resumes after playback.")
            : wakeEngine ? (isKo ? "호출어 듣기 대기 중" : "Wake word on standby")
              : (isKo ? "연속 듣기" : "Continuous voice")) : "");

  function routeSubmission(event: { preventDefault(): void }) {
    const composer = aui.composer();
    const { text, attachments, quote } = composer.getState();
    if (attachments.some((file) => file.status.type !== "complete" && file.status.type !== "requires-action")) {
      event.preventDefault();
      return;
    }
    const destination = runLocalCommand(text, {
      hasAttachmentsOrQuote: Boolean(attachments.length || quote),
      allowSpeech: !continuous && !wakeEngine && status !== "listening" && status !== "processing",
    });
    if (destination === "chat") return;
    event.preventDefault();
    if (destination === "local") composer.setText("");
  }

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col"
      onSubmit={routeSubmission}>
      <ComposerPrimitive.AttachmentDropzone asChild onDropCapture={clearFileError}>
        <div
          data-slot="composer-shell"
          className="jarvis-composer flex w-full flex-col data-[dragging=true]:border-dashed data-[dragging=true]:border-ring"
        >
          <ComposerAttachments />
          {fileIssue && <p className="jarvis-auth-error px-2 py-1" role="alert">{fileIssue}</p>}
          <ComposerPrimitive.Input
            ref={inputRef}
            placeholder={isKo ? "메시지 또는 명령 입력" : "Write a message or command"}
            className="aui-composer-input max-h-40 min-h-12 w-full resize-none bg-transparent px-2 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground"
            rows={1}
            autoFocus
            aria-label={isKo ? "메시지 입력" : "Message input"}
          />
          {hasFiles && !fileUnreadable && <p className="jarvis-composer-destination" role="status">
            {fileLoading
              ? (isKo ? "기기에서 파일을 읽는 중…" : "Reading files on this device…")
              : hasPdf
                ? (isKo ? "설정한 모델에는 PDF에서 추출한 텍스트와 페이지 번호를 보냅니다."
                  : "Sending shares extracted PDF text and page numbers with the configured model.")
                : (isKo ? "전송하면 설정한 모델이 파일을 읽습니다." : "Sending shares these files with the configured model.")}
          </p>}
          {localCommand && (
            <div className="jarvis-composer-destination">
              <span role="status">{isKo ? "기기에서 실행" : "Runs on this device"}</span>
              <ComposerPrimitive.Send asChild>
                <button type="button" className="jarvis-composer-alternate">
                  {isKo ? "대화로 보내기" : "Send to chat"}
                </button>
              </ComposerPrimitive.Send>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-1">
            <div role="status" className={cn("min-w-0 break-words text-xs", error ? "text-destructive" : "text-muted-foreground")}>
              {voiceSummary}
            </div>
            <ComposerAction
              onBeforeSend={routeSubmission}
              isLocalCommand={Boolean(localCommand)}
              fileBlocked={fileLoading || fileUnreadable}
              onChooseFile={clearFileError}
            />
          </div>
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC<{
  onBeforeSend: (event: { preventDefault(): void }) => void;
  isLocalCommand: boolean;
  fileBlocked: boolean;
  onChooseFile: () => void;
}> = ({
  onBeforeSend, isLocalCommand, fileBlocked, onChooseFile,
}) => {
  const isKo = useKorean();
  const sendLabel = isLocalCommand
    ? (isKo ? "기기에서 명령 실행" : "Run command on this device")
    : (isKo ? "메시지 보내기" : "Send message");

  return (
    <div className="aui-composer-action-wrapper relative flex items-center gap-2">
      <ComposerAddAttachment onChoose={onChooseFile} />
      <ComposerVoiceControls />
      <AuiIf condition={(state) => !state.thread.isRunning}>
        <ComposerPrimitive.Send asChild disabled={fileBlocked}>
          <TooltipIconButton
            tooltip={sendLabel}
            side="bottom"
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-send jarvis-send size-9 rounded-full"
            aria-label={sendLabel}
            onClick={onBeforeSend}
          >
            <ArrowUpIcon className="aui-composer-send-icon size-4 [&_path]:stroke-1.8" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(state) => state.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-cancel jarvis-send size-9 rounded-full"
            aria-label={isKo ? "응답 중지" : "Stop response"}
          >
            <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantRunStatus: FC = () => {
  const isRunning = useAuiState((state) => state.message.status?.type === "running");
  const details = useAuiState((state) =>
    ((state.message.metadata as any)?.custom?.details || null) as AssistantResultDetails | null,
  );
  const [preview, setPreview] = useState<LivePreviewSnapshot | null>(null);
  const isKo = useKorean();
  useEffect(() => {
    let active = true;

    if (
      !isRunning ||
      !details?.livePreview ||
      typeof window === "undefined" ||
      !window.assistantAPI?.getLivePreview
    ) {
      setPreview(null);
      return;
    }

    const pollPreview = async () => {
      try {
        const nextPreview = await window.assistantAPI?.getLivePreview();

        if (!active || !nextPreview?.ok || !nextPreview.imageDataUrl) {
          return;
        }

        setPreview({
          source: nextPreview.source || "",
          imageDataUrl: nextPreview.imageDataUrl,
          title: nextPreview.title || "",
          url: nextPreview.url || "",
        });
      } catch (_error) {
        // Keep the running card alive even if preview polling misses a frame.
      }
    };

    void pollPreview();
    const timer = window.setInterval(() => {
      void pollPreview();
    }, 2200);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [details?.livePreview, isRunning]);

  if (!isRunning) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <p role="status" className="text-sm text-muted-foreground">
        {isKo ? "처리 중…" : "Working…"}
      </p>

      {preview?.imageDataUrl ? (
        <div className="w-full max-w-[320px] rounded-xl border border-border bg-card p-2">
          <img
            src={preview.imageDataUrl}
            alt={preview.title || (isKo ? "작업 미리보기" : "Task preview")}
            className="h-[132px] w-full rounded-[16px] object-cover"
          />
          <div className="px-1 pb-1 pt-2 text-[11px] text-muted-foreground">
            {preview.title || (preview.source === "assistant-browser" ? "Assistant browser preview" : "Desktop preview")}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const AssistantResultPrompts: FC = () => {
  const details = useAuiState((state) =>
    ((state.message.metadata as any)?.custom?.details || null) as AssistantResultDetails | null,
  );

  if (!details || typeof details !== "object") {
    return null;
  }

  const hasPrompt =
    details.filePreview ||
    details.credentialPrompt ||
    details.verificationPrompt ||
    details.sensitiveConfirmation;

  if (!hasPrompt) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {details.filePreview && <FilePreview preview={details.filePreview} />}
      {details.credentialPrompt ? (
        <CredentialPromptCard prompt={details.credentialPrompt} />
      ) : null}
      {details.verificationPrompt ? (
        <VerificationPromptCard prompt={details.verificationPrompt} />
      ) : null}
      {details.sensitiveConfirmation ? (
        <SensitiveConfirmationCard confirmation={details.sensitiveConfirmation} />
      ) : null}
    </div>
  );
};

function FilePreview({ preview }: { preview: LocalFilePreview }) {
  const isKo = useKorean();
  if (typeof preview.name !== "string" || typeof preview.text !== "string") return null;

  return (
    <details className="jarvis-file-preview">
      <summary>
        {isKo ? "파일 미리보기" : "File preview"} <span>{preview.name}</span>
      </summary>
      {preview.truncated === true && (
        <p className="jarvis-result-detail">{isKo ? "처음 16KiB까지 표시합니다." : "Showing up to the first 16 KiB."}</p>
      )}
      {preview.text ? (
        <pre tabIndex={0} aria-label={isKo ? "파일 내용" : "File content"}>{preview.text}</pre>
      ) : (
        <p className="jarvis-result-detail">{isKo ? "빈 파일입니다." : "This file is empty."}</p>
      )}
    </details>
  );
}

const CredentialPromptCard: FC<{ prompt: CredentialPromptDetails }> = ({ prompt }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saveCredential, setSaveCredential] = useState(false);
  const [submit, setSubmit] = useState(Boolean(prompt.submitDefault));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const isKo = useKorean(prompt.language);
  const site = prompt.site || prompt.siteOrUrl || (isKo ? "이 사이트" : "this site");

  async function fillLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setStatus(isKo ? "아이디와 비밀번호를 모두 입력해 주세요." : "Enter both username and password.");
      return;
    }

    if (!window.assistantAPI?.invokeTool) {
      setStatus(isKo ? "Electron 보안 도구 연결을 찾지 못했어요." : "The secure Electron tool bridge is unavailable.");
      return;
    }

    setBusy(true);
    setStatus(isKo ? "현재 로그인 칸에 안전하게 입력하는 중이에요." : "Securely filling the current login form.");

    try {
      const result = await window.assistantAPI.invokeTool("browser:login-form", {
        siteOrUrl: prompt.siteOrUrl || prompt.loginUrl || site,
        loginUrl: prompt.loginUrl || prompt.siteOrUrl || "",
        username: username.trim(),
        password,
        saveCredential,
        submit,
      });
      const saved = Boolean((result as { saved?: unknown } | null)?.saved);
      setPassword("");
      setStatus(
        isKo
          ? saved
            ? "입력 완료. 로그인 정보는 보안 저장소에 저장했어요."
            : "입력 완료. 비밀번호는 화면 상태에서 지웠어요."
          : saved
            ? "Filled. The login was saved in the secure vault."
            : "Filled. The password was cleared from the UI state.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={fillLogin}
      className="rounded-[26px] border border-amber-300/25 bg-amber-300/10 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.18)]"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200/80">
        Secure Login
      </p>
      <h3 className="mt-2 text-base font-semibold">
        {isKo ? `${site} 로그인 정보 입력` : `Login details for ${site}`}
      </h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {isKo
          ? "이 정보는 일반 채팅 텍스트로 보내지지 않고, 현재 브라우저 로그인 칸에만 전달됩니다."
          : "These details are sent to the current browser login form, not as normal chat text."}
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <input
          value={username}
          onChange={(event) => setUsername(event.currentTarget.value)}
          autoComplete="username"
          className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm outline-none focus:border-amber-200/70"
          placeholder={isKo ? "아이디 또는 이메일" : "Username or email"}
        />
        <input
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          autoComplete="current-password"
          type="password"
          className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm outline-none focus:border-amber-200/70"
          placeholder={isKo ? "비밀번호" : "Password"}
        />
      </div>
      <div className="mt-4 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={saveCredential}
            onChange={(event) => setSaveCredential(event.currentTarget.checked)}
            className="size-4 accent-amber-200"
          />
          {isKo ? "보안 저장소에 저장" : "Save in secure vault"}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={submit}
            onChange={(event) => setSubmit(event.currentTarget.checked)}
            className="size-4 accent-amber-200"
          />
          {isKo ? "입력 후 로그인 버튼도 누르기" : "Submit after filling"}
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-2xl bg-amber-200 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (isKo ? "입력 중" : "Filling") : isKo ? "안전하게 입력" : "Fill securely"}
        </button>
        {status ? <span className="text-sm text-muted-foreground">{status}</span> : null}
      </div>
    </form>
  );
};

const VerificationPromptCard: FC<{ prompt: VerificationPromptDetails }> = ({ prompt }) => {
  const [code, setCode] = useState("");
  const [submit, setSubmit] = useState(Boolean(prompt.submitDefault));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const isKo = useKorean(prompt.language);
  const isCaptcha = prompt.kind === "captcha";
  const label = isCaptcha ? (isKo ? "캡차 문자" : "CAPTCHA text") : isKo ? "인증 코드" : "verification code";

  async function fillCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim()) {
      setStatus(isKo ? `${label}를 입력해 주세요.` : `Enter the ${label}.`);
      return;
    }

    if (!window.assistantAPI?.invokeTool) {
      setStatus(isKo ? "Electron 보안 도구 연결을 찾지 못했어요." : "The secure Electron tool bridge is unavailable.");
      return;
    }

    setBusy(true);
    setStatus(isKo ? "현재 인증 입력 칸에 넣는 중이에요." : "Filling the verification field.");

    try {
      await window.assistantAPI.invokeTool("browser:verification-code", {
        code: code.trim(),
        kind: prompt.kind || "verification",
        submit,
      });
      setCode("");
      setStatus(isKo ? "입력 완료. 필요하면 채팅에 '계속'이라고 말해 주세요." : "Filled. Say continue if Jarvis should proceed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={fillCode}
      className="rounded-[26px] border border-sky-300/25 bg-sky-300/10 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.18)]"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200/80">
        Verification
      </p>
      <h3 className="mt-2 text-base font-semibold">
        {isKo ? `${label} 입력` : `Enter ${label}`}
      </h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {isCaptcha
          ? isKo
            ? "이미지 선택형 캡차는 사용자가 직접 풀어야 하고, 문자 입력형은 여기서 전달할 수 있어요."
            : "Image-selection CAPTCHAs need you to solve them; text CAPTCHAs can be filled here."
          : isKo
            ? "문자, 메일, 인증 앱에 표시된 코드를 넣으면 현재 페이지의 인증 칸에 입력합니다."
            : "Enter the code from SMS, email, or your authenticator app."}
      </p>
      <div className="mt-4 flex flex-col gap-3 md:flex-row">
        <input
          value={code}
          onChange={(event) => setCode(event.currentTarget.value)}
          autoComplete="one-time-code"
          className="min-w-0 flex-1 rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm outline-none focus:border-sky-200/70"
          placeholder={label}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-2xl bg-sky-200 px-4 py-2 text-sm font-semibold text-black transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (isKo ? "입력 중" : "Filling") : isKo ? "인증칸에 입력" : "Fill code"}
        </button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={submit}
          onChange={(event) => setSubmit(event.currentTarget.checked)}
          className="size-4 accent-sky-200"
        />
        {isKo ? "입력 후 확인 버튼도 누르기" : "Submit after filling"}
      </label>
      {status ? <p className="mt-3 text-sm text-muted-foreground">{status}</p> : null}
    </form>
  );
};

const SensitiveConfirmationCard: FC<{ confirmation: SensitiveConfirmationDetails }> = ({ confirmation }) => {
  const aui = useAui();
  const target = confirmation.targetLabel || confirmation.message || "sensitive action";

  function replyWith(text: string) {
    aui.composer().setText(text);
    aui.composer().send();
  }

  return (
    <div className="rounded-[26px] border border-red-300/25 bg-red-300/10 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.18)]">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-200/80">
        Final Confirmation
      </p>
      <h3 className="mt-2 text-base font-semibold">민감한 최종 행동 확인</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        결제, 구매, 구독, 예약 확정처럼 되돌리기 어려운 행동으로 보여요. 실행 직전에 한 번 더 확인합니다.
      </p>
      <p className="mt-3 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm">
        대상: {target}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => replyWith("승인")}
          className="rounded-2xl bg-red-200 px-4 py-2 text-sm font-semibold text-black transition hover:bg-red-100"
        >
          승인하고 실행
        </button>
        <button
          type="button"
          onClick={() => replyWith("취소")}
          className="rounded-2xl border border-border/70 bg-background/80 px-4 py-2 text-sm font-semibold transition hover:bg-accent"
        >
          취소
        </button>
      </div>
    </div>
  );
};

function ExecutionRecordList({ records }: { records: readonly ExecutionRecord[] }) {
  const isKo = useKorean();
  const title = isKo ? "실행 기록" : "Execution record";
  const labelIndex = isKo ? 0 : 1;

  return (
    <section className="jarvis-execution-record" aria-label={title}>
      <p className="jarvis-execution-record-title">{title}</p>
      <ul>
        {records.map(({ type, status, host, appName }, index) => (
          <li key={index}>
            <div>
              <p>{actionLabels[type][labelIndex]}</p>
              {(host || appName) && <p className="jarvis-execution-destination"><bdi>{host || appName}</bdi></p>}
            </div>
            <span className="jarvis-execution-status" data-failed={status === "failed" || undefined}>
              {actionStatuses[status][labelIndex]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const AssistantMessage: FC<{ onOpenModelSettings?: OpenModelSettings }> = ({ onOpenModelSettings }) => {
  const isKo = useKorean();
  const attachmentReview = useAuiState((state) => state.message.metadata.custom?.attachmentReview === true);
  const hasFilePreview = useAuiState((state) => Boolean(
    (state.message.metadata.custom?.details as AssistantResultDetails | null)?.filePreview,
  ));
  const records = useAuiState((state) => state.message.metadata.custom?.executionRecords as readonly ExecutionRecord[] | undefined);
  const visibleRecords = hasFilePreview ? records?.filter(({ type }) => type !== "file_read") : records;
  const provider = useAuiState((state) => state.message.metadata.custom?.provider);
  const memorySources = useAuiState((state) => state.message.metadata.custom?.memorySources);
  const memoryLabel = formatMemorySources(memorySources, isKo);
  const cloudModel = typeof provider === "string" && provider.startsWith("jarvis-cloud-gemini-")
    ? provider.slice("jarvis-cloud-".length)
    : "";
  return (
    <MessagePrimitive.Root
      className="aui-assistant-message-root relative mx-auto grid w-full max-w-(--thread-max-width) grid-cols-[auto_1fr] items-start gap-3 py-4"
      data-role="assistant"
    >
      <Avatar.Root className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Avatar.Fallback className="text-xs font-semibold text-foreground">
          J
        </Avatar.Fallback>
      </Avatar.Root>
      <div className="min-w-0">
        <div className="aui-assistant-message-content wrap-break-word text-foreground leading-7">
          <MessagePrimitive.Parts>
            {({ part }) => {
              if (part.type === "text") {
                return attachmentReview
                  ? <MessagePartPrimitive.Text component="p" smooth={false} className="whitespace-pre-wrap" />
                  : <MarkdownText />;
              }
              if (part.type === "reasoning") {
                return <Reasoning {...part} />;
              }
              return null;
            }}
          </MessagePrimitive.Parts>
          <AssistantRunStatus />
          <MessageError />
          <AssistantResultPrompts />
        </div>

        {visibleRecords && visibleRecords.length > 0 && <ExecutionRecordList records={visibleRecords} />}

        {(provider === "jarvis-cloud" || cloudModel) && (
          <p className="mt-2 wrap-break-word text-xs text-muted-foreground">
            Jarvis Cloud{cloudModel ? ` · ${cloudModel}` : ""}
          </p>
        )}

        {memoryLabel && (
          <p className="mt-2 wrap-break-word text-xs text-muted-foreground">
            {isKo ? "모델에 보낸 기억" : "Saved memory sent"} · {memoryLabel}
          </p>
        )}

        {onOpenModelSettings && (provider === "model-required" || provider === "model-error") && (
          <ModelSettingsLink onOpen={onOpenModelSettings} />
        )}

        <div className="aui-assistant-message-footer mt-2 flex items-center">
          <BranchPicker />
          <AssistantActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  const output = useVoiceOutput();
  const ko = useKorean();
  const id = useAuiState((state) => state.message.id);
  const parts = useAuiState((state) => state.message.content);
  const text = parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n").trim();
  const language = voiceLanguage(text, ko ? "ko" : "en");
  const engine = voiceEngine(output.settings?.providers[language]);
  const provider = voiceEngineName(engine, ko);
  const readLabel = engine === "system" ? (ko ? "기기에서 읽어주기" : "Read aloud on device")
    : (ko ? `${provider}로 읽어주기` : `Read aloud with ${provider}`);
  const playback = output.playback?.id === id ? output.playback : null;
  const playing = playback?.status === "loading" || playback?.status === "playing";

  return <>
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="aui-assistant-action-bar-root -ml-1 flex gap-1 text-muted-foreground data-floating:absolute data-floating:rounded-full data-floating:border data-floating:border-border/70 data-floating:bg-card data-floating:p-1 data-floating:shadow-sm"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(state) => state.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(state) => !state.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <AuiIf condition={(state) => state.thread.capabilities.reload}>
        <ActionBarPrimitive.Reload asChild>
          <TooltipIconButton tooltip="Refresh">
            <RefreshCwIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.Reload>
      </AuiIf>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip={ko ? "더 보기" : "More"}
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-36 overflow-hidden rounded-2xl border border-border/80 bg-popover/95 p-1.5 text-popover-foreground shadow-xl backdrop-blur"
        >
          {output.settings && text && engine !== "off" && (
            <ActionBarMorePrimitive.Item disabled={playing} onSelect={() => void output.play(id, text, language, engine)}
              className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <Volume2Icon className="size-4 shrink-0" aria-hidden="true" />
              <span>
                {readLabel}
                {text.length > voiceTextLimit && <span className="block text-xs text-muted-foreground">
                  {ko ? `처음 ${voiceTextLimit}자` : `First ${voiceTextLimit} characters`}
                </span>}
              </span>
            </ActionBarMorePrimitive.Item>
          )}
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
    {playback && <div className="flex min-w-0 flex-wrap items-center gap-x-2">
      <VoicePlaybackStatus playback={playback} ko={ko} />
      {playing && <Button type="button" size="sm" variant="ghost" onClick={() => output.stop(id)}>
        {ko ? "읽어주기 중지" : "Stop reading"}
      </Button>}
    </div>}
  </>;
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-user-message-root fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-(--thread-max-width) animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 py-4 duration-150 [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content wrap-break-word peer rounded-[28px] bg-[color:var(--aui-user-bubble-bg)] px-4 py-3 text-foreground shadow-sm empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <AuiIf condition={(state) => state.thread.capabilities.edit}>
          <div className="aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2 peer-empty:hidden">
            <UserActionBar />
          </div>
        </AuiIf>
      </div>

      <BranchPicker className="aui-user-branch-picker col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root className="aui-edit-composer-wrapper mx-auto flex w-full max-w-(--thread-max-width) flex-col py-4">
      <ComposerPrimitive.Root className="aui-edit-composer-root ml-auto flex w-full max-w-[85%] flex-col rounded-[28px] bg-[color:var(--aui-user-bubble-bg)]">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-sm text-foreground outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">Update</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  const canSwitchBranches = useAuiState((state) => state.thread.capabilities.switchToBranch);
  if (!canSwitchBranches) return null;
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root mr-2 -ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
