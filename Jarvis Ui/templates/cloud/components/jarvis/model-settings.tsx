"use client";

import { cloneElement, useEffect, useId, useState, type FormEvent, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspaceLocale } from "@/lib/workspace-language";

export type ConversationModelSettings = {
  provider: "auto" | "openai-compatible" | "groq" | "gemini" | "ollama" | "openai-cli" | "gemini-cli";
  groq: { configured: boolean; chatModel: string; sttModel: string };
  openai: { configured: boolean; model: string; baseUrl: string };
  gemini: { configured: boolean; model: string };
  ollama: { model: string; url: string };
};

export const MODEL_SETTINGS_SAVED = "jarvis:conversation-model-settings-saved";
export type ModelAvailability = "configured" | "missing" | "partial" | "computer-control";

export type ModelConnectionResult = {
  status: "responded" | "missing" | "failed" | "timeout" | "cli";
  provider: string;
  model: string;
};

function toDraft(settings: ConversationModelSettings) {
  return {
    provider: settings.provider,
    groq: { ...settings.groq, apiKey: "" },
    openai: { ...settings.openai, apiKey: "" },
    gemini: { ...settings.gemini, apiKey: "" },
    ollama: { ...settings.ollama },
  };
}

export type ConversationModelDraft = ReturnType<typeof toDraft>;

export function ModelSettings({ open, onOpenChange, restoreFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocus: () => void;
}) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const title = ko ? "모델 설정" : "Model settings";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}>
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {ko ? "대화에 사용할 모델과 기기에 저장할 연결 정보를 관리합니다."
              : "Choose a conversation model and save its connection settings on this device."}
          </DialogDescription>
        </DialogHeader>
        <ModelSettingsForm />
      </DialogContent>
    </Dialog>
  );
}

type Notice = {
  type: "save" | "save-error" | "list" | "list-error" | "test";
  test?: ModelConnectionResult;
  modelCount?: number;
};

function ModelSettingsForm() {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const modelsId = useId();
  const [draft, setDraft] = useState<ConversationModelDraft | null>(null);
  const [saved, setSaved] = useState<ConversationModelDraft | null>(null);
  const [loadingFailed, setLoadingFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [operation, setOperation] = useState<"save" | "list" | "test" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  useEffect(() => {
    const read = window.assistantAPI?.getConversationModelSettings;
    let current = true;
    if (!read) {
      setLoadingFailed(true);
      return;
    }
    void read().then(({ settings }) => {
      if (!current) return;
      const initial = toDraft(settings);
      setSaved(initial);
      setDraft(initial);
    }).catch(() => { if (current) setLoadingFailed(true); });
    return () => { current = false; };
  }, [loadAttempt]);

  if (!draft) return (
    <>
      <p className={loadingFailed ? "jarvis-auth-error" : "text-sm text-muted-foreground"}
        role={loadingFailed ? "alert" : "status"}>
        {loadingFailed
          ? t("모델 설정을 불러오지 못했습니다.", "Couldn’t load model settings.")
          : t("모델 설정을 불러오는 중…", "Loading model settings…")}
      </p>
      <DialogFooter>
        <DialogClose asChild><Button variant="outline">{t("닫기", "Close")}</Button></DialogClose>
        {loadingFailed && <Button onClick={() => {
          setLoadingFailed(false);
          setLoadAttempt((value) => value + 1);
        }}>{t("다시 읽기", "Try again")}</Button>}
      </DialogFooter>
    </>
  );

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const provider = draft.provider;
  const cli = provider === "openai-cli" || provider === "gemini-cli";

  function edit<K extends keyof ConversationModelDraft>(key: K, value: ConversationModelDraft[K]) {
    setDraft((current) => current && ({ ...current, [key]: value }));
    setNotice(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const write = window.assistantAPI?.saveConversationModelSettings;
    if (!write || !draft || !dirty || operation) return;
    setOperation("save");
    setNotice(null);
    try {
      const { settings } = await write(draft);
      const current = toDraft(settings);
      setDraft(current);
      setSaved(current);
      setNotice({ type: "save" });
      window.dispatchEvent(new Event(MODEL_SETTINGS_SAVED));
    } catch {
      setNotice({ type: "save-error" });
    } finally {
      setOperation(null);
    }
  }

  async function testConnection() {
    const test = window.assistantAPI?.testConversationModel;
    if (!test || dirty || operation) return;
    setOperation("test");
    setNotice(null);
    try {
      const result = await test();
      setNotice({ type: "test", test: result });
    } catch {
      setNotice({ type: "test", test: { status: "failed", provider, model: "" } });
    } finally {
      setOperation(null);
    }
  }

  async function listModels() {
    if (operation || !draft || !window.assistantAPI) return;
    setOperation("list");
    setNotice(null);
    try {
      const result = await window.assistantAPI.invokeTool("ai:ollama-models", {
        forceRefresh: true,
        url: draft.ollama.url,
      }) as { models?: string[] };
      const models = result.models ?? [];
      setOllamaModels(models);
      setNotice({ type: "list", modelCount: models.length });
    } catch {
      setOllamaModels([]);
      setNotice({ type: "list-error" });
    } finally {
      setOperation(null);
    }
  }

  const response = notice?.test;
  const error = notice?.type === "save-error" || notice?.type === "list-error" ||
    response?.status === "failed" || response?.status === "timeout";
  const feedback = notice?.type === "save" ? t("모델 설정을 저장했습니다.", "Model settings saved.")
    : notice?.type === "save-error" ? t("저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도하세요.", "Couldn’t save. Check the fields and try again.")
    : notice?.type === "list-error" ? t("Ollama 모델 목록을 읽지 못했습니다. 서버 주소를 확인하세요.", "Couldn’t list models. Check the Ollama server address.")
    : notice?.type === "list" ? (notice.modelCount
      ? t("설치된 모델을 모델 이름 입력란에서 선택할 수 있습니다.", "Installed models are available as suggestions in the Model name field.")
      : t("서버에 설치된 모델이 없습니다.", "The server has no installed models."))
    : response?.status === "responded" ? t(`${response.model}에서 응답을 받았습니다.`, `${response.model} responded.`)
    : response?.status === "missing" ? t("API 키나 모델 주소를 확인하고 설정을 저장하세요.", "Set an API key or model endpoint and save.")
    : response?.status === "timeout" ? t("모델 응답 시간을 초과했습니다.", "The model did not respond in time.")
    : response?.status === "failed" ? t("모델의 응답을 확인하지 못했습니다. 주소, API 키, 모델 이름을 확인하세요.",
      "The model did not return a usable response. Check its address, API key, and model name.")
    : "";
  const keyHint = t("기존 키를 유지하려면 비워 두세요.", "Leave blank to keep the current key.");
  const modelLabel = t("모델 이름", "Model name");
  const groqKey = (
    <Field label="Groq API key" hint={keyHint}>
      <Input type="password" autoComplete="off" value={draft.groq.apiKey}
        onChange={(event) => edit("groq", { ...draft.groq, apiKey: event.target.value })} />
    </Field>
  );
  const groqVoice = (
    <Field label={t("음성 인식 모델", "Speech recognition model")}>
      <Input value={draft.groq.sttModel} onChange={(event) => edit("groq", { ...draft.groq, sttModel: event.target.value })} />
    </Field>
  );

  return (
    <form className="space-y-5" onSubmit={(event) => void save(event)}>
      <fieldset disabled={operation !== null} className="space-y-4">
        <Field label={t("공급자", "Provider")}>
          <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            value={provider} onChange={(event) => edit("provider", event.target.value as ConversationModelDraft["provider"])}>
            <option value="auto">{t("자동 선택", "Automatic")}</option>
            <option value="openai-compatible">{t("OpenAI 및 호환 API", "OpenAI and compatible APIs")}</option>
            <option value="groq">Groq</option>
            <option value="gemini">Gemini</option>
            <option value="ollama">Ollama</option>
            <option value="openai-cli">Codex CLI</option>
            <option value="gemini-cli">Gemini CLI</option>
          </select>
        </Field>
        {provider === "auto" && <p className="text-sm text-muted-foreground">
          {t("설정된 API 중 Groq, Gemini, OpenAI 호환 순으로 선택합니다.", "Chooses among configured APIs in this order: Groq, Gemini, OpenAI-compatible.")}
        </p>}
        {provider === "openai-compatible" && <>
          <Field label={modelLabel}>
            <Input value={draft.openai.model} onChange={(event) => edit("openai", { ...draft.openai, model: event.target.value })} />
          </Field>
          <Field label={t("호환 API 주소 (선택)", "Compatible API address (optional)")}>
            <Input type="url" value={draft.openai.baseUrl} placeholder="https://api.openai.com/v1"
              onChange={(event) => edit("openai", { ...draft.openai, baseUrl: event.target.value })} />
          </Field>
          <Field label="OpenAI API key" hint={t("서버가 바뀌면 새 서버의 키를 입력하세요. 비워 두면 이전 서버의 키가 제거됩니다.",
            "When switching servers, enter the new server’s key. Leaving this blank clears the old server’s key.")}>
            <Input type="password" autoComplete="off" value={draft.openai.apiKey}
              onChange={(event) => edit("openai", { ...draft.openai, apiKey: event.target.value })} />
          </Field>
        </>}
        {provider === "gemini" && <>
          <Field label={modelLabel}>
            <Input value={draft.gemini.model} onChange={(event) => edit("gemini", { ...draft.gemini, model: event.target.value })} />
          </Field>
          <Field label="Gemini API key" hint={keyHint}>
            <Input type="password" autoComplete="off" value={draft.gemini.apiKey}
              onChange={(event) => edit("gemini", { ...draft.gemini, apiKey: event.target.value })} />
          </Field>
        </>}
        {provider === "groq" && <>
          <Field label={modelLabel}>
            <Input value={draft.groq.chatModel} onChange={(event) => edit("groq", { ...draft.groq, chatModel: event.target.value })} />
          </Field>
          {groqKey}
          {groqVoice}
        </>}
        {provider === "ollama" && <>
          <Field label={t("서버 주소", "Server address")}>
            <Input type="url" value={draft.ollama.url} placeholder="http://127.0.0.1:11434"
              onChange={(event) => {
                edit("ollama", { ...draft.ollama, url: event.target.value });
                setOllamaModels([]);
              }} />
          </Field>
          <Field label={modelLabel}>
            <Input list={modelsId} value={draft.ollama.model}
              onChange={(event) => edit("ollama", { ...draft.ollama, model: event.target.value })} />
          </Field>
          <datalist id={modelsId}>{ollamaModels.map((model) => <option key={model} value={model} />)}</datalist>
          <Button type="button" variant="outline" onClick={() => void listModels()}>
            {operation === "list" ? t("목록을 읽는 중…", "Listing models…") : t("설치된 모델 보기", "List installed models")}
          </Button>
        </>}
        {cli && <>
          <Field label={modelLabel}>
            {provider === "openai-cli"
              ? <Input value={draft.openai.model} onChange={(event) => edit("openai", { ...draft.openai, model: event.target.value })} />
              : <Input value={draft.gemini.model} onChange={(event) => edit("gemini", { ...draft.gemini, model: event.target.value })} />}
          </Field>
          <p className="text-sm text-muted-foreground">
            {t("CLI 모델은 기존 CLI 로그인과 컴퓨터 제어 권한을 사용합니다.", "CLI models use an existing CLI login and require computer control.")}
          </p>
        </>}
        {provider !== "groq" && <details className="border-t border-border pt-3">
          <summary className="cursor-pointer rounded text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
            {t("Groq 음성 입력", "Groq voice input")}
          </summary>
          <div className="mt-3 space-y-3">{groqKey}{groqVoice}</div>
        </details>}
      </fieldset>
      {feedback && <p role={error ? "alert" : "status"} className={error ? "jarvis-auth-error" : "text-sm text-muted-foreground"}>{feedback}</p>}
      {!cli && <p className="text-xs text-muted-foreground">
        {dirty
          ? t("테스트하기 전에 변경 내용을 저장하세요.", "Save your changes before testing.")
          : operation === "test"
            ? t("저장한 모델에 테스트 중…", "Testing the saved model…")
            : t("테스트는 저장된 모델로 짧은 요청을 보냅니다.", "Testing sends a short request to the saved model.")}
      </p>}
      <DialogFooter className="flex-row flex-wrap justify-between sm:justify-between">
        <DialogClose asChild><Button type="button" variant="ghost" disabled={operation === "save"}>{t("닫기", "Close")}</Button></DialogClose>
        <div className="flex flex-wrap gap-2">
          {!cli && <Button type="button" variant="outline" disabled={dirty || operation !== null}
            onClick={() => void testConnection()}>{t("연결 테스트", "Test connection")}</Button>}
          <Button type="submit" disabled={!dirty || operation !== null}>
            {operation === "save" ? t("저장 중…", "Saving…") : t("저장", "Save")}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function Field({ label, hint, children }: {
  label: string;
  hint?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const id = useId();
  const descriptionId = hint ? id + "-hint" : undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {cloneElement(children, { id, "aria-describedby": descriptionId })}
      {hint && <p id={descriptionId} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
