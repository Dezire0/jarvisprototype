import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Reasoning } from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useJarvisVoice } from "@/components/jarvis/voice-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import * as Avatar from "@radix-ui/react-avatar";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  AudioLinesIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import type { FC } from "react";



const WELCOME_PROMPTS = [
  {
    title: { ko: "오늘 할 일 정리", en: "Plan my day" },
    prompt: { ko: "지금 내가 제일 먼저 해야 할 일을 우선순위로 정리해줘", en: "Help me prioritize my tasks for today" },
  },
  {
    title: { ko: "작업 환경 열기", en: "Open workspace" },
    prompt: { ko: "크롬 열고 Gmail과 Notion을 한 번에 열어줘", en: "Open Chrome, Gmail, and Notion together" },
  },
  {
    title: { ko: "화면 브리핑", en: "Brief the screen" },
    prompt: { ko: "지금 화면에서 중요한 것만 짧게 설명해줘", en: "Summarize the important parts of my current screen" },
  },
  {
    title: { ko: "집중용 음악", en: "Focus music" },
    prompt: { ko: "유튜브 열고 집중할 때 들을 음악 재생해줘", en: "Play some focus music on YouTube" },
  },
];

export const Thread: FC = () => {
  const isKo = typeof navigator !== "undefined" && navigator.language.startsWith("ko");
  const t = (ko: string, en: string) => (isKo ? ko : en);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col overflow-hidden rounded-[32px] border border-border/70 bg-background shadow-[0_32px_120px_rgba(0,0,0,0.18)]"
      style={{
        ["--thread-max-width" as string]: "48rem",
        ["--composer-radius" as string]: "28px",
        ["--composer-padding" as string]: "12px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="aui-thread-viewport relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth bg-background px-4 pt-4 md:px-8 md:pt-6"
      >
        <AuiIf condition={(state) => state.thread.isEmpty}>
          <ThreadWelcome />
        </AuiIf>

        <ThreadPrimitive.Messages>
          {() => <ThreadMessage />}
        </ThreadPrimitive.Messages>

        <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible bg-background/96 pb-4 pt-6 backdrop-blur md:pb-6">
          <ThreadScrollToBottom />
          <Composer />
          <p className="text-center text-[11px] text-muted-foreground">
            {t("자비스는 실수를 할 수 있습니다. 중요한 정보는 확인해 주세요.", "Jarvis can make mistakes. Verify important information.")}
          </p>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((state) => state.message.role);
  const isEditing = useAuiState((state) => state.message.composer.isEditing);

  if (isEditing) {
    return <EditComposer />;
  }

  if (role === "user") {
    return <UserMessage />;
  }

  return <AssistantMessage />;
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

const ThreadWelcome: FC = () => {
  const isKo = typeof navigator !== "undefined" && navigator.language.startsWith("ko");
  const t = (ko: string, en: string) => (isKo ? ko : en);

  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col items-center justify-center px-4 text-center">
          <Avatar.Root className="mb-5 flex h-14 w-14 items-center justify-center rounded-[22px] border border-white/15 bg-white/5 shadow-[0_12px_50px_rgba(255,255,255,0.08)]">
            <Avatar.Fallback className="text-lg font-semibold text-foreground">
              J
            </Avatar.Fallback>
          </Avatar.Root>
          <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-3xl tracking-tight duration-200">
            {t("오늘 무엇을 도와드릴까요?", "How can I help you?")}
          </h1>
          <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-base text-muted-foreground delay-75 duration-200 md:text-lg">
            {t("자비스는 브라우징, 자동화, 정보 분석을 돕는 AI 비서입니다.", "Jarvis can plan, browse, and automate your tasks.")}
          </p>
        </div>
      </div>
      <ThreadSuggestions />
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  const isKo = typeof navigator !== "undefined" && navigator.language.startsWith("ko");

  return (
    <div className="aui-thread-welcome-suggestions grid w-full gap-3 pb-4 @md:grid-cols-2">
      {WELCOME_PROMPTS.map((item) => (
        <WelcomePromptCard
          key={item.title.en}
          title={isKo ? item.title.ko : item.title.en}
          prompt={isKo ? item.prompt.ko : item.prompt.en}
        />
      ))}
    </div>
  );
};

const WelcomePromptCard: FC<{
  title: string;
  prompt: string;
}> = ({ title, prompt }) => {
  const aui = useAui();
  const isRunning = useAuiState((state) => state.thread.isRunning);

  function runPrompt() {
    aui.composer().setText(prompt);
    aui.composer().send();
  }

  return (
    <button
      type="button"
      onClick={runPrompt}
      disabled={isRunning}
      className="aui-thread-welcome-suggestion flex h-auto w-full items-center justify-between rounded-[24px] border border-border/70 bg-card/70 px-5 py-5 text-left shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      <p className="font-medium text-[15px] text-foreground">{title}</p>
      <ArrowUpIcon className="size-4 text-muted-foreground/50" />
    </button>
  );
};

const Composer: FC = () => {
  const {
    supported,
    status,
    transcript,
    error,
    continuous,
    startOnce,
    toggleContinuous,
  } = useJarvisVoice();

  const voiceSummary = error
    ? error
    : status === "listening"
      ? transcript
        ? `Listening: ${transcript}`
        : "Listening for your voice..."
      : status === "processing"
        ? "Sending voice message..."
        : continuous
          ? "Continuous voice mode is active."
          : "Click the mic to speak.";

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          data-slot="composer-shell"
          className="flex w-full flex-col gap-2 rounded-(--composer-radius) border border-white/8 bg-[color:var(--aui-composer-bg)] p-(--composer-padding) shadow-[0_16px_70px_rgba(0,0,0,0.16)] transition-shadow focus-within:border-white/15 focus-within:ring-2 focus-within:ring-white/10 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50"
        >
          <ComposerAttachments />
          <ComposerPrimitive.Input
            placeholder="Message Jarvis"
            className="aui-composer-input max-h-40 min-h-12 w-full resize-none bg-transparent px-2 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/80"
            rows={1}
            autoFocus
            aria-label="Message input"
          />
          <div className="flex items-end justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {voiceSummary}
              </span>
            </div>
            <ComposerAction
              supported={supported}
              status={status}
              continuous={continuous}
              startOnce={startOnce}
              toggleContinuous={toggleContinuous}
            />
          </div>
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC<{
  supported: boolean;
  status: string;
  continuous: boolean;
  startOnce: () => void;
  toggleContinuous: () => void;
}> = ({ supported, status, continuous, startOnce, toggleContinuous }) => {
  const aui = useAui();
  const messages = useAuiState((state) => state.thread.messages);

  function extractText(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) {
      return value.map(extractText).filter(Boolean).join(" ").trim();
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.text === "string") return record.text.trim();
      if ("content" in record) return extractText(record.content);
      if ("parts" in record) return extractText(record.parts);
    }
    return "";
  }

  function restoreLastUserMessageAndCancel() {
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    const text = extractText(lastUserMessage);

    aui.thread().cancelRun();
    if (text) {
      queueMicrotask(() => {
        aui.composer().setText(text);
      });
    }
  }

  return (
    <div className="aui-composer-action-wrapper relative flex items-center gap-2">
      <ComposerAddAttachment />
      <TooltipIconButton
        tooltip={continuous ? "Stop continuous voice" : "Start continuous voice"}
        side="bottom"
        type="button"
        variant="ghost"
        className={cn(
          "size-9 rounded-full border border-border/70 bg-background/60 text-foreground",
          continuous && "bg-white text-black",
        )}
        onClick={toggleContinuous}
        aria-label="Toggle continuous voice mode"
        disabled={!supported}
      >
        <AudioLinesIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Voice input"
        side="bottom"
        type="button"
        variant="ghost"
        className={cn(
          "size-9 rounded-full border border-border/70 bg-background/60 text-foreground",
          status === "listening" && "bg-white text-black",
        )}
        onClick={startOnce}
        aria-label="Start voice input"
        disabled={!supported || status === "listening"}
      >
        <MicIcon className="size-4" />
      </TooltipIconButton>
      <AuiIf condition={(state) => !state.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-send size-9 rounded-full bg-white text-black shadow-sm hover:bg-white/90"
            aria-label="Send message"
          >
            <ArrowUpIcon className="aui-composer-send-icon size-4 [&_path]:stroke-1.8" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(state) => state.thread.isRunning}>
        <Button
          type="button"
          variant="default"
          size="icon"
          className="aui-composer-cancel size-9 rounded-full bg-white text-black"
          aria-label="Stop generating"
          onClick={restoreLastUserMessageAndCancel}
        >
          <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
        </Button>
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

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-assistant-message-root fade-in slide-in-from-bottom-1 relative mx-auto grid w-full max-w-(--thread-max-width) grid-cols-[auto_1fr] items-start gap-3 animate-in py-4 duration-150"
      data-role="assistant"
    >
      <Avatar.Root className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        <Avatar.Fallback className="text-xs font-semibold text-foreground">
          J
        </Avatar.Fallback>
      </Avatar.Root>
      <div className="min-w-0">
        <div className="aui-assistant-message-content wrap-break-word text-foreground leading-7">
          <MessagePrimitive.Parts>
            {({ part }) => {
              if (part.type === "text") {
                return <MarkdownText />;
              }
              if (part.type === "reasoning") {
                return <Reasoning {...part} />;
              }
              if (part.type === "tool-call") {
                return part.toolUI ?? <ToolFallback {...part} />;
              }
              return null;
            }}
          </MessagePrimitive.Parts>
          <MessageError />
        </div>

        <div className="aui-assistant-message-footer mt-2 flex items-center">
          <BranchPicker />
          <AssistantActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
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
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
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
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
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
        <div className="aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2 peer-empty:hidden">
          <UserActionBar />
        </div>
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
