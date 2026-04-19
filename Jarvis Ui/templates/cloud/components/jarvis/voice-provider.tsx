"use client";

import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAui, useAuiState } from "@assistant-ui/react";

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

function resolveRecognitionLanguage() {
  if (typeof navigator === "undefined") {
    return "ko-KR";
  }

  const preferred = navigator.languages?.[0] || navigator.language || "ko-KR";
  return preferred.startsWith("ko") ? "ko-KR" : preferred;
}

export function JarvisVoiceProvider({
  children,
}: PropsWithChildren) {
  const aui = useAui();
  const isThreadRunning = useAuiState((state) => state.thread.isRunning);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [continuous, setContinuous] = useState(false);
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const statusRef = useRef<VoiceStatus>("idle");
  const shouldResumeRef = useRef(false);
  const isMountedRef = useRef(true);
  const supported = Boolean(getRecognitionConstructor());

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!continuous || isThreadRunning || !shouldResumeRef.current) {
      return;
    }

    shouldResumeRef.current = false;
    const restartTimer = window.setTimeout(() => {
      startRecognition(true);
    }, 420);

    return () => {
      window.clearTimeout(restartTimer);
    };
  }, [continuous, isThreadRunning]);

  function stopRecognition() {
    shouldResumeRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
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
    setStatus("processing");
    shouldResumeRef.current = keepContinuous;
    aui.composer().setText(normalized);
    aui.composer().send();
  }

  function startRecognition(keepContinuous = false) {
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
    recognition.lang = resolveRecognitionLanguage();

    recognition.onstart = () => {
      setError("");
      setTranscript("");
      setStatus("listening");
    };

    recognition.onresult = (event) => {
      let partialTranscript = "";
      let finalTranscript = "";

      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index];
        const chunk = result[0]?.transcript?.trim() || "";

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
        aui.composer().setText(preview);
      }

      if (finalTranscript.trim()) {
        finalizeTranscript(finalTranscript, keepContinuous);
      }
    };

    recognition.onerror = (event) => {
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
          "음성 인식 서비스 연결이 끊겼어요. 현재 방식은 Chromium의 Web Speech에 의존해서 Electron 환경, 오프라인 상태, VPN/방화벽, 또는 브라우저 음성 서비스 차단 시 이 오류가 날 수 있어요.",
        );
        return;
      }

      setStatus("error");
      setError(`음성 인식 오류: ${reason}`);
    };

    recognition.onend = () => {
      recognitionRef.current = null;

      if (!isMountedRef.current) {
        return;
      }

      if (shouldResumeRef.current) {
        setStatus("processing");
        return;
      }

      if (statusRef.current === "listening") {
        setStatus("idle");
      }
    };

    recognition.start();
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
