"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3Icon, Clock3Icon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getJarvisLanguage, jarvisText } from "@/lib/jarvis-messages";
import { cn } from "@/lib/utils";

type DashboardState = {
  metrics?: {
    tokenUsage?: number;
    successfulAutomations?: number;
    failedAutomations?: number;
    queueCompleted?: number;
    queueFailed?: number;
    estimatedMinutesSaved?: number;
    mediaInteractions?: number;
    buddyTriggers?: number;
  };
  snapshots?: Array<{
    windowStart: string;
    tokenUsage: number;
    successfulAutomations: number;
    failedAutomations: number;
    queueCompleted: number;
    estimatedMinutesSaved: number;
  }>;
  insights?: string[];
};

export function AdminDashboardCard({ isKo = true }: { isKo?: boolean }) {
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(false);
  const language = getJarvisLanguage(isKo ? "ko" : "en");

  async function refresh(forceLoading = false) {
    if (!window.assistantAPI?.getDashboardState) {
      return;
    }
    if (forceLoading) {
      setLoading(true);
    }
    try {
      const state = (await window.assistantAPI.getDashboardState()) as DashboardState;
      setDashboard(state);
    } catch (_error) {
      // Keep the dashboard quiet if the runtime is restarting.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => {
      void refresh();
    }, 6000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const metrics = dashboard?.metrics || {};
  const snapshots = Array.isArray(dashboard?.snapshots) ? dashboard.snapshots.slice(-6) : [];
  const insights = Array.isArray(dashboard?.insights) ? dashboard.insights : [];
  const maxTokens = useMemo(
    () => Math.max(1, ...snapshots.map((snapshot) => Number(snapshot.tokenUsage || 0))),
    [snapshots]
  );

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300/80">
            {jarvisText(language, "frontend.dashboard.title")}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {jarvisText(language, "frontend.dashboard.subtitle")}
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => void refresh(true)}
          className="rounded-xl text-zinc-400 hover:bg-white/8 hover:text-white"
        >
          <RefreshCwIcon className={cn("size-4", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <MetricTile label={jarvisText(language, "frontend.dashboard.success")} value={metrics.successfulAutomations || 0} />
        <MetricTile label={jarvisText(language, "frontend.dashboard.failures")} value={metrics.failedAutomations || 0} />
        <MetricTile label={jarvisText(language, "frontend.dashboard.timeSaved")} value={`${metrics.estimatedMinutesSaved || 0}m`} />
        <MetricTile label={jarvisText(language, "frontend.dashboard.buddyTriggers")} value={metrics.buddyTriggers || 0} />
      </div>

      <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
          <BarChart3Icon className="size-4 text-emerald-300" />
          {jarvisText(language, "frontend.dashboard.tokenTrend")}
        </div>
        <div className="mt-3 flex items-end gap-2">
          {snapshots.length ? snapshots.map((snapshot, index) => {
            const height = Math.max(10, Math.round((Number(snapshot.tokenUsage || 0) / maxTokens) * 72));
            return (
              <div key={`${snapshot.windowStart}-${index}`} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-20 w-full items-end justify-center">
                  <div
                    className="w-full rounded-t-xl bg-gradient-to-t from-emerald-500 to-cyan-300"
                    style={{ height }}
                  />
                </div>
                <span className="text-[10px] text-zinc-500">
                  {new Date(snapshot.windowStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          }) : (
            <div className="py-4 text-xs text-zinc-500">
              {jarvisText(language, "frontend.dashboard.notEnoughMetrics")}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-zinc-300">
        <div className="rounded-xl border border-white/8 bg-black/20 p-3">
          <div className="inline-flex items-center gap-1 text-zinc-400">
            <Clock3Icon className="size-3.5" />
            {jarvisText(language, "frontend.dashboard.queue")}
          </div>
          <p className="mt-2 text-sm font-semibold text-white">
            {(metrics.queueCompleted || 0)}/{(metrics.queueFailed || 0) + (metrics.queueCompleted || 0)}
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-black/20 p-3">
          <div className="inline-flex items-center gap-1 text-zinc-400">
            <ShieldCheckIcon className="size-3.5" />
            {jarvisText(language, "frontend.dashboard.media")}
          </div>
          <p className="mt-2 text-sm font-semibold text-white">
            {metrics.mediaInteractions || 0}
          </p>
        </div>
      </div>

      {insights.length ? (
        <div className="mt-4 space-y-2 rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.06] p-3">
          {insights.slice(0, 3).map((insight, index) => (
            <p key={`${insight}-${index}`} className="text-xs leading-5 text-emerald-50/88">
              {insight}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-3">
      <p className="text-[11px] text-zinc-400">{label}</p>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
    </div>
  );
}
