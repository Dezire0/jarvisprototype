export {};

declare global {
  interface Window {
    assistantAPI?: {
      getBootstrap: () => Promise<unknown>;
      invokeTool: (tool: string, payload?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}
