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
import { LocalTools, type ToolSection } from "@/components/jarvis/local-tools";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { WrenchIcon } from "lucide-react";
import { useRef, useState } from "react";
import { JarvisRuntimeProvider } from "./jarvis-runtime-provider";

export const Assistant = () => {
  const [tools, setTools] = useState<{ section?: ToolSection } | null>(null);
  const toolsTrigger = useRef<HTMLElement | null>(null);
  const isKo = typeof navigator !== "undefined" && navigator.language.startsWith("ko");
  const toolsLabel = isKo ? "로컬 도구" : "Local tools";

  function openTools(section: ToolSection | undefined, trigger: HTMLElement) {
    toolsTrigger.current = trigger;
    setTools({ section });
  }

  return (
    <JarvisRuntimeProvider>
      <JarvisExtensionsProvider>
        <SidebarProvider defaultOpen={false}>
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
                    <button type="button" className="jarvis-toolbar-link" aria-haspopup="dialog"
                      onClick={(event) => openTools(undefined, event.currentTarget)}>
                      <WrenchIcon size={16} aria-hidden="true" />
                      {toolsLabel}
                    </button>
                    <ThemeToggle />
                  </div>
                </header>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <Thread onOpenTools={openTools} />
                </div>
              </main>
            </div>
            <Dialog open={tools !== null} onOpenChange={(open) => { if (!open) setTools(null); }}>
              <DialogContent
                aria-describedby={undefined}
                className="jarvis-tools-dialog block w-full gap-0 overflow-y-auto p-0 motion-reduce:animate-none sm:max-w-xl"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  toolsTrigger.current?.focus();
                }}
              >
                <DialogTitle className="jarvis-tools-dialog-title">{toolsLabel}</DialogTitle>
                <LocalTools embedded initialSection={tools?.section} />
              </DialogContent>
            </Dialog>
          </JarvisVoiceProvider>
        </SidebarProvider>
      </JarvisExtensionsProvider>
    </JarvisRuntimeProvider>
  );
};
