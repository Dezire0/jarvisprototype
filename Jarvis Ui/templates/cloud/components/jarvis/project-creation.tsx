"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useWorkspaceLocale } from "@/lib/workspace-language";

type Template = "web" | "tasks" | "grid" | "model";
type Project = {
  id: number;
  projectName: string;
  files: { path: string; content: string }[];
  source: { type: "template" } | { type: "model"; provider: string; model: string };
};
type Receipt = { path: string; fileCount: number };
type Result<T> = { ok: true; data?: T; outcome?: "cancelled" } | { ok: false; reason: string; path?: string };

export function ProjectCreation({ computerControl }: { computerControl: boolean | null }) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const [template, setTemplate] = useState<Template>("web");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [operation, setOperation] = useState<"prepare" | "save" | "open" | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; path?: string } | null>(null);
  const active = useRef(false);
  const stepTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    stepTitle.current?.focus();
  }, [project, receipt]);

  const errors: Record<string, string> = {
    PROJECT_INVALID_REQUEST: t("프로젝트 설명을 입력하세요.", "Enter a project description."),
    PROJECT_INVALID_NAME: t("다른 폴더 이름을 입력하세요.", "Enter a different folder name."),
    PROJECT_INVALID_FILES: t("파일 목록을 확인할 수 없습니다. 초안을 다시 만드세요.", "The file list is invalid. Make a new draft."),
    PROJECT_TOO_LARGE: t("파일이 너무 큽니다. 더 작은 프로젝트를 요청하세요.", "The files are too large. Request a smaller project."),
    PROJECT_MODEL_REQUIRED: t("모델 설정에서 API 모델이나 Ollama를 선택하세요.", "Choose an API model or Ollama in Model settings."),
    PROJECT_MODEL_FAILED: t("모델이 응답하지 않았습니다. 모델 설정에서 연결을 확인하세요.", "The model did not respond. Check its connection in Model settings."),
    PROJECT_INVALID_DESTINATION: t("다른 저장 폴더를 선택하세요.", "Choose another folder."),
    PROJECT_EXISTS: t("이름이 같은 폴더가 있습니다. 다른 위치나 이름을 선택하세요.", "A folder with this name exists. Choose a different location or name."),
    PROJECT_PERMISSION: t("컴퓨터 제어를 확인하고 초안을 다시 만드세요.", "Check Computer control and make a new draft."),
    PROJECT_REVIEW_REQUIRED: t("초안을 다시 만든 뒤 내용을 확인하세요.", "Make and review a new draft."),
    PROJECT_BUSY: t("진행 중인 작업이 끝난 뒤 다시 시도하세요.", "Wait for the current operation to finish."),
    PROJECT_OPEN_FAILED: t("열지 못했습니다. 앱 설치와 폴더 위치를 확인하세요.", "Couldn’t open the project. Check the app and folder location."),
    PROJECT_PARTIAL: t("아래 폴더에 일부 파일이 남아 있을 수 있습니다.", "Some project files may remain in the folder below."),
    PROJECT_FAILED: t("작업을 마치지 못했습니다. 저장 위치와 권한을 확인하세요.", "Couldn’t finish the operation. Check the folder and permissions."),
  };

  async function run<T>(
    next: "prepare" | "save" | "open",
    tool: string,
    payload: Record<string, unknown>,
    apply: (result: T) => void,
  ) {
    const invoke = window.assistantAPI?.invokeTool;
    if (!computerControl || operation || !invoke) return;
    setFeedback(null);
    setOperation(next);
    try {
      const result = await invoke(tool, payload) as Result<T>;
      if (!active.current) return;
      if (!result.ok) setFeedback({ key: result.reason, path: result.path });
      else if (result.outcome === "cancelled") setFeedback({ key: "cancelled" });
      else if (result.data) apply(result.data);
    } catch {
      if (active.current) setFeedback({ key: "PROJECT_PERMISSION" });
    } finally {
      if (active.current) setOperation(null);
    }
  }

  function prepare(event: FormEvent) {
    event.preventDefault();
    void run<Project>("prepare", "project:create", { template, name, prompt: template === "model" ? prompt : "" }, setProject);
  }

  const pendingLabel = operation === "prepare"
    ? t("초안을 만드는 중…", "Preparing draft…")
    : operation === "save" ? t("저장 위치 확인 중…", "Waiting for the save location…")
      : t("프로젝트를 여는 중…", "Opening project…");
  const disabled = !computerControl || operation !== null;

  return (
    <div className="jarvis-text-tool">
      {computerControl !== true && <p role="status" className="jarvis-result-detail">
        {computerControl === null
          ? t("코딩 프로젝트 만들기는 Jarvis 데스크톱에서 사용할 수 있습니다.", "Coding project creation is available in Jarvis Desktop.")
          : t("툴바에서 컴퓨터 제어를 켜세요.", "Turn on Computer control in the toolbar.")}
      </p>}
      {!project && (
        <form className="grid gap-3" onSubmit={prepare}>
          <label className="grid gap-2 text-sm">
            {t("시작 방식", "Start from")}
            <select className="jarvis-text-tool-control" value={template} disabled={Boolean(operation)}
              onChange={(event) => { setTemplate(event.target.value as Template); setFeedback(null); }}>
              <option value="web">{t("기본 웹 페이지", "Basic web page")}</option>
              <option value="tasks">{t("할 일 웹 앱", "Task list app")}</option>
              <option value="grid">{t("격자 게임", "Grid game")}</option>
              <option value="model">{t("모델에 설명하기", "Describe to model")}</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            {t("프로젝트 이름 (선택)", "Project name (optional)")}
            <input className="jarvis-text-tool-control" value={name} maxLength={120} disabled={Boolean(operation)}
              onChange={(event) => setName(event.target.value)} autoComplete="off" />
          </label>
          {template === "model" && <label className="grid gap-2 text-sm">
            {t("프로젝트 설명", "Project description")}
            <textarea className="jarvis-text-tool-control" value={prompt} maxLength={2000} disabled={Boolean(operation)}
              onChange={(event) => setPrompt(event.target.value)} />
            <span className="jarvis-result-detail">
              {t("초안을 만들 때 이름과 설명을 설정된 모델로 보냅니다.", "The name and description go to your configured model when you request a draft.")}
            </span>
          </label>}
          <button className="jarvis-secondary-button justify-self-end" type="submit"
            disabled={disabled || (template === "model" && !prompt.trim())}>
            {template === "model" ? t("모델로 초안 만들기", "Draft with model") : t("파일 미리보기", "Preview files")}
          </button>
        </form>
      )}
      {project && !receipt && (
        <>
          <div className="grid gap-1">
            <h3 ref={stepTitle} tabIndex={-1} className="break-all text-sm font-semibold">
              {project.projectName}
            </h3>
            <p className="jarvis-result-detail break-all">
              {project.source.type === "template" ? t("내장 템플릿", "Built-in template")
                : t("모델", "Model") + " · " + project.source.provider + " / " + project.source.model}
            </p>
          </div>
          <div className="grid min-w-0 gap-2">
            {project.files.map((file) => (
              <details key={file.path} className="jarvis-file-preview">
                <summary className="break-all">{file.path}</summary>
                <pre tabIndex={0}>{file.content || t("(빈 파일)", "(Empty file)")}</pre>
              </details>
            ))}
          </div>
          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3">
            <button type="button" className="jarvis-secondary-button" disabled={Boolean(operation)}
              onClick={() => { setProject(null); setFeedback(null); }}>{t("설정으로 돌아가기", "Back")}</button>
            <button type="button" className="jarvis-secondary-button" disabled={disabled}
              onClick={() => void run<Receipt>("save", "project:save", { id: project.id, language: ko ? "ko" : "en" }, setReceipt)}>
              {t("폴더 선택 후 만들기…", "Choose folder and create…")}
            </button>
          </div>
        </>
      )}
      {project && receipt && (
        <>
          <h3 ref={stepTitle} tabIndex={-1} className="text-sm font-semibold">
            {t("프로젝트를 만들었습니다.", "Project created.")}
          </h3>
          <p className="jarvis-result-detail break-all">{receipt.path}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="jarvis-secondary-button" disabled={disabled}
              onClick={() => void run("open", "project:open", { id: project.id }, () => {})}>
              {t("폴더 열기", "Open folder")}
            </button>
            <button type="button" className="jarvis-secondary-button" disabled={disabled}
              onClick={() => void run("open", "project:open", { id: project.id, editor: "vscode" }, () => {})}>
              {t("VS Code에서 열기", "Open in VS Code")}
            </button>
          </div>
        </>
      )}
      {operation && <p role="status" className="jarvis-result-detail">{pendingLabel}</p>}
      {feedback?.key === "cancelled" && <p role="status" className="jarvis-result-detail">{t("저장을 취소했습니다.", "Save cancelled.")}</p>}
      {feedback && feedback.key !== "cancelled" && (
        <div role="alert" className="jarvis-result-detail break-all">
          <p>{errors[feedback.key] ?? errors.PROJECT_FAILED}</p>
          {feedback.path && <p>{feedback.path}</p>}
        </div>
      )}
    </div>
  );
}
