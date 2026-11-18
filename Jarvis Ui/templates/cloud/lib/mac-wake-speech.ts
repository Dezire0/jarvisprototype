import type { BrowserRecognition } from "@/lib/wake-word";

export type MacWakeSpeechEvent = { id: string } & (
  { type: "ready" | "end" } |
  { type: "transcript"; text: string } |
  { type: "error"; reason: string }
);

export async function macWakeAvailability(locale: string) {
  try {
    const result = await window.assistantAPI?.probeMacWakeSpeech?.(locale);
    return result?.status === "available";
  } catch {
    return false;
  }
}

export function createMacWakeRecognition(): BrowserRecognition | null {
  const api = window.assistantAPI;
  if (!api?.startMacWakeSpeech || !api.stopMacWakeSpeech || !api.onMacWakeSpeech) return null;
  const { startMacWakeSpeech, stopMacWakeSpeech, onMacWakeSpeech } = api;
  const id = crypto.randomUUID();
  let unsubscribe: (() => void) | undefined;
  let started: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  let ended = false;

  function finish() {
    if (ended) return;
    ended = true;
    unsubscribe?.();
    recognition.onend?.();
  }

  const recognition: BrowserRecognition = {
    lang: "",
    continuous: true,
    interimResults: false,
    maxAlternatives: 1,
    onstart: null,
    onend: null,
    onerror: null,
    onresult: null,
    start() {
      unsubscribe = onMacWakeSpeech((event) => {
        if (event.id !== id || ended) return;
        if (event.type === "end") {
          if (!stopping) recognition.onerror?.({ error: "inactive" });
          finish();
        }
        if (stopping || ended) return;
        if (event.type === "ready") recognition.onstart?.();
        if (event.type === "transcript") recognition.onresult?.({
          resultIndex: 0,
          results: [Object.assign([{ transcript: event.text }], { isFinal: true })],
        });
        if (event.type === "error") recognition.onerror?.({ error: event.reason });
      });
      started = startMacWakeSpeech({ id, locale: recognition.lang }).then((result) => {
        if (!stopping && !ended && !result.ok) recognition.onerror?.({ error: result.reason });
      }).catch(() => {
        if (!stopping && !ended) recognition.onerror?.({ error: "unavailable" });
      });
    },
    stop() {
      return stopping ??= Promise.resolve(started)
        .then(() => ended ? undefined : stopMacWakeSpeech(id))
        .finally(finish);
    },
    abort() { return Promise.resolve(recognition.stop()).catch(() => {}); },
  };
  return recognition;
}
