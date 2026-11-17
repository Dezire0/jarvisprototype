export {};

declare global {
  interface Window {
    assistantAPI?: {
      getBootstrap: () => Promise<unknown>;
      getAppState: () => Promise<unknown>;
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
      readHostDiagnostics?: () => Promise<{ cpuPercent: number | null; memoryPercent: number | null }>;
      saveLocalWorkspace?: (serialized: string) => Promise<void>;
      invokeTool: (tool: string, payload?: Record<string, unknown>) => Promise<unknown>;
      onUpdateStatus: (callback: (payload: unknown) => void) => (() => void) | void;
    };
  }
}
