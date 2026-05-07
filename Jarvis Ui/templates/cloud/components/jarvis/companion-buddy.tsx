"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SparklesIcon, Music4Icon, PauseIcon, PlayIcon, ScrollTextIcon, WandSparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BuddyAction = {
  id: string;
  kind: "prompt" | "tool";
  label: string;
  suggestedPrompt?: string;
};

type BuddyState = {
  active?: boolean;
  event?: {
    id: string;
    kind: string;
    siteType: string;
    url?: string;
  } | null;
  message?: string;
  actions?: BuddyAction[];
  suggestions?: string[];
  updatedAt?: string;
};

type MediaCardState = {
  provider?: string;
  title?: string;
  thumbnailUrl?: string;
  canonicalUrl?: string;
  playbackState?: string;
  positionMs?: number;
  durationMs?: number;
  source?: string;
};

type CompanionState = {
  buddy?: BuddyState;
  media?: {
    activeCard?: MediaCardState | null;
  };
};

function prefersKorean() {
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ko");
}

function formatSeconds(ms = 0) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function CompanionBuddy() {
  const isKo = prefersKorean();
  const [companion, setCompanion] = useState<CompanionState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busyActionId, setBusyActionId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [promptPreview, setPromptPreview] = useState("");
  const lastSelectionRef = useRef("");
  const lastErrorRef = useRef("");
  const lastUrlRef = useRef("");

  const buddy = companion?.buddy || null;
  const media = companion?.media?.activeCard || null;
  const actions = Array.isArray(buddy?.actions) ? buddy.actions : [];

  async function refreshState() {
    if (!window.assistantAPI?.getCompanionState) {
      return;
    }
    try {
      const state = (await window.assistantAPI.getCompanionState()) as CompanionState;
      setCompanion(state);
    } catch (_error) {
      // Keep the UI quiet if the bridge is temporarily unavailable.
    }
  }

  async function reportBuddyEvent(payload: Record<string, unknown>) {
    if (!window.assistantAPI?.reportBuddyEvent) {
      return;
    }
    try {
      const state = (await window.assistantAPI.reportBuddyEvent(payload)) as BuddyState;
      setCompanion((current) => ({
        ...(current || {}),
        buddy: state
      }));
    } catch (_error) {
      // Ignore local trigger misses.
    }
  }

  useEffect(() => {
    void refreshState();
    const timer = window.setInterval(() => {
      void refreshState();
    }, 4000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    lastUrlRef.current = window.location.href;
    const timer = window.setInterval(() => {
      const nextUrl = window.location.href;
      if (nextUrl !== lastUrlRef.current) {
        lastUrlRef.current = nextUrl;
        void reportBuddyEvent({
          kind: "url_change",
          scope: "jarvis-ui",
          url: nextUrl,
          title: document.title,
          timestamp: new Date().toISOString()
        });
      }
    }, 2500);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection()?.toString().replace(/\s+/g, " ").trim() || "";
      if (selection.length < 48 || selection === lastSelectionRef.current) {
        return;
      }
      lastSelectionRef.current = selection;
      void reportBuddyEvent({
        kind: "selection",
        scope: "jarvis-ui",
        url: window.location.href,
        title: document.title,
        selectedTextPreview: selection.slice(0, 240),
        timestamp: new Date().toISOString()
      });
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const candidates = Array.from(
        document.querySelectorAll("[role='alert'], [aria-live='assertive'], [data-error], .error, .text-destructive")
      )
        .map((node) => node.textContent?.replace(/\s+/g, " ").trim() || "")
        .filter(Boolean);
      const firstError = candidates.find((text) => /(error|failed|invalid|denied|만료|오류|실패|차단|로그인)/i.test(text));
      if (!firstError || firstError === lastErrorRef.current) {
        return;
      }
      lastErrorRef.current = firstError;
      void reportBuddyEvent({
        kind: "error_banner",
        scope: "jarvis-ui",
        url: window.location.href,
        title: document.title,
        errorPreview: firstError.slice(0, 240),
        timestamp: new Date().toISOString()
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    return () => observer.disconnect();
  }, []);

  const progressLabel = useMemo(() => {
    if (!media) {
      return "";
    }
    const position = formatSeconds(media.positionMs || 0);
    const duration = formatSeconds(media.durationMs || 0);
    if (!media.durationMs) {
      return position;
    }
    return `${position} / ${duration}`;
  }, [media]);

  async function runAction(action: BuddyAction) {
    if (!window.assistantAPI?.invokeTool) {
      return;
    }
    setBusyActionId(action.id);
    setStatusMessage("");
    try {
      const response = (await window.assistantAPI.invokeTool("buddy:action", {
        actionId: action.id,
        eventId: buddy?.event?.id || ""
      })) as {
        data?: {
          suggestedPrompt?: string;
          lyrics?: { lyricsSnippet?: string };
          media?: MediaCardState;
        };
      };
      const suggestedPrompt = response?.data?.suggestedPrompt || "";
      if (suggestedPrompt) {
        setPromptPreview(suggestedPrompt);
        setStatusMessage(
          isKo ? "버디가 바로 쓸 수 있는 프롬프트를 준비했어요." : "Buddy prepared a prompt you can use right away."
        );
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(suggestedPrompt).catch(() => {});
        }
      } else if (response?.data?.lyrics?.lyricsSnippet) {
        setPromptPreview(response.data.lyrics.lyricsSnippet);
        setStatusMessage(isKo ? "가사 힌트를 가져왔어요." : "Fetched a lightweight lyrics hint.");
      } else {
        setStatusMessage(isKo ? "동작을 실행했어요." : "Action completed.");
      }
      await refreshState();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyActionId("");
    }
  }

  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-40 flex w-[min(360px,calc(100vw-32px))] flex-col items-end gap-3">
      {media ? (
        <div className="pointer-events-auto w-full rounded-[26px] border border-white/10 bg-[#101010]/92 p-3 shadow-[0_30px_90px_rgba(0,0,0,0.32)] backdrop-blur">
          <div className="flex items-center gap-3">
            {media.thumbnailUrl ? (
              <img
                src={media.thumbnailUrl}
                alt={media.title || "Media"}
                className="h-16 w-24 rounded-2xl object-cover"
              />
            ) : (
              <div className="flex h-16 w-24 items-center justify-center rounded-2xl bg-white/6 text-emerald-300">
                <Music4Icon className="size-6" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300/80">
                {media.provider || "YouTube"}
              </p>
              <p className="mt-1 line-clamp-2 text-sm font-semibold text-white">
                {media.title || (isKo ? "현재 미디어" : "Current media")}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {(media.playbackState || "idle").toUpperCase()} {progressLabel ? `· ${progressLabel}` : ""}
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1 rounded-xl bg-white/8 text-white hover:bg-white/14"
              onClick={() => void window.assistantAPI?.invokeTool("media:play", {})}
            >
              <PlayIcon className="mr-2 size-4" />
              {isKo ? "재생" : "Play"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1 rounded-xl bg-white/8 text-white hover:bg-white/14"
              onClick={() => void window.assistantAPI?.invokeTool("media:pause", {})}
            >
              <PauseIcon className="mr-2 size-4" />
              {isKo ? "일시정지" : "Pause"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="rounded-xl bg-white/8 text-white hover:bg-white/14"
              onClick={() => void window.assistantAPI?.invokeTool("media:get-lyrics", {})}
            >
              <ScrollTextIcon className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {expanded || buddy?.active ? (
        <div className="pointer-events-auto w-full rounded-[28px] border border-emerald-500/20 bg-[#101010]/94 p-4 shadow-[0_30px_90px_rgba(0,0,0,0.36)] backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-300/80">
                Jarvis Buddy
              </p>
              <p className="mt-2 text-sm leading-6 text-white">
                {buddy?.message || (isKo ? "로컬 트리거를 기반으로만 개입할 준비를 하고 있어요." : "I only step in when local triggers suggest it might help.")}
              </p>
              {buddy?.event?.kind ? (
                <p className="mt-2 text-[11px] text-zinc-400">
                  {buddy.event.kind} · {buddy.event.siteType || "unknown"}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/6 hover:text-white"
            >
              {isKo ? "닫기" : "Close"}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.id}
                type="button"
                size="sm"
                variant="secondary"
                disabled={busyActionId === action.id}
                onClick={() => void runAction(action)}
                className={cn(
                  "rounded-full bg-white/8 text-white hover:bg-white/14",
                  busyActionId === action.id && "opacity-70"
                )}
              >
                {action.label}
              </Button>
            ))}
          </div>

          {promptPreview ? (
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-zinc-200">
              {promptPreview}
            </div>
          ) : null}

          {statusMessage ? (
            <div className="mt-3 text-xs text-emerald-200/80">
              {statusMessage}
            </div>
          ) : null}
        </div>
      ) : null}

      <Button
        type="button"
        onClick={() => {
          setExpanded((current) => !current);
          void reportBuddyEvent({
            kind: "manual",
            scope: "jarvis-ui",
            url: window.location.href,
            title: document.title,
            timestamp: new Date().toISOString()
          });
        }}
        className="pointer-events-auto h-14 rounded-full border border-emerald-400/30 bg-emerald-500/18 px-5 text-white shadow-[0_24px_70px_rgba(16,185,129,0.18)] hover:bg-emerald-500/26"
      >
        <SparklesIcon className="mr-2 size-4" />
        {isKo ? "Buddy" : "Buddy"}
        <WandSparklesIcon className="ml-2 size-4 text-emerald-200" />
      </Button>
    </div>
  );
}
