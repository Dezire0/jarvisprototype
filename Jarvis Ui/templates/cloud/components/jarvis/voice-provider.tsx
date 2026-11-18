"use client";

import { useWorkspaceLocale } from "@/lib/workspace-language";

import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import type { ComposerCommandHandler } from "@/lib/local-workspace";

type VoiceStatus =
  | "idle"
  | "listening"
  | "processing"
  | "unsupported"
  | "error";

type BrowserRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror:
    | ((event: { error?: string | undefined; message?: string | undefined }) => void)
    | null;
  onresult:
    | ((
        event: {
          resultIndex: number;
          results: ArrayLike<
            ArrayLike<{
              transcript?: string | undefined;
            }> & {
              isFinal?: boolean | undefined;
            }
          >;
        },
      ) => void)
    | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

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

type VoiceContextValue = {
  supported: boolean;
  status: VoiceStatus;
  transcript: string;
  error: string;
  continuous: boolean;
  startOnce: () => void;
  toggleContinuous: () => void;
  stop: () => void;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

function getRecognitionConstructor():
  | (new () => BrowserRecognition)
  | null {
  if (typeof window === "undefined") {
    return null;
  }

  const recognition =
    (
      window as typeof window & {
        SpeechRecognition?: new () => BrowserRecognition;
        webkitSpeechRecognition?: new () => BrowserRecognition;
      }
    ).SpeechRecognition ||
    (
      window as typeof window & {
        SpeechRecognition?: new () => BrowserRecognition;
        webkitSpeechRecognition?: new () => BrowserRecognition;
      }
    ).webkitSpeechRecognition;

  return recognition || null;
}

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
  const [continuous, setContinuous] = useState(false);
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
  const statusRef = useRef<VoiceStatus>("idle");
  const shouldResumeRef = useRef(false);
  const isMountedRef = useRef(true);
  const recognitionSession = useRef(0);
  const isCurrent = (session: number) => isMountedRef.current && session === recognitionSession.current;

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      recognitionSession.current++;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      stopRecorderRecognition();
      void disposeRecorderResources();
    };
  }, []);

  useEffect(() => {
    if (!continuous || isThreadRunning || status !== "idle" || !shouldResumeRef.current) {
      return;
    }

    const restartTimer = window.setTimeout(() => {
      shouldResumeRef.current = false;
      startRecognition(true);
    }, 420);

    return () => {
      window.clearTimeout(restartTimer);
    };
  }, [continuous, isThreadRunning, status]);

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

  function stopRecognition() {
    recognitionSession.current++;
    shouldResumeRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    stopRecorderRecognition();
    void disposeRecorderResources();
    setTranscript("");
    setError("");
    setStatus(supported ? "idle" : "unsupported");
  }

  function finalizeTranscript(value: string, keepContinuous: boolean) {
    const normalized = value.trim();

    if (!normalized) {
      setStatus("error");
      setError("말소리를 제대로 듣지 못했어요. 조금 더 또렷하게 말씀해 주세요.");
      return;
    }

    setTranscript(normalized);
    setError("");
    setStatus("idle");
    shouldResumeRef.current = keepContinuous;
    const composer = aui.composer();
    const { attachments, quote } = composer.getState();
    if (attachments.length) {
      shouldResumeRef.current = false;
      setContinuous(false);
      composer.setText(normalized);
      return;
    }
    const destination = runLocalCommand?.(normalized, {
      hasAttachmentsOrQuote: Boolean(attachments.length || quote),
      allowSpeech: !keepContinuous,
    });
    if (destination === "local") return;
    composer.setText(normalized);
    if (destination !== "retry") composer.send();
  }

  async function transcribeRecorderAudio(chunks: Blob[], mimeType: string, language: string) {
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

  async function startRecorderRecognition(session: number, keepContinuous: boolean) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("이 환경에서는 녹음 기반 음성 입력을 사용할 수 없어요.");
    }

    if (!hasConfiguredAssistantStt()) {
      throw new Error(
        "앱 내 STT가 아직 준비되지 않았어요. GROQ_API_KEY 또는 OPENAI_API_KEY를 설정하거나 브라우저 음성 입력을 사용해 주세요.",
      );
    }

    recognitionRef.current?.abort();
    recognitionRef.current = null;
    stopRecorderRecognition();
    await disposeRecorderResources();
    if (!isCurrent(session)) return;

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
      stopRecorderRecognition();
    }, 12000);

    recorderSilenceTimeoutRef.current = window.setTimeout(() => {
      if (!recorderHeardSpeechRef.current) {
        stopRecorderRecognition();
      }
    }, 5000);

    recorderSilenceIntervalRef.current = window.setInterval(() => {
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
      const text = await transcribeRecorderAudio(chunks, mimeType, language);
      if (isCurrent(session)) finalizeTranscript(text, keepContinuous);
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

  function startBrowserRecognition(session: number, keepContinuous: boolean) {
    const Recognition = getRecognitionConstructor();

    if (!Recognition) {
      setStatus("unsupported");
      setError("현재 환경에서는 Web Speech 음성 인식을 사용할 수 없어요.");
      return;
    }

    recognitionRef.current?.abort();

    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = locale;

    recognition.onstart = () => {
      if (!isCurrent(session)) return;
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

      const preview = (finalTranscript || partialTranscript).trim();

      if (preview) {
        setTranscript(preview);
      }

      if (finalTranscript.trim()) {
        finalReceived = true;
        finalizeTranscript(finalTranscript, keepContinuous);
        recognition.stop();
      }
    };

    recognition.onerror = (event) => {
      if (!isCurrent(session) || finalReceived) return;
      const reason = String(event?.error || event?.message || "unknown");

      if (reason === "aborted") {
        return;
      }

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
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (statusRef.current === "listening") setStatus("idle");
    };

    recognition.start();
  }

  function startRecognition(keepContinuous = false) {
    const session = ++recognitionSession.current;
    shouldResumeRef.current = false;
    const start = async () => {
      if (hasConfiguredAssistantStt()) {
        await startRecorderRecognition(session, keepContinuous);
      } else {
        startBrowserRecognition(session, keepContinuous);
      }
    };
    void start().catch((error: unknown) => {
      if (!isCurrent(session)) return;
      stopRecorderRecognition();
      void disposeRecorderResources();
      setStatus("error");
      setError(error instanceof Error ? error.message : "음성 입력을 시작하지 못했습니다.");
      setContinuous(false);
    });
  }

  function toggleContinuous() {
    if (continuous) {
      setContinuous(false);
      stopRecognition();
      return;
    }

    setContinuous(true);
    startRecognition(true);
  }

  function startOnce() {
    setContinuous(false);
    startRecognition(false);
  }

  return (
    <VoiceContext.Provider
      value={{
        supported,
        status,
        transcript,
        error,
        continuous,
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
