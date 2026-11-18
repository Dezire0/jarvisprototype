"use client";

import { useAui } from "@assistant-ui/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useJarvisVoice } from "@/components/jarvis/voice-provider";
import { useFinishedReplies } from "@/app/jarvis-runtime-provider";
import { useWorkspaceLocale } from "@/lib/workspace-language";
import {
  autoReadEngine, deviceVoices, voiceEngine, voiceLanguage, voiceTextLimit,
  type VoiceEngine, type VoiceLanguage, type VoiceOutputSettings,
} from "@/lib/voice-output";

type Playback = {
  id: string;
  status: "loading" | "playing" | "muted" | "off" | "no-voice" | "failed" | "settings-changed";
};
type VoiceOutput = {
  available: boolean;
  settings: VoiceOutputSettings | null;
  loadFailed: boolean;
  muted: boolean;
  setMuted: (muted: boolean) => Promise<boolean>;
  reload: () => void;
  save: (draft: VoiceOutputSettings) => Promise<VoiceOutputSettings | null>;
  voices: SpeechSynthesisVoice[];
  playback: Playback | null;
  play: (id: string, text: string, language: VoiceLanguage, engine: VoiceEngine) => Promise<void>;
  stop: (id?: string) => void;
};

const VoiceOutputContext = createContext<VoiceOutput | null>(null);
type Operation = { id: string; threadId: string; cancel?: () => void; release?: () => void; timeout?: number };

function releasePlayback(operation: Operation | null) {
  if (!operation) return;
  window.clearTimeout(operation.timeout);
  operation.cancel?.();
  operation.release?.();
}

export function VoiceOutputProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState(false);
  const [settings, setSettings] = useState<VoiceOutputSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const active = useRef<Operation | null>(null);
  const voice = useJarvisVoice();
  const finishedReplies = useFinishedReplies();
  const locale = useWorkspaceLocale().startsWith("ko") ? "ko" : "en";
  const aui = useAui();

  const stop = useCallback((id?: string) => {
    if (!id || active.current?.id === id) {
      const operation = active.current;
      active.current = null;
      releasePlayback(operation);
    }
    setPlayback((current) => !id || current?.id === id ? null : current);
  }, []);

  async function load() {
    const read = window.assistantAPI?.getTtsSettings;
    if (!read) return;
    setLoadFailed(false);
    try {
      const { settings } = await read();
      setSettings(settings);
    } catch {
      setLoadFailed(true);
    }
  }

  useEffect(() => {
    const api = window.assistantAPI;
    setAvailable(Boolean(api?.getTtsSettings && api.saveTtsSettings));
    void load();
    const speech = window.speechSynthesis;
    const refresh = () => setVoices(speech?.getVoices() ?? []);
    refresh();
    const onVisibility = () => { if (document.hidden) stop(); };
    speech?.addEventListener("voiceschanged", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    let mounted = true;
    const applyMute = ({ muted }: { muted: boolean }) => {
      if (!mounted) return;
      setMuted(muted);
      if (muted) stop();
    };
    const unsubscribe = api?.onMuteState?.(applyMute);
    void api?.getMuteState?.().then(applyMute).catch(() => {});
    return () => {
      mounted = false;
      speech?.removeEventListener("voiceschanged", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe?.();
      stop();
    };
  }, [stop]);

  useEffect(() => aui.subscribe(() => {
    const operation = active.current;
    if (operation && operation.threadId !== aui.threads().getState().mainThreadId) stop();
  }), [aui, stop]);
  const onMicrophoneStart = voice.onMicrophoneStart;
  useEffect(() => onMicrophoneStart(() => stop()), [onMicrophoneStart, stop]);

  useEffect(() => {
    if (!finishedReplies || !settings || muted) return;
    const readReply = ({ threadId, id, text }: { threadId: string; id: string; text: string }) => {
      if (document.hidden || threadId !== aui.threads().getState().mainThreadId) return;
      const language = voiceLanguage(text, locale);
      const engine = autoReadEngine(settings.autoRead?.[language], settings.providers[language]);
      if (engine !== "off") void play(id, text, language, engine, true);
    };
    finishedReplies.add(readReply);
    return () => { finishedReplies.delete(readReply); };
  });

  async function save(draft: VoiceOutputSettings) {
    const write = window.assistantAPI?.saveTtsSettings;
    if (!write) return null;
    try {
      const { settings: saved } = await write(draft);
      stop();
      setSettings(saved);
      return saved;
    } catch {
      return null;
    }
  }

  async function changeMuted(requested: boolean) {
    try {
      const state = await window.assistantAPI?.setMuteState?.({ muted: requested });
      if (!state) return false;
      setMuted(state.muted);
      if (state.muted) stop();
      return true;
    } catch {
      return false;
    }
  }

  async function play(id: string, rawText: string, language: VoiceLanguage, engine: VoiceEngine, automatic = false) {
    const text = rawText.trim().slice(0, voiceTextLimit).replace(/[\uD800-\uDBFF]$/, "");
    if (!settings || !text || (automatic && active.current && !active.current.release)) return;
    stop();
    const release = automatic ? voice.beginReplyAudio() : undefined;
    if (release === null) return;
    if (!automatic) voice.stop();
    const operation: Operation = { id, threadId: aui.threads().getState().mainThreadId, release };
    active.current = operation;
    const isCurrent = () => active.current === operation && !document.hidden &&
      operation.threadId === aui.threads().getState().mainThreadId;
    const update = (status: Playback["status"]) => {
      if (!isCurrent()) return;
      if (status === "playing") {
        window.clearTimeout(operation.timeout);
        operation.timeout = window.setTimeout(() => update("failed"), 120000);
      } else {
        active.current = null;
        releasePlayback(operation);
      }
      setPlayback({ id, status });
    };
    setPlayback({ id, status: "loading" });
    operation.timeout = window.setTimeout(() => update("failed"), 20000);
    const api = window.assistantAPI;
    try {
      const mute = await api?.getMuteState?.();
      if (!isCurrent()) return;
      if (mute?.muted) {
        update("muted");
        return;
      }
      const expected = automatic
        ? autoReadEngine(settings.autoRead?.[language], settings.providers[language])
        : voiceEngine(settings.providers[language]);
      if (engine !== expected) {
        update("settings-changed");
        return;
      }
      if (engine === "off") {
        update("off");
        return;
      }
      const finish = () => { if (isCurrent()) stop(id); };
      const fail = () => update("failed");
      if (engine === "system") {
        const speech = window.speechSynthesis;
        const choices = deviceVoices(speech?.getVoices() ?? [], language);
        const selected = settings.systemVoices?.[language];
        const selectedVoice = choices.find(({ voiceURI }) => voiceURI === selected) ??
          (selected ? undefined : choices.find(({ default: isDefault }) => isDefault) ?? choices[0]);
        if (!selectedVoice) {
          update("no-voice");
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
        utterance.onend = finish;
        utterance.onerror = fail;
        operation.cancel = () => {
          utterance.onend = utterance.onerror = null;
          speech.cancel();
        };
        speech.speak(utterance);
        update("playing");
        return;
      }
      const result = await api?.speakWorkspace?.({ language, provider: engine, text, ...(automatic && { automatic: true }) });
      if (!isCurrent()) return;
      if (result?.status !== "audio") {
        update(result?.status === "muted" || result?.status === "off" || result?.status === "settings-changed"
          ? result.status : "failed");
        return;
      }
      const audio = new Audio(`data:${result.mimeType};base64,${result.audioBase64}`);
      audio.onended = finish;
      audio.onerror = fail;
      operation.cancel = () => {
        audio.onended = audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
      };
      await audio.play();
      update("playing");
    } catch {
      update("failed");
    }
  }

  return <VoiceOutputContext.Provider value={{
    available, settings, loadFailed, muted, setMuted: changeMuted, reload: () => { void load(); }, save, voices, playback, play, stop,
  }}>{children}</VoiceOutputContext.Provider>;
}

export function useVoiceOutput() {
  const output = useContext(VoiceOutputContext);
  if (!output) throw new Error("Voice output is not available here.");
  return output;
}

export function VoicePlaybackStatus({ playback, ko }: { playback?: Playback | null; ko: boolean }) {
  if (!playback) return null;
  const messages: Record<Playback["status"], [string, string]> = {
    loading: ["음성을 준비하는 중…", "Preparing audio…"],
    playing: ["읽는 중", "Reading aloud"],
    muted: ["Jarvis 음소거를 해제한 뒤 다시 시도하세요.", "Unmute Jarvis and try again."],
    off: ["이 언어의 음성 출력이 꺼져 있습니다.", "Voice output is off for this language."],
    "no-voice": ["이 언어에 설치된 기기 음성을 선택하세요.", "Choose an installed device voice for this language."],
    failed: ["읽어주지 못했습니다. 음성 설정을 확인하고 다시 시도하세요.", "Couldn’t play audio. Check Voice output and try again."],
    "settings-changed": ["음성 설정이 바뀌었습니다. 설정을 다시 열어주세요.", "Voice settings changed. Open Voice output again."],
  };
  return <p role="status" className="text-xs text-muted-foreground">{messages[playback.status][ko ? 0 : 1]}</p>;
}
