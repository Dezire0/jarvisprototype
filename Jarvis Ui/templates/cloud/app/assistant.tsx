"use client";

import { Thread } from "@/components/assistant-ui/thread";
import {
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { JarvisExtensionsProvider } from "@/components/jarvis/extensions-provider";
import { JarvisVoiceProvider } from "@/components/jarvis/voice-provider";
import { ThemeToggle } from "@/components/jarvis/theme-toggle";
import { LocalToolsLink } from "@/components/jarvis/local-tools-link";
import { JarvisRuntimeProvider } from "./jarvis-runtime-provider";

export const Assistant = () => {
  return (
    <JarvisRuntimeProvider>
      <JarvisExtensionsProvider>
        <SidebarProvider>
          <JarvisVoiceProvider>
            <div className="aui-app-shell flex h-dvh w-full bg-background text-foreground">
              <ThreadListSidebar />
              <main className="aui-app-main relative flex min-w-0 flex-1 flex-col">
                <header className="jarvis-toolbar">
                  <div className="flex min-w-0 items-center gap-2">
                    <SidebarTrigger className="jarvis-icon-button" />
                    <span className="truncate font-semibold">Jarvis</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <LocalToolsLink />
                    <ThemeToggle />
                  </div>
                </header>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <Thread />
                </div>
              </main>
            </div>
          </JarvisVoiceProvider>
        </SidebarProvider>
      </JarvisExtensionsProvider>
    </JarvisRuntimeProvider>
  );
};
