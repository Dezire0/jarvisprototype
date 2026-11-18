"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { activityLabels, completeExpiredTimer, emptyWorkspace, readWorkspace, workspaceKey, type Workspace } from "./local-workspace";
import { speakLocalResult } from "./local-speech";
import { useWorkspaceLocale } from "./workspace-language";

function loadBrowserWorkspace() {
  return readWorkspace(window.localStorage.getItem(workspaceKey));
}

export type LocalWorkspace = ReturnType<typeof useLocalWorkspace>;

export function useLocalWorkspace() {
  const locale = useWorkspaceLocale();
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [nativeStorage, setNativeStorage] = useState(false);
  const latest = useRef(emptyWorkspace);
  const nativeReadSucceeded = useRef(false);
  const latestSave = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    let currentView = true;
    mounted.current = true;
    const bridge = window.assistantAPI;
    const loadNative = bridge?.loadLocalWorkspace;
    const useNative = Boolean(loadNative && bridge?.saveLocalWorkspace);
    setNativeStorage(useNative);

    async function syncWorkspace() {
      try {
        const persisted = useNative && loadNative ? await loadNative() : null;
        if (!currentView) return;
        nativeReadSucceeded.current = useNative;
        const next = persisted === null ? loadBrowserWorkspace() : readWorkspace(persisted);
        latest.current = next;
        setWorkspace(next);
        setStorageAvailable(true);
      } catch {
        if (currentView) setStorageAvailable(false);
      } finally {
        if (currentView) setWorkspaceReady(true);
      }
    }

    void syncWorkspace();
    function onStorage(event: StorageEvent) {
      if (!useNative && (event.key === null || event.key === workspaceKey)) void syncWorkspace();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      currentView = false;
      mounted.current = false;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const latestWorkspace = useCallback(() => {
    if (nativeStorage || !storageAvailable) return latest.current;
    try {
      return loadBrowserWorkspace();
    } catch {
      setStorageAvailable(false);
      return latest.current;
    }
  }, [nativeStorage, storageAvailable]);

  const saveWorkspace = useCallback(async (next: Workspace, restoreOnFailure?: Workspace): Promise<boolean> => {
    setWorkspace(next);
    latest.current = next;
    const serialized = JSON.stringify(next);
    const save = ++latestSave.current;
    try {
      if (nativeStorage && window.assistantAPI?.saveLocalWorkspace) {
        if (!nativeReadSucceeded.current) throw new Error("Read the workspace before saving it.");
        await window.assistantAPI.saveLocalWorkspace(serialized);
      } else {
        window.localStorage.setItem(workspaceKey, serialized);
      }
      if (save === latestSave.current) setStorageAvailable(true);
      return true;
    } catch {
      if (save === latestSave.current) {
        setStorageAvailable(false);
        if (restoreOnFailure) {
          latest.current = restoreOnFailure;
          setWorkspace(restoreOnFailure);
        }
      }
      return false;
    }
  }, [nativeStorage]);

  const deadline = workspace.timer.endsAt;
  useEffect(() => {
    if (!workspaceReady || deadline === null) return;

    let active = true;
    let timer: number | undefined;
    const complete = () => {
      if (!active) return;
      const now = Date.now();
      if (now < deadline) {
        check();
        return;
      }
      const current = latestWorkspace();
      const next = completeExpiredTimer(current, deadline, now);
      if (next === current) return;
      void saveWorkspace(next).then((saved) => {
        if (!saved || !mounted.current) return;
        const persisted = latestWorkspace();
        if (persisted.timer.completedAt === deadline && persisted.speakResults) {
          const label = activityLabels["timer-complete"][locale.startsWith("ko") ? 0 : 1];
          speakLocalResult(label, locale, false);
        }
      });
    };

    const check = () => {
      window.clearTimeout(timer);
      const wait = deadline - Date.now();
      if (wait > 0) {
        timer = window.setTimeout(check, Math.min(wait, 2_147_483_647));
        return;
      }
      if (!nativeStorage && navigator.locks) {
        void navigator.locks.request(workspaceKey, complete).catch(complete);
      } else {
        complete();
      }
    };

    check();
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [deadline, workspaceReady, nativeStorage, latestWorkspace, saveWorkspace, locale]);

  return { workspace, workspaceReady, storageAvailable, nativeStorage, latestWorkspace, saveWorkspace };
}
