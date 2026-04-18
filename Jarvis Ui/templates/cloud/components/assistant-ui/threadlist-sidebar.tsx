import type * as React from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useJarvisExtensions } from "@/components/jarvis/extensions-provider";
import { useJarvisVoice } from "@/components/jarvis/voice-provider";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import {
  CommandIcon,
  Link2Icon,
  MicIcon,
  PanelLeftIcon,
  PlugIcon,
  RefreshCcwIcon,
  SparklesIcon,
} from "lucide-react";

function QuickActionButton({
  label,
  prompt,
}: {
  label: string;
  prompt: string;
}) {
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
      className="aui-sidebar-action rounded-2xl border border-border/70 bg-card/75 px-3 py-2 text-left text-sm text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function ExtensionNames({
  items,
  emptyLabel,
}: {
  items: string[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return (
      <span className="text-xs leading-5 text-muted-foreground">
        {emptyLabel}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.slice(0, 3).map((item) => (
        <span
          key={item}
          className="rounded-full border border-border/70 bg-background/70 px-2 py-1 text-[11px] leading-none text-foreground/90"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function ExtensionCard({
  icon,
  title,
  caption,
  count,
  items,
  emptyLabel,
}: {
  icon: React.ReactNode;
  title: string;
  caption: string;
  count: number;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/55 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border/70 bg-card/80 p-2 text-foreground">
            {icon}
          </span>
          <div>
            <p className="text-sm font-semibold leading-none">{title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {caption}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-border/70 px-2 py-1 text-xs font-medium text-foreground">
          {count}
        </span>
      </div>
      <ExtensionNames items={items} emptyLabel={emptyLabel} />
    </div>
  );
}

export function ThreadListSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { supported, status, error, continuous, startOnce, toggleContinuous } =
    useJarvisVoice();
  const {
    available: extensionsAvailable,
    status: extensionsStatus,
    refreshing: extensionsRefreshing,
    error: extensionsError,
    summary: extensionSummary,
    registry: extensionRegistry,
    reload: reloadExtensions,
  } = useJarvisExtensions();

  const voiceLabel =
    status === "listening"
      ? "Listening"
      : status === "processing"
        ? "Processing"
        : status === "unsupported"
          ? "Unavailable"
          : status === "error"
            ? "Needs attention"
            : "Ready";

  const voiceDescription = error
    ? error
    : supported
      ? continuous
        ? "연속 음성 모드가 켜져 있어요. 응답 후 다시 바로 듣습니다."
        : "마이크 버튼으로 한 번 듣기, 연속 모드로 계속 대화할 수 있어요."
      : "이 환경에서는 Web Speech 음성 인식을 사용할 수 없어요.";

  const extensionsLabel =
    extensionsStatus === "ready"
      ? "Connected"
      : extensionsStatus === "loading"
        ? "Loading"
        : extensionsStatus === "error"
          ? "Needs attention"
          : "Desktop only";

  const extensionsDescription =
    extensionsStatus === "error"
      ? extensionsError || "확장 기능 정보를 읽는 중 문제가 생겼어요."
      : extensionsAvailable
        ? "Connector는 앱 별칭을 실제 앱 이름으로 보정하고, Skill은 앱 제어 플래너에 힌트를 더하고, Webhook은 일반 라우팅 전에 먼저 실행됩니다."
        : "데스크톱 앱 안에서 실행할 때만 로컬 extensions 폴더를 읽어올 수 있어요.";

  return (
    <Sidebar
      {...props}
      variant="floating"
      className="aui-sidebar border-r-0 bg-transparent"
    >
      <SidebarHeader className="aui-sidebar-header border-none px-3 pt-4">
        <div className="aui-sidebar-brand rounded-[28px] border border-border/80 bg-card/85 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.16)] backdrop-blur">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm">
              <SparklesIcon className="size-5" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                Jarvis
              </p>
              <h2 className="text-lg font-semibold tracking-tight">
                Chat Workspace
              </h2>
            </div>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            ChatGPT 같은 대화형 화면을 기반으로, 앱 제어와 브라우저 작업을
            자연스럽게 이어가는 데스크톱 허브입니다.
          </p>
        </div>
      </SidebarHeader>
      <SidebarContent className="aui-sidebar-content gap-3 px-3 pb-3">
        <section className="rounded-[26px] border border-border/70 bg-card/80 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Voice
              </p>
              <h3 className="mt-1 text-sm font-semibold">{voiceLabel}</h3>
            </div>
            <div className="rounded-full border border-border/70 bg-background/70 p-2 text-foreground">
              <MicIcon className="size-4" />
            </div>
          </div>
          <p className="mb-3 text-sm leading-6 text-muted-foreground">
            {voiceDescription}
          </p>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={startOnce}
              disabled={!supported || status === "listening"}
              className="rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              One-shot voice input
            </button>
            <button
              type="button"
              onClick={toggleContinuous}
              disabled={!supported}
              className="rounded-full border border-border/70 bg-background/70 px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {continuous ? "Stop continuous mode" : "Start continuous mode"}
            </button>
          </div>
        </section>

        <section className="rounded-[26px] border border-border/70 bg-card/80 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Extensions
              </p>
              <h3 className="mt-1 text-sm font-semibold">{extensionsLabel}</h3>
            </div>
            <button
              type="button"
              onClick={() => void reloadExtensions()}
              disabled={!extensionsAvailable || extensionsRefreshing}
              className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCcwIcon
                className={`size-3.5 ${extensionsRefreshing ? "animate-spin" : ""}`}
              />
              Reload
            </button>
          </div>
          <p className="mb-3 text-sm leading-6 text-muted-foreground">
            {extensionsDescription}
          </p>
          <div className="grid gap-2">
            <ExtensionCard
              icon={<PlugIcon className="size-3.5" />}
              title="Connectors"
              caption="앱 별칭을 실제 대상 앱 이름으로 보정"
              count={extensionSummary.connectors}
              items={extensionRegistry.connectors.map(
                (connector) => connector.canonicalName || connector.name,
              )}
              emptyLabel="아직 연결된 앱 보정 규칙이 없어요."
            />
            <ExtensionCard
              icon={<SparklesIcon className="size-3.5" />}
              title="Skills"
              caption="플래너가 복합 명령을 해석할 때 참고하는 힌트"
              count={extensionSummary.skills}
              items={extensionRegistry.skills.map((skill) => skill.name)}
              emptyLabel="아직 앱 전용 스킬 힌트가 없어요."
            />
            <ExtensionCard
              icon={<Link2Icon className="size-3.5" />}
              title="Webhooks"
              caption="일반 도구 라우팅 전에 바로 실행되는 빠른 트리거"
              count={extensionSummary.webhooks}
              items={extensionRegistry.webhooks.map((webhook) => webhook.name)}
              emptyLabel="아직 즉시 실행 웹훅이 없어요."
            />
          </div>
          <div className="mt-3 rounded-2xl border border-border/60 bg-background/55 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Loaded manifests
              </p>
              <span className="text-xs text-muted-foreground">
                {extensionRegistry.loadedFiles.length} files
              </span>
            </div>
            <ExtensionNames
              items={extensionRegistry.loadedFiles.map((filePath) =>
                filePath.split(/[/\\]/).pop() || filePath,
              )}
              emptyLabel="extensions 폴더에서 읽은 JSON 매니페스트가 아직 없어요."
            />
          </div>
        </section>

        <section className="rounded-[26px] border border-border/70 bg-card/80 p-3">
          <div className="mb-3 flex items-center gap-2">
            <CommandIcon className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Quick actions</h3>
          </div>
          <div className="grid gap-2">
            <QuickActionButton
              label="Open Gmail"
              prompt="크롬 열고 Gmail로 가줘"
            />
            <QuickActionButton
              label="Summarize priorities"
              prompt="지금 내가 제일 먼저 해야 할 일을 우선순위로 정리해줘"
            />
            <QuickActionButton
              label="YouTube music"
              prompt="유튜브 열고 집중할 때 들을 음악 재생해줘"
            />
            <QuickActionButton
              label="Screen brief"
              prompt="지금 화면에서 중요한 것만 짧게 설명해줘"
            />
          </div>
        </section>

        <section className="min-h-0 rounded-[26px] border border-border/70 bg-card/80 p-3">
          <div className="mb-3 flex items-center gap-2">
            <PanelLeftIcon className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Conversations</h3>
          </div>
          <ThreadList />
        </section>
      </SidebarContent>
      <SidebarRail />
      <SidebarFooter className="aui-sidebar-footer border-none px-3 pb-4">
        <div className="rounded-[24px] border border-border/70 bg-card/75 px-4 py-3 text-sm text-muted-foreground">
          음성 인식은 현재 `Jarvis Ui`에 직접 연결되어 있고, extensions
          registry도 같은 데스크톱 브리지에서 함께 읽어옵니다.
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
