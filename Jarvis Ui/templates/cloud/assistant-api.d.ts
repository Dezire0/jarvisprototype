export {};

declare global {
  interface Window {
    assistantAPI?: {
      getBootstrap: () => Promise<unknown>;
      getAppState: () => Promise<unknown>;
      checkForUpdates: () => Promise<unknown>;
      installUpdate: () => Promise<unknown>;
      invokeTool: (tool: string, payload?: Record<string, unknown>) => Promise<unknown>;
      onUpdateStatus: (callback: (payload: unknown) => void) => (() => void) | void;
    };
  }
}
