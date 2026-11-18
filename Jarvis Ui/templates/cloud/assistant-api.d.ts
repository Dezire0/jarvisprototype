import type { ConversationModelDraft, ConversationModelSettings, ModelAvailability, ModelConnectionResult } from "@/components/jarvis/model-settings";

export {};

declare global {
  interface Window {
    assistantAPI?: {
      getBootstrap: () => Promise<unknown>;
      getAppState: () => Promise<unknown>;
      getComputerControl?: () => Promise<boolean>;
      setComputerControl?: (enabled: boolean) => Promise<boolean>;
      getConversationModelSettings?: () => Promise<{ settings: ConversationModelSettings; availability: ModelAvailability }>;
      saveConversationModelSettings?: (draft: ConversationModelDraft) => Promise<{ settings: ConversationModelSettings }>;
      testConversationModel?: () => Promise<ModelConnectionResult>;
      getLivePreview: () => Promise<{
        ok?: boolean;
        source?: string;
        imageDataUrl?: string;
        title?: string;
        url?: string;
        error?: string;
      }>;
      checkForUpdates: () => Promise<unknown>;
      installUpdate: () => Promise<unknown>;
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
      invokeTool: (tool: string, payload?: Record<string, unknown>) => Promise<unknown>;
      onUpdateStatus: (callback: (payload: unknown) => void) => (() => void) | void;
    };
  }
}
