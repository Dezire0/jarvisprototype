import type { ConversationModelDraft, ConversationModelSettings, ModelAvailability, ModelConnectionResult } from "@/components/jarvis/model-settings";
import type { DesktopUpdateResult, DesktopUpdateStatus } from "@/components/jarvis/desktop-update-control";
import type { SavedMemoryReview } from "@/components/jarvis/saved-memory-control";
import type { VoiceOutputSettings, VoicePayload, VoiceResponse } from "@/lib/voice-output";
import type { MacWakeSpeechEvent } from "@/lib/mac-wake-speech";

export {};

declare global {
  interface Window {
    assistantAPI?: {
      getBootstrap: () => Promise<unknown>;
      getAppState: () => Promise<{ version: string; updater: DesktopUpdateStatus | null }>;
      getComputerControl?: () => Promise<boolean>;
      reviewSavedMemory?: (accountId: string) => Promise<SavedMemoryReview>;
      clearSavedMemory?: (accountId: string, revision: string) => Promise<SavedMemoryReview | null>;
      setComputerControl?: (enabled: boolean) => Promise<boolean>;
      probeMacWakeSpeech?: (locale: string) => Promise<{ status: "available" | "unavailable" }>;
      startMacWakeSpeech?: (request: { id: string; locale: string }) => Promise<{ ok: boolean; reason?: string }>;
      stopMacWakeSpeech?: (id: string) => Promise<void>;
      onMacWakeSpeech?: (callback: (event: MacWakeSpeechEvent) => void) => (() => void);
      getConversationModelSettings?: () => Promise<{ settings: ConversationModelSettings; availability: ModelAvailability }>;
      saveConversationModelSettings?: (draft: ConversationModelDraft) => Promise<{ settings: ConversationModelSettings }>;
      testConversationModel?: () => Promise<ModelConnectionResult>;
      getTtsSettings?: () => Promise<{ settings: VoiceOutputSettings }>;
      saveTtsSettings?: (draft: VoiceOutputSettings) => Promise<{ settings: VoiceOutputSettings }>;
      speakWorkspace?: (payload: VoicePayload) => Promise<VoiceResponse>;
      getMuteState?: () => Promise<{ muted: boolean }>;
      setMuteState?: (state: { muted: boolean }) => Promise<{ muted: boolean }>;
      onMuteState?: (callback: (state: { muted: boolean }) => void) => (() => void);
      getLivePreview: () => Promise<{
        ok?: boolean;
        source?: string;
        imageDataUrl?: string;
        title?: string;
        url?: string;
        error?: string;
      }>;
      checkForUpdates: () => Promise<DesktopUpdateStatus | null>;
      installUpdate: () => Promise<DesktopUpdateResult | null>;
      transcribeAudio: (payload: {
        audioBase64: string;
        mimeType: string;
        language?: string;
      }) => Promise<{
        provider?: string;
        text?: string;
      }>;
      loadLocalWorkspace?: () => Promise<string | null>;
      loadChatHistory?: (accountId: string) => Promise<string | null>;
      saveChatHistory?: (accountId: string, serialized: string) => Promise<void>;
      readHostDiagnostics?: () => Promise<{ cpuPercent: number | null; memoryPercent: number | null }>;
      saveLocalWorkspace?: (serialized: string) => Promise<void>;
      onFocusCommandInput?: (callback: () => void) => () => void;
      invokeTool: (tool: string, payload?: Record<string, unknown>) => Promise<unknown>;
      onUpdateStatus: (callback: (payload: DesktopUpdateStatus) => void) => (() => void) | void;
    };
  }
}
