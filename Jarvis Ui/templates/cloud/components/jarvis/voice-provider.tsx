"use client";

import { useWorkspaceLocale } from "@/lib/workspace-language";

import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import type { ComposerCommandHandler } from "@/lib/local-workspace";
import {
  getRecognitionConstructor, resolveWakeUtterance, wakeFollowUpMs,
  type BrowserRecognition, type WakeEngine,
} from "@/lib/wake-word";

type VoiceStatus =
  | "idle"
  | "starting"
  | "listening"
  | "processing"
  | "unsupported"
  | "error";

type AssistantApiBridge = {
  getBootstrap?: () => Promise<{
    providers?: {
      stt?: string;
    };
  }>;
  transcribeAudio?: (payload: {
    audioBase64: string;
    mimeType: string;
    language?: string;
  }) => Promise<{
    provider?: string;
    text?: string;
  }>;
};

type VoiceSession = { threadId: string; keepContinuous: boolean; wakeEngine?: WakeEngine };

type VoiceContextValue = {
  supported: boolean;
  status: VoiceStatus;
  transcript: string;
  error: string;
  reviewPending: boolean;
  continuous: boolean;
  wakeEngine: WakeEngine | null;
  awaitingWakeCommand: boolean;
  armWake: (engine: WakeEngine) => void;
  waitingForReplyAudio: boolean;
  beginReplyAudio: () => (() => void) | null;
  onMicrophoneStart: (listener: () => void) => (() => void);
  startOnce: () => void;
  toggleContinuous: () => void;
  stop: () => void;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

function getAssistantBridge(): AssistantApiBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  return ((window as typeof window & {
    assistantAPI?: AssistantApiBridge;
  }).assistantAPI || null);
}

function canUseAssistantSttBridge() {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(
    getAssistantBridge()?.transcribeAudio &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined",
  );
}

export function JarvisVoiceProvider({
  children,
  runLocalCommand,
}: PropsWithChildren<{ runLocalCommand?: ComposerCommandHandler }>) {
  const locale = useWorkspaceLocale();
  const aui = useAui();
  const isThreadRunning = useAuiState((state) => state.thread.isRunning);
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [reviewPending, setReviewPending] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [wakeEngine, setWakeEngine] = useState<WakeEngine | null>(null);
  const [awaitingWakeCommand, setAwaitingWakeCommand] = useState(false);
  const [waitingForReplyAudio, setWaitingForReplyAudio] = useState(false);
  const [sttProviderLabel, setSttProviderLabel] = useState("web-speech-only");
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderAudioContextRef = useRef<AudioContext | null>(null);
  const recorderAnalyserRef = useRef<AnalyserNode | null>(null);
  const recorderSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recorderSilenceIntervalRef = useRef<number | null>(null);
  const recorderSilenceTimeoutRef = useRef<number | null>(null);
  const recorderMaxTimeoutRef = useRef<number | null>(null);
  const recorderHeardSpeechRef = useRef(false);
  const recorderSilenceStartedAtRef = useRef(0);
  const shouldResumeRef = useRef(false);
  const sessionRef = useRef<VoiceSession | null>(null);
  const wakeWindow = useRef<number | null>(null);
  const replyAudio = useRef<object | null>(null);
  const microphoneStartListeners = useRef(new Set<() => void>());
  const onMicrophoneStart = useCallback((listener: () => void) => {
    const listeners = microphoneStartListeners.current;
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  const currentThreadId = () => aui.threads().getState().mainThreadId;
  const isCurrent = (session: VoiceSession) => sessionRef.current === session &&
    session.threadId === currentThreadId() && !document.hidden;

  useEffect(() => {
    const available = canUseAssistantSttBridge() || Boolean(getRecognitionConstructor());
    setSupported(available);
    setStatus(available ? "idle" : "unsupported");
  }, []);

  async function refreshSttProviderLabel() {
    try {
      const bootstrap = await getAssistantBridge()?.getBootstrap?.();
      setSttProviderLabel(String(bootstrap?.providers?.stt || "web-speech-only"));
    } catch (_error) {
      setSttProviderLabel("web-speech-only");
    }
  }

  useEffect(() => {
    void refreshSttProviderLabel();

    const handleSettingsSaved = () => {
      void refreshSttProviderLabel();
    };

    window.addEventListener("jarvis:conversation-model-settings-saved", handleSettingsSaved);

    return () => {
      window.removeEventListener("jarvis:conversation-model-settings-saved", handleSettingsSaved);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = aui.subscribe(() => {
      const session = sessionRef.current;
      if (session && session.threadId !== currentThreadId()) stopRecognition();
    });
    const onVisibilityChange = () => {
      if (document.hidden) stopRecognition();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", stopRecognition);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", stopRecognition);
      if (wakeWindow.current !== null) window.clearTimeout(wakeWindow.current);
      releaseVoiceSession();
    };
  }, [aui]);

  useEffect(() => {
    const session = sessionRef.current;
    if ((!continuous && !wakeEngine) || isThreadRunning || status !== "idle" ||
        waitingForReplyAudio || !session || !shouldResumeRef.current) {
      return;
    }

    const restartTimer = window.setTimeout(() => {
      if (isCurrent(session) && shouldResumeRef.current && !replyAudio.current && !aui.thread().getState().isRunning) {
        startRecognition(continuous, wakeEngine ?? undefined);
      }
    }, 420);

    return () => {
      window.clearTimeout(restartTimer);
    };
  }, [aui, continuous, isThreadRunning, status, waitingForReplyAudio, wakeEngine]);

  function beginReplyAudio() {
    if (document.hidden || status === "starting" || status === "listening" || status === "processing" ||
        recorderStreamRef.current || replyAudio.current) return null;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try { recognition?.abort(); } catch { /* Recognition may already have ended. */ }
    const ticket = {};
    replyAudio.current = ticket;
    setWaitingForReplyAudio(true);
    return () => {
      if (replyAudio.current !== ticket) return;
      replyAudio.current = null;
      setWaitingForReplyAudio(false);
    };
  }

  function hasConfiguredAssistantStt() {
    return canUseAssistantSttBridge() && sttProviderLabel.startsWith("cloud-stt:");
  }

  function clearRecorderTimers() {
    if (recorderSilenceIntervalRef.current) {
      window.clearInterval(recorderSilenceIntervalRef.current);
      recorderSilenceIntervalRef.current = null;
    }

    if (recorderSilenceTimeoutRef.current) {
      window.clearTimeout(recorderSilenceTimeoutRef.current);
      recorderSilenceTimeoutRef.current = null;
    }

    if (recorderMaxTimeoutRef.current) {
      window.clearTimeout(recorderMaxTimeoutRef.current);
      recorderMaxTimeoutRef.current = null;
    }
  }

  async function disposeRecorderResources() {
    clearRecorderTimers();
    const source = recorderSourceRef.current;
    const context = recorderAudioContextRef.current;
    const stream = recorderStreamRef.current;
    recorderSourceRef.current = null;
    recorderAudioContextRef.current = null;
    recorderStreamRef.current = null;
    recorderAnalyserRef.current = null;
    recorderRef.current = null;
    recorderChunksRef.current = [];
    recorderHeardSpeechRef.current = false;
    recorderSilenceStartedAtRef.current = 0;

    try {
      source?.disconnect();
    } catch {
      // The source may already have disconnected during recorder cleanup.
    }
    stream?.getTracks().forEach((track) => track.stop());
    await context?.close().catch(() => {});
  }

  function stopRecorderRecognition() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function releaseVoiceSession() {
    sessionRef.current = null;
    shouldResumeRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.abort();
    } catch {
      // Recognition may already have ended.
    }
    stopRecorderRecognition();
    void disposeRecorderResources();
  }

  function stopRecognition() {
    releaseVoiceSession();
    disarmWake();
    setContinuous(false);
    setTranscript("");
    setError("");
    setReviewPending(false);
    setStatus((current) => current === "unsupported" ? current : "idle");
  }

  function clearWakeWindow() {
    if (wakeWindow.current !== null) window.clearTimeout(wakeWindow.current);
    wakeWindow.current = null;
    setAwaitingWakeCommand(false);
  }

  function disarmWake() {
    clearWakeWindow();
    setWakeEngine(null);
  }

  function openWakeWindow() {
    clearWakeWindow();
    setAwaitingWakeCommand(true);
    wakeWindow.current = window.setTimeout(clearWakeWindow, wakeFollowUpMs);
  }

  function failWake(reason: string) {
    stopRecognition();
    setStatus("error");
    const ko = locale.startsWith("ko");
    if (reason === "not-allowed" || reason === "service-not-allowed" || reason === "audio-capture") {
      setError(ko ? "마이크를 사용할 수 없습니다. 시스템 권한과 입력 장치를 확인하세요."
        : "Microphone unavailable. Check system permission and the input device.");
    } else if (reason === "language-not-supported") {
      setError(ko ? "기기 음성 인식 언어를 확인하고 호출어 듣기를 다시 시작하세요."
        : "Check the on-device language pack and start Wake word again.");
    } else {
      setError(ko ? "음성 인식이 중지되었습니다. 호출어 듣기를 다시 시작하세요."
        : "Speech recognition ended. Start Wake word again.");
    }
  }

  function finalizeTranscript(value: string, session: VoiceSession) {
    if (!isCurrent(session)) return;
    const normalized = value.trim();

    if (!normalized) {
      setStatus("error");
      setError("말소리를 제대로 듣지 못했어요. 조금 더 또렷하게 말씀해 주세요.");
      return;
    }

    setTranscript(normalized);
    setError("");
    setStatus("idle");
    const composer = aui.thread().composer();
    const { text, attachments, quote } = composer.getState();
    if (text || attachments.length || quote || aui.thread().getState().isRunning) {
      shouldResumeRef.current = false;
      setContinuous(false);
      if (session.wakeEngine) disarmWake();
      composer.setText(text ? `${text}\n${normalized}` : normalized);
      setReviewPending(true);
      return;
    }

    const destination = runLocalCommand?.(normalized, {
      hasAttachmentsOrQuote: false,
      allowSpeech: !session.keepContinuous && !session.wakeEngine,
    });
    shouldResumeRef.current = (session.keepContinuous || Boolean(session.wakeEngine)) && destination !== "retry";
    if (destination === "local") return;
    composer.setText(normalized);
    if (destination === "retry") {
      setContinuous(false);
      if (session.wakeEngine) disarmWake();
      setReviewPending(true);
    } else {
      composer.send();
    }
  }

  async function transcribeRecorderAudio(chunks: Blob[], mimeType: string, language: string, session: VoiceSession) {
    const bridge = getAssistantBridge();

    if (!bridge?.transcribeAudio) {
      throw new Error("앱 내 음성 인식 엔진에 연결할 수 없어요.");
    }

    if (!chunks.length) {
      throw new Error("No voice audio was captured.");
    }

    const blob = new Blob(chunks, {
      type: mimeType,
    });
    const arrayBuffer = await blob.arrayBuffer();
    if (!isCurrent(session)) return "";
    let binary = "";
    const bytes = new Uint8Array(arrayBuffer);

    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]!);
    }

    let deadline: number | undefined;
    const result = await Promise.race([
      bridge.transcribeAudio({ audioBase64: btoa(binary), mimeType, language }),
      new Promise<never>((_resolve, reject) => {
        deadline = window.setTimeout(() => reject(new Error("음성 인식 시간이 초과됐어요. 다시 시도해 주세요.")), 25000);
      }),
    ]).finally(() => window.clearTimeout(deadline));

    return String(result?.text || "").trim();
  }

  async function startRecorderRecognition(session: VoiceSession) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("이 환경에서는 녹음 기반 음성 입력을 사용할 수 없어요.");
    }

    if (!hasConfiguredAssistantStt()) {
      throw new Error(
        "앱 내 STT가 아직 준비되지 않았어요. GROQ_API_KEY 또는 OPENAI_API_KEY를 설정하거나 브라우저 음성 입력을 사용해 주세요.",
      );
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    if (!isCurrent(session)) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    recorderStreamRef.current = stream;

    const preferredMimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    const recorder = preferredMimeType
      ? new MediaRecorder(stream, { mimeType: preferredMimeType })
      : new MediaRecorder(stream);
    const audioContext = new AudioContext();
    recorderAudioContextRef.current = audioContext;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    recorderRef.current = recorder;
    recorderChunksRef.current = [];
    recorderAnalyserRef.current = analyser;
    recorderSourceRef.current = source;
    recorderHeardSpeechRef.current = false;
    recorderSilenceStartedAtRef.current = 0;

    recorder.addEventListener("dataavailable", (event) => {
      if (isCurrent(session) && event.data && event.data.size > 0) {
        recorderChunksRef.current.push(event.data);
      }
    });
    const recordingDone = new Promise<boolean>((resolve) => {
      recorder.addEventListener("stop", () => resolve(true), { once: true });
      recorder.addEventListener("error", () => resolve(false), { once: true });
    });

    setError("");
    setTranscript("");
    setStatus("listening");
    recorder.start(250);

    const samples = new Uint8Array(analyser.fftSize);
    const silenceThreshold = 18;

    recorderMaxTimeoutRef.current = window.setTimeout(() => {
      if (isCurrent(session)) stopRecorderRecognition();
    }, 12000);

    recorderSilenceTimeoutRef.current = window.setTimeout(() => {
      if (isCurrent(session) && !recorderHeardSpeechRef.current) {
        stopRecorderRecognition();
      }
    }, 5000);

    recorderSilenceIntervalRef.current = window.setInterval(() => {
      if (!isCurrent(session)) return;
      analyser.getByteTimeDomainData(samples);

      let sum = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const centered = samples[index]! - 128;
        sum += centered * centered;
      }

      const rms = Math.sqrt(sum / samples.length);
      const speakingNow = rms >= silenceThreshold;

      if (speakingNow) {
        recorderHeardSpeechRef.current = true;
        recorderSilenceStartedAtRef.current = 0;
        if (recorderSilenceTimeoutRef.current) {
          window.clearTimeout(recorderSilenceTimeoutRef.current);
          recorderSilenceTimeoutRef.current = null;
        }
        return;
      }

      if (!recorderHeardSpeechRef.current) {
        return;
      }

      if (!recorderSilenceStartedAtRef.current) {
        recorderSilenceStartedAtRef.current = Date.now();
        return;
      }

      if (Date.now() - recorderSilenceStartedAtRef.current >= 1200) {
        stopRecorderRecognition();
      }
    }, 150);

    const recordingSucceeded = await recordingDone;
    if (!isCurrent(session)) return;
    const chunks = recorderChunksRef.current;
    const heardSpeech = recorderHeardSpeechRef.current;
    await disposeRecorderResources();
    if (!isCurrent(session)) return;

    const language = locale;
    const mimeType = recorder.mimeType || "audio/webm";

    try {
      if (!recordingSucceeded) throw new Error("녹음을 마치지 못했습니다. 다시 시도해 주세요.");
      if (!heardSpeech) {
        setStatus("error");
        setError("말소리를 제대로 듣지 못했어요. 조금 더 또렷하게 말씀해 주세요.");
        return;
      }

      setStatus("processing");
      setTranscript("음성을 텍스트로 변환하고 있어요...");
      const text = await transcribeRecorderAudio(chunks, mimeType, language, session);
      finalizeTranscript(text, session);
    } catch (voiceError) {
      if (!isCurrent(session)) return;
      const message =
        voiceError instanceof Error
          ? voiceError.message
          : "앱 내 음성 인식 엔진 처리 중 문제가 생겼어요.";
      setStatus("error");
      setError(message);
      shouldResumeRef.current = false;
    }
  }

  function startBrowserRecognition(session: VoiceSession) {
    const Recognition = getRecognitionConstructor();

    if (!Recognition) {
      if (session.wakeEngine) {
        failWake("unavailable");
        return;
      }
      setStatus("unsupported");
      setError("현재 환경에서는 Web Speech 음성 인식을 사용할 수 없어요.");
      return;
    }

    const recognition = new Recognition();
    if (session.wakeEngine === "device") {
      if (!("processLocally" in recognition)) {
        failWake("language-not-supported");
        return;
      }
      recognition.processLocally = true;
    }
    recognitionRef.current = recognition;
    recognition.continuous = Boolean(session.wakeEngine);
    recognition.interimResults = !session.wakeEngine;
    recognition.maxAlternatives = 1;
    recognition.lang = locale;

    let started = false;
    recognition.onstart = () => {
      if (!isCurrent(session)) return;
      started = true;
      setError("");
      setTranscript("");
      setStatus("listening");
    };

    let finalReceived = false;
    recognition.onresult = (event) => {
      if (!isCurrent(session) || finalReceived) return;
      let partialTranscript = "";
      let finalTranscript = "";

      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index];
        const chunk = result?.[0]?.transcript?.trim() || "";

        if (!chunk) {
          continue;
        }

        if (result.isFinal) {
          finalTranscript += `${chunk} `;
        } else {
          partialTranscript += `${chunk} `;
        }
      }

      if (session.wakeEngine) {
        const wake = resolveWakeUtterance(finalTranscript, wakeWindow.current !== null);
        if (wake.kind === "follow-up") openWakeWindow();
        if (wake.kind === "command") {
          finalReceived = true;
          clearWakeWindow();
          finalizeTranscript(wake.text, session);
          recognition.stop();
        }
        return;
      }

      const preview = (finalTranscript || partialTranscript).trim();

      if (preview) {
        setTranscript(preview);
      }

      if (finalTranscript.trim()) {
        finalReceived = true;
        finalizeTranscript(finalTranscript, session);
        recognition.stop();
      }
    };

    recognition.onerror = (event) => {
      if (!isCurrent(session) || finalReceived) return;
      const reason = String(event?.error || event?.message || "unknown");

      if (session.wakeEngine) {
        if (reason === "no-speech" && started) return;
        failWake(reason);
        return;
      }
      if (reason === "aborted") return;
      finalReceived = true;

      if (reason === "no-speech") {
        setStatus("idle");
        setError("음성이 감지되지 않았어요. 다시 한 번 말씀해 주세요.");
        return;
      }

      if (reason === "not-allowed" || reason === "service-not-allowed") {
        setStatus("error");
        setError(
          "마이크 권한이 막혀 있어요. 시스템 설정에서 Jarvis Desktop 마이크 권한을 허용해 주세요.",
        );
        setContinuous(false);
        return;
      }

      if (reason === "network") {
        setStatus("error");
        setError(
          "브라우저 음성 인식이 불안정해요. Electron에서는 앱 내 STT 연결이 가능한지 먼저 확인해 주세요.",
        );
        return;
      }

      setStatus("error");
      setError(`음성 인식 오류: ${reason}`);
    };

    recognition.onend = () => {
      if (!isCurrent(session)) return;
      if (session.wakeEngine && !finalReceived) {
        if (!started) {
          failWake("unavailable");
          return;
        }
        shouldResumeRef.current = true;
      }
      finalReceived = true;
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setStatus((current) => current === "starting" || current === "listening" ? "idle" : current);
    };

    recognition.start();
  }

  function startRecognition(keepContinuous = false, wake?: WakeEngine) {
    if (document.hidden) {
      stopRecognition();
      return;
    }
    microphoneStartListeners.current.forEach((listener) => listener());
    releaseVoiceSession();
    const session = { threadId: currentThreadId(), keepContinuous, wakeEngine: wake };
    sessionRef.current = session;
    setError("");
    setTranscript("");
    setReviewPending(false);
    setStatus("starting");

    const start = async () => {
      if (!wake && hasConfiguredAssistantStt()) await startRecorderRecognition(session);
      else startBrowserRecognition(session);
    };
    void start().catch((error: unknown) => {
      if (!isCurrent(session)) return;
      if (wake) {
        failWake("unavailable");
        return;
      }
      releaseVoiceSession();
      setStatus("error");
      setError(error instanceof Error ? error.message : "음성 입력을 시작하지 못했습니다.");
      setContinuous(false);
    });
  }

  function toggleContinuous() {
    if (continuous) {
      stopRecognition();
      return;
    }

    disarmWake();
    setContinuous(true);
    startRecognition(true);
  }

  function startOnce() {
    disarmWake();
    setContinuous(false);
    startRecognition(false);
  }

  function armWake(engine: WakeEngine) {
    stopRecognition();
    setWakeEngine(engine);
    startRecognition(false, engine);
  }

  return (
    <VoiceContext.Provider
      value={{
        supported,
        status,
        transcript,
        error,
        reviewPending,
        continuous,
        wakeEngine,
        awaitingWakeCommand,
        armWake,
        waitingForReplyAudio,
        beginReplyAudio,
        onMicrophoneStart,
        startOnce,
        toggleContinuous,
        stop: stopRecognition,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}

export function useJarvisVoice() {
  const context = useContext(VoiceContext);

  if (!context) {
    throw new Error("useJarvisVoice must be used within JarvisVoiceProvider");
  }

  return context;
}
