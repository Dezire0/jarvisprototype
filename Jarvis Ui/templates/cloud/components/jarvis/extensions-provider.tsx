"use client";

import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";

type ExtensionsSummary = {
  connectors: number;
  skills: number;
  webhooks: number;
};

type ConnectorExtension = {
  kind: "connector";
  name: string;
  description: string;
  canonicalName: string;
  aliases: string[];
  planningHints: string[];
  filePath: string;
};

type SkillExtension = {
  kind: "skill";
  name: string;
  description: string;
  apps: string[];
  instructions: string;
  planningHints: string[];
  filePath: string;
};

type WebhookExtension = {
  kind: "webhook";
  name: string;
  description: string;
  phrases: string[];
  regex: string[];
  method: string;
  responsePath: string;
  successReply: string;
  filePath: string;
};

type ExtensionsRegistry = {
  connectors: ConnectorExtension[];
  skills: SkillExtension[];
  webhooks: WebhookExtension[];
  loadedFiles: string[];
};

type ExtensionsBootstrap = {
  capabilities?: {
    extensions?: Partial<ExtensionsSummary>;
  };
};

type JarvisExtensionsContextValue = {
  available: boolean;
  status: "loading" | "ready" | "unavailable" | "error";
  refreshing: boolean;
  error: string | null;
  summary: ExtensionsSummary;
  registry: ExtensionsRegistry;
  reload: () => Promise<void>;
};

const EMPTY_SUMMARY: ExtensionsSummary = {
  connectors: 0,
  skills: 0,
  webhooks: 0,
};

const EMPTY_REGISTRY: ExtensionsRegistry = {
  connectors: [],
  skills: [],
  webhooks: [],
  loadedFiles: [],
};

const JarvisExtensionsContext = createContext<JarvisExtensionsContextValue | null>(
  null,
);

function sanitizeSummary(summary?: Partial<ExtensionsSummary>): ExtensionsSummary {
  return {
    connectors: Number(summary?.connectors) || 0,
    skills: Number(summary?.skills) || 0,
    webhooks: Number(summary?.webhooks) || 0,
  };
}

function sanitizeRegistry(value: unknown): ExtensionsRegistry {
  if (!value || typeof value !== "object") {
    return EMPTY_REGISTRY;
  }

  const registry = value as Partial<ExtensionsRegistry>;

  return {
    connectors: Array.isArray(registry.connectors) ? registry.connectors : [],
    skills: Array.isArray(registry.skills) ? registry.skills : [],
    webhooks: Array.isArray(registry.webhooks) ? registry.webhooks : [],
    loadedFiles: Array.isArray(registry.loadedFiles) ? registry.loadedFiles : [],
  };
}

function getAssistantApi() {
  if (typeof window === "undefined") {
    return null;
  }

  return (window as any).assistantAPI ?? null;
}

export function JarvisExtensionsProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<
    JarvisExtensionsContextValue["status"]
  >("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ExtensionsSummary>(EMPTY_SUMMARY);
  const [registry, setRegistry] = useState<ExtensionsRegistry>(EMPTY_REGISTRY);

  async function syncExtensions({ reload = false } = {}) {
    const assistantApi = getAssistantApi();

    if (!assistantApi) {
      setAvailable(false);
      setRefreshing(false);
      setStatus("unavailable");
      setError("브라우저 프리뷰에서는 데스크톱 확장 기능을 읽을 수 없어요.");
      setSummary(EMPTY_SUMMARY);
      setRegistry(EMPTY_REGISTRY);
      return;
    }

    try {
      setAvailable(true);
      setError(null);
      setStatus((current) => (current === "ready" ? current : "loading"));
      setRefreshing(reload);

      if (reload) {
        await assistantApi.invokeTool("extensions:reload");
      }

      const [bootstrapResult, registryResult] = await Promise.all([
        assistantApi.getBootstrap(),
        assistantApi.invokeTool("extensions:list"),
      ]);

      const bootstrap = (bootstrapResult || {}) as ExtensionsBootstrap;
      const nextRegistry = sanitizeRegistry(registryResult);
      const summaryFromBootstrap = sanitizeSummary(
        bootstrap.capabilities?.extensions,
      );

      setSummary({
        connectors:
          summaryFromBootstrap.connectors || nextRegistry.connectors.length,
        skills: summaryFromBootstrap.skills || nextRegistry.skills.length,
        webhooks: summaryFromBootstrap.webhooks || nextRegistry.webhooks.length,
      });
      setRegistry(nextRegistry);
      setStatus("ready");
    } catch (syncError) {
      setStatus("error");
      setError(
        syncError instanceof Error
          ? syncError.message
          : "확장 기능 정보를 불러오지 못했어요.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialState() {
      const assistantApi = getAssistantApi();

      if (!assistantApi) {
        if (!cancelled) {
          setAvailable(false);
          setStatus("unavailable");
          setError("브라우저 프리뷰에서는 데스크톱 확장 기능을 읽을 수 없어요.");
        }

        return;
      }

      try {
        const [bootstrapResult, registryResult] = await Promise.all([
          assistantApi.getBootstrap(),
          assistantApi.invokeTool("extensions:list"),
        ]);

        if (cancelled) {
          return;
        }

        const bootstrap = (bootstrapResult || {}) as ExtensionsBootstrap;
        const nextRegistry = sanitizeRegistry(registryResult);
        const summaryFromBootstrap = sanitizeSummary(
          bootstrap.capabilities?.extensions,
        );

        setAvailable(true);
        setError(null);
        setSummary({
          connectors:
            summaryFromBootstrap.connectors || nextRegistry.connectors.length,
          skills: summaryFromBootstrap.skills || nextRegistry.skills.length,
          webhooks:
            summaryFromBootstrap.webhooks || nextRegistry.webhooks.length,
        });
        setRegistry(nextRegistry);
        setStatus("ready");
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setAvailable(true);
        setStatus("error");
        setError(
          loadError instanceof Error
            ? loadError.message
            : "확장 기능 정보를 불러오지 못했어요.",
        );
      }
    }

    void loadInitialState();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <JarvisExtensionsContext.Provider
      value={{
        available,
        status,
        refreshing,
        error,
        summary,
        registry,
        reload: async () => {
          await syncExtensions({
            reload: true,
          });
        },
      }}
    >
      {children}
    </JarvisExtensionsContext.Provider>
  );
}

export function useJarvisExtensions() {
  const context = useContext(JarvisExtensionsContext);

  if (!context) {
    throw new Error(
      "useJarvisExtensions must be used within JarvisExtensionsProvider",
    );
  }

  return context;
}
