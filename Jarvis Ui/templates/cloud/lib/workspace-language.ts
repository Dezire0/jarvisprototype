"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

export const WORKSPACE_LANGUAGES = ["auto", "ko", "en"] as const;
export type WorkspaceLanguage = typeof WORKSPACE_LANGUAGES[number];

export const WorkspaceLanguageContext = createContext<WorkspaceLanguage>("auto");

export function isWorkspaceLanguage(language: unknown): language is WorkspaceLanguage {
  return WORKSPACE_LANGUAGES.some((choice) => choice === language);
}

function subscribe(listener: () => void) {
  window.addEventListener("languagechange", listener);
  return () => window.removeEventListener("languagechange", listener);
}

export function useWorkspaceLocale() {
  const language = useContext(WorkspaceLanguageContext);
  const system = useSyncExternalStore(subscribe, () => navigator.language || "en-US", () => "en-US");
  return language === "ko" ? "ko-KR" : language === "en" ? "en-US" : system;
}
