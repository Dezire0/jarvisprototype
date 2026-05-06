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
      invokeTool: (tool: string, payload?: Record<string, unknown>) => Promise<unknown>;
      onUpdateStatus: (callback: (payload: unknown) => void) => (() => void) | void;
    };
  }
}
