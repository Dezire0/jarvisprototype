export type WakeEngine = "device" | "browser";
export type WakeAvailability = "available" | "downloadable" | "downloading" | "unavailable";
export const wakeFollowUpMs = 8000;

export type BrowserRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  processLocally?: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<ArrayLike<{ transcript?: string }> & { isFinal?: boolean }>;
  }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type LocalSpeechOptions = { langs: string[]; processLocally: true };
type RecognitionConstructor = {
  new (): BrowserRecognition;
  available?: (options: LocalSpeechOptions) => Promise<WakeAvailability>;
  install?: (options: LocalSpeechOptions) => Promise<boolean>;
};

export function getRecognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const browser = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null;
}

function localOptions(locale: string): LocalSpeechOptions {
  return { langs: [locale], processLocally: true };
}

export async function localWakeAvailability(locale: string) {
  const Recognition = getRecognitionConstructor();
  if (!Recognition?.available) return "unavailable";
  try {
    if (!("processLocally" in new Recognition())) return "unavailable";
    const result = await Recognition.available(localOptions(locale));
    if (result === "downloadable" && !Recognition.install) return "unavailable";
    return result === "available" || result === "downloadable" || result === "downloading" ? result : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function installWakeLanguage(locale: string) {
  const Recognition = getRecognitionConstructor();
  try {
    return Boolean(await Recognition?.install?.(localOptions(locale)));
  } catch {
    return false;
  }
}

export function resolveWakeUtterance(transcript: string, awaitingCommand: boolean):
  { kind: "ignore" | "follow-up" } | { kind: "command"; text: string } {
  const text = transcript.trim();
  if (!text) return { kind: "ignore" };
  const prefix = /^(?:(?:hey[ \t,，]+)?jarvis|(?:헤이[ \t,，]*)?자비스)(?=$|[\s,.:!?，。！？])[\s,.:!?，。！？]*/iu.exec(text);
  if (!prefix) return awaitingCommand ? { kind: "command", text } : { kind: "ignore" };
  const command = text.slice(prefix[0].length).trim();
  return command ? { kind: "command", text: command } : { kind: "follow-up" };
}
