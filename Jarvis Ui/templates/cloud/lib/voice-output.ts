import contract from "../../../../src/main/assistant/voice-output.json";

export type VoiceLanguage = "en" | "ko";
export type VoiceEngine = keyof typeof contract.providers;
export const voiceEngines = Object.keys(contract.providers) as VoiceEngine[];
export const voiceTextLimit = contract.maxTextLength;
export const previewVoiceId = "voice-settings-preview";
export const voiceSamples: Record<VoiceLanguage, string> = {
  en: "Hello. This is a preview of the voice you selected.",
  ko: "안녕하세요. 선택한 음성을 미리 들어보세요.",
};

export type VoiceSection = "elevenlabs" | "naverClova" | "gemini" | "openai" | "cartesia" | "google";
export type VoiceOutputSettings = {
  providers: Record<VoiceLanguage, string>;
  systemVoices: Record<VoiceLanguage, string>;
} & Record<VoiceSection, Record<string, string | boolean>>;

export type VoicePayload = { language: VoiceLanguage; provider: VoiceEngine; text: string };
export type VoiceResponse =
  { status: "audio"; audioBase64: string; mimeType: string } |
  { status: "failed" | "invalid" | "settings-changed" | "muted" | "off" | "system" };

export function voiceEngine(value?: string): VoiceEngine {
  return voiceEngines.includes(value as VoiceEngine) ? value as VoiceEngine : "system";
}

export function voiceEngineName(engine: VoiceEngine, ko: boolean) {
  if (engine === "system") return ko ? "기기 음성" : "Device voice";
  if (engine === "off") return ko ? "끄기" : "Off";
  return contract.providers[engine];
}

export function voiceLanguage(text: string, fallback: VoiceLanguage): VoiceLanguage {
  const ko = text.match(/[가-힣ㄱ-ㅎㅏ-ㅣ]/g)?.length ?? 0;
  const en = text.match(/[a-z]/gi)?.length ?? 0;
  return ko === en ? fallback : ko > en ? "ko" : "en";
}

export function deviceVoices(voices: SpeechSynthesisVoice[], language: VoiceLanguage) {
  return voices.filter((voice) => voice.localService && voice.lang.toLowerCase().split(/[-_]/)[0] === language);
}
