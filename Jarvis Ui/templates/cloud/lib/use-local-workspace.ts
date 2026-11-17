"use client";

import { useEffect, useRef, useState } from "react";
import { emptyWorkspace, readWorkspace, workspaceKey, type Workspace } from "./local-workspace";

function loadBrowserWorkspace() {
  return readWorkspace(window.localStorage.getItem(workspaceKey));
}

export type LocalWorkspace = ReturnType<typeof useLocalWorkspace>;

export function useLocalWorkspace() {
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [nativeStorage, setNativeStorage] = useState(false);
  const latest = useRef(emptyWorkspace);
  const nativeReadSucceeded = useRef(false);
  const latestSave = useRef(0);

  useEffect(() => {
    let mounted = true;
    const bridge = window.assistantAPI;
    const loadNative = bridge?.loadLocalWorkspace;
    const useNative = Boolean(loadNative && bridge?.saveLocalWorkspace);
    setNativeStorage(useNative);

    async function syncWorkspace() {
      try {
        const persisted = useNative && loadNative ? await loadNative() : null;
        if (!mounted) return;
        nativeReadSucceeded.current = useNative;
        const next = persisted === null ? loadBrowserWorkspace() : readWorkspace(persisted);
        latest.current = next;
        setWorkspace(next);
        setStorageAvailable(true);
      } catch {
        if (mounted) setStorageAvailable(false);
      } finally {
        if (mounted) setWorkspaceReady(true);
      }
    }

    void syncWorkspace();
    function onStorage(event: StorageEvent) {
      if (!useNative && (event.key === null || event.key === workspaceKey)) void syncWorkspace();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      mounted = false;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function latestWorkspace() {
    if (nativeStorage || !storageAvailable) return latest.current;
    try {
      return loadBrowserWorkspace();
    } catch {
      setStorageAvailable(false);
      return latest.current;
    }
  }

  async function saveWorkspace(next: Workspace, restoreOnFailure?: Workspace): Promise<boolean> {
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
  }

  return { workspace, workspaceReady, storageAvailable, nativeStorage, latestWorkspace, saveWorkspace };
}
