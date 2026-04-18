"use client";

import { Thread } from "@/components/assistant-ui/thread";
import {
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { JarvisVoiceProvider } from "@/components/jarvis/voice-provider";
import { ThemeToggle } from "@/components/jarvis/theme-toggle";
import { SparklesIcon } from "lucide-react";
import { JarvisRuntimeProvider } from "./jarvis-runtime-provider";

export const Assistant = () => {
  return (
    <JarvisRuntimeProvider>
      <SidebarProvider>
        <JarvisVoiceProvider>
          <div className="aui-app-shell flex h-dvh w-full bg-background text-foreground">
            <ThreadListSidebar />
            <main className="aui-app-main relative flex min-w-0 flex-1 flex-col">
              <header className="aui-app-header flex items-center justify-between gap-3 px-4 py-3 md:px-6">
                <div className="flex items-center gap-2">
                  <SidebarTrigger className="rounded-full border border-border/70 bg-card/70 p-2 text-foreground transition hover:bg-accent md:hidden" />
                  <div className="hidden items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-sm text-muted-foreground md:inline-flex">
                    <SparklesIcon className="size-4 text-foreground" />
                    <span>Jarvis conversation workspace</span>
                  </div>
                </div>
                <ThemeToggle />
              </header>
              <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3 md:px-4 md:pb-4">
                <Thread />
              </div>
            </main>
          </div>
        </JarvisVoiceProvider>
      </SidebarProvider>
    </JarvisRuntimeProvider>
  );
};
