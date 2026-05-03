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
import { useState, type FC, type FormEvent } from "react";



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

type AssistantResultDetails = {
  credentialPrompt?: CredentialPromptDetails | null;
  verificationPrompt?: VerificationPromptDetails | null;
  sensitiveConfirmation?: SensitiveConfirmationDetails | null;
};

function prefersKorean(language?: string) {
  return language === "ko" || (typeof navigator !== "undefined" && navigator.language.startsWith("ko"));
}

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
            {t("자비스는 일정 정리, 글 초안, 브라우징, 자동화를 돕는 실무형 AI 비서입니다.", "Jarvis is a practical AI assistant for planning, drafting, browsing, and automation.")}
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

const AssistantResultPrompts: FC = () => {
  const details = useAuiState((state) =>
    ((state.message.metadata as any)?.custom?.details || null) as AssistantResultDetails | null,
  );

  if (!details || typeof details !== "object") {
    return null;
  }

  const hasPrompt =
    details.credentialPrompt ||
    details.verificationPrompt ||
    details.sensitiveConfirmation;

  if (!hasPrompt) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
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

const CredentialPromptCard: FC<{ prompt: CredentialPromptDetails }> = ({ prompt }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saveCredential, setSaveCredential] = useState(false);
  const [submit, setSubmit] = useState(Boolean(prompt.submitDefault));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const isKo = prefersKorean(prompt.language);
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
  const isKo = prefersKorean(prompt.language);
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
          <AssistantResultPrompts />
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
