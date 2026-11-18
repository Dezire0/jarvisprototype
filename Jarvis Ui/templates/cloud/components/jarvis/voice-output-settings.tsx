"use client";

import { Volume2Icon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  VoicePlaybackStatus, useVoiceOutput,
} from "@/components/jarvis/voice-output-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  deviceVoices, previewVoiceId, voiceEngine, voiceEngineName, voiceEngines, voiceSamples,
  type VoiceEngine, type VoiceLanguage, type VoiceOutputSettings, type VoiceSection,
} from "@/lib/voice-output";
import { useWorkspaceLocale } from "@/lib/workspace-language";

type Field = [key: string, ko: string, en: string, secret?: true];
const apiKey: Field = ["apiKey", "API 키", "API key", true];
const bilingualVoice: Field[] = [["voiceKo", "한국어 음성", "Korean voice"], ["voiceEn", "영어 음성", "English voice"]];
const model: Field = ["model", "모델", "Model"];
const providerFields: Partial<Record<VoiceEngine, { section: VoiceSection; fields: Field[] }>> = {
  elevenlabs: {
    section: "elevenlabs",
    fields: [apiKey, ["modelKo", "한국어 모델", "Korean model"], ["modelEn", "영어 모델", "English model"], ...bilingualVoice],
  },
  "naver-clova": {
    section: "naverClova",
    fields: [["clientId", "클라이언트 ID", "Client ID", true], ["clientSecret", "클라이언트 시크릿", "Client secret", true],
      ["speakerKo", "한국어 화자", "Korean speaker"], ["speakerEn", "영어 화자", "English speaker"]],
  },
  gemini: { section: "gemini", fields: [apiKey, model, ...bilingualVoice] },
  openai: { section: "openai", fields: [apiKey, model, ...bilingualVoice] },
  cartesia: { section: "cartesia", fields: [apiKey, ["modelId", "모델 ID", "Model ID"], ...bilingualVoice] },
  "google-cloud": {
    section: "google",
    fields: [["credentialsPath", "서비스 계정 JSON 경로", "Service account JSON path"]],
  },
};
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-foreground focus-visible:outline-2 focus-visible:outline-ring";

export function VoiceOutputSettingsButton() {
  const output = useVoiceOutput();
  const ko = useWorkspaceLocale().startsWith("ko");
  if (!output.available) return null;
  const title = ko ? "음성 출력" : "Voice output";
  return <Dialog>
    <DialogTrigger asChild>
      <button type="button" className="jarvis-sidebar-control" aria-haspopup="dialog" onClick={output.reload}>
        <Volume2Icon className="size-4 shrink-0" aria-hidden="true" />
        <span>{title}</span>
      </button>
    </DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={false}>
      <DialogHeader className="text-left">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {ko ? "한국어와 영어의 읽어주기 음성을 설정합니다." : "Choose a reading voice for Korean and English."}
        </DialogDescription>
      </DialogHeader>
      <VoiceSettingsForm ko={ko} />
    </DialogContent>
  </Dialog>;
}

function VoiceSettingsForm({ ko }: { ko: boolean }) {
  const t = (korean: string, english: string) => ko ? korean : english;
  const output = useVoiceOutput();
  const [language, setLanguage] = useState<VoiceLanguage>(ko ? "ko" : "en");
  const [draft, setDraft] = useState<VoiceOutputSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [mutePending, setMutePending] = useState(false);
  const [muteFailed, setMuteFailed] = useState(false);
  const [saveResult, setSaveResult] = useState<boolean | null>(null);
  const settings = output.settings;
  const stop = output.stop;
  useEffect(() => { setDraft((current) => current ?? settings); }, [settings]);
  useEffect(() => () => stop(previewVoiceId), [stop]);

  if (!draft || !settings) return <>
    <p role={output.loadFailed ? "alert" : "status"} className="text-sm text-muted-foreground">
      {output.loadFailed ? t("음성 설정을 불러오지 못했습니다.", "Couldn’t load voice settings.")
        : t("음성 설정을 불러오는 중…", "Loading voice settings…")}
    </p>
    <DialogFooter>
      <DialogClose asChild><Button variant="outline">{t("닫기", "Close")}</Button></DialogClose>
      {output.loadFailed && <Button onClick={output.reload}>{t("다시 시도", "Try again")}</Button>}
    </DialogFooter>
  </>;

  const engine = voiceEngine(draft.providers[language]);
  const fields = providerFields[engine];
  const voices = deviceVoices(output.voices, language);
  const selectedVoice = draft.systemVoices[language];
  const edited = JSON.stringify(draft) !== JSON.stringify(settings);
  const playback = output.playback?.id === previewVoiceId ? output.playback : null;
  const playing = playback?.status === "loading" || playback?.status === "playing";
  const engineName = voiceEngineName(engine, ko);
  function edit(next: VoiceOutputSettings) {
    setDraft(next);
    setSaveResult(null);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !draft || !edited) return;
    setSaving(true);
    const saved = await output.save(draft);
    if (saved) setDraft(saved);
    setSaveResult(Boolean(saved));
    setSaving(false);
  }

  return <form className="space-y-4" onSubmit={(event) => void save(event)}>
    <label className="flex min-h-8 items-center justify-between gap-3 border-b border-border pb-2 text-sm">
      <span>{t("Jarvis 음소거", "Mute Jarvis")}</span>
      <input type="checkbox" className="size-4 shrink-0 accent-foreground" checked={output.muted}
        disabled={mutePending} onChange={(event) => {
          setMutePending(true);
          setMuteFailed(false);
          void output.setMuted(event.target.checked).then((saved) => {
            setMuteFailed(!saved);
            setMutePending(false);
          });
        }} />
    </label>
    {muteFailed && <p role="alert" className="text-sm text-muted-foreground">
      {t("음소거 설정을 바꾸지 못했습니다.", "Couldn’t change mute setting.")}
    </p>}
    <fieldset className="space-y-3" disabled={saving || playing}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span>{t("읽어줄 언어", "Reading language")}</span>
          <select className={selectClass} value={language} onChange={(event) => {
            stop(previewVoiceId);
            setLanguage(event.target.value === "ko" ? "ko" : "en");
          }}>
            <option value="ko">한국어</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span>{t("음성 엔진", "Voice engine")}</span>
          <select className={selectClass} value={engine} onChange={(event) => {
            edit({ ...draft, providers: { ...draft.providers, [language]: voiceEngine(event.target.value) } });
          }}>
            {voiceEngines.map((option) => <option key={option} value={option}>{voiceEngineName(option, ko)}</option>)}
          </select>
        </label>
      </div>
      {engine === "system" && <label className="grid gap-1.5 text-sm">
        <span>{t("설치된 기기 음성", "Installed device voice")}</span>
        <select className={selectClass} value={selectedVoice} onChange={(event) => {
          edit({ ...draft, systemVoices: { ...draft.systemVoices, [language]: event.target.value } });
        }}>
          <option value="">{t("시스템 기본값", "System default")}</option>
          {selectedVoice && !voices.some(({ voiceURI }) => voiceURI === selectedVoice) &&
            <option value={selectedVoice}>{t("현재 음성을 찾을 수 없음", "Saved voice unavailable")}</option>}
          {voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}
        </select>
      </label>}
      {fields && <>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(`${engineName}로 읽기를 선택하면 해당 서비스에 텍스트가 전달됩니다.`,
            `Choosing to read with ${engineName} sends that text to its service.`)}
        </p>
        <details className="rounded-lg border border-border px-3 py-2" key={engine}>
          <summary className="cursor-pointer text-sm">{t("공급자 설정", "Provider settings")}</summary>
          <div className="mt-3 grid gap-3">
            {fields.fields.map(([key, korean, english, secret]) => {
              const value = draft[fields.section][key];
              return <label className="grid gap-1.5 text-sm" key={key}>
                <span>{t(korean, english)}</span>
                <Input type={secret ? "password" : "text"} autoComplete="off" maxLength={4096}
                  placeholder={secret && draft[fields.section].configured
                    ? t("비워 두면 기존 값 유지", "Leave blank to keep saved value") : undefined}
                  value={typeof value === "string" ? value : ""} onChange={(event) => {
                    edit({ ...draft, [fields.section]: { ...draft[fields.section], [key]: event.target.value } });
                  }} />
              </label>;
            })}
          </div>
        </details>
      </>}
    </fieldset>
    {edited && <p className="text-xs text-muted-foreground">
      {t("변경 사항을 저장한 뒤 미리 들을 수 있습니다.", "Save changes before previewing.")}
    </p>}
    {saveResult !== null && <p role={saveResult ? "status" : "alert"} className="text-sm text-muted-foreground">
      {saveResult ? t("음성 설정을 저장했습니다.", "Voice settings saved.")
        : t("음성 설정을 저장하지 못했습니다. 다시 시도하세요.", "Couldn’t save voice settings. Try again.")}
    </p>}
    <VoicePlaybackStatus playback={playback} ko={ko} />
    <DialogFooter>
      <DialogClose asChild><Button type="button" variant="ghost" disabled={saving}>{t("닫기", "Close")}</Button></DialogClose>
      <Button type="button" variant="outline" disabled={edited || saving || output.muted || engine === "off"} onClick={() => {
        if (playing) stop(previewVoiceId);
        else void output.play(previewVoiceId, voiceSamples[language], language, engine);
      }}>
        {playing ? t("미리듣기 중지", "Stop preview") : engine === "system" ? t("미리듣기", "Preview voice")
          : t(`${engineName} 미리듣기`, `Preview with ${engineName}`)}
      </Button>
      <Button type="submit" disabled={!edited || saving || playing}>{t("저장", "Save")}</Button>
    </DialogFooter>
  </form>;
}
