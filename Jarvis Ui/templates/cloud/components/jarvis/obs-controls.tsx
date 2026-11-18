"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useWorkspaceLocale } from "@/lib/workspace-language";

const DEFAULT_ADDRESS = "ws://127.0.0.1:4455";
type ObsStatus = { address: string; currentScene: string; outputActive: boolean; outputReconnecting: boolean; scenes: string[] };
type ObsTool = "obs:connect" | "obs:status" | "obs:scene" | "obs:start" | "obs:stop";
type ObsResult = { ok: true; data: ObsStatus; outcome?: "cancelled" | "unchanged" | "requested" } |
  { ok: false; reason: string };

export function ObsControls({ computerControl }: { computerControl: boolean | null }) {
  const ko = useWorkspaceLocale().startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const [status, setStatus] = useState<ObsStatus | null>(null);
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [password, setPassword] = useState("");
  const [scene, setScene] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"cancelled" | "unchanged" | "requested" | null>(null);
  const request = useRef(0);

  function showStatus(data: ObsStatus) {
    setStatus(data);
    setAddress(data.address);
    setScene(data.scenes.includes(data.currentScene) ? data.currentScene : data.scenes[0] || "");
  }

  useEffect(() => {
    if (!computerControl || !window.assistantAPI?.invokeTool) {
      setStatus(null);
      return;
    }
    const current = ++request.current;
    setBusy(true);
    void window.assistantAPI.invokeTool("obs:status")
      .then((response) => {
        if (current !== request.current) return;
        const result = response as ObsResult;
        if (result.ok) showStatus(result.data);
        else if (result.reason !== "OBS_DISCONNECTED") setError(result.reason);
      }).catch(() => {
        if (current === request.current) setError("OBS_REQUEST");
      }).finally(() => {
        if (current === request.current) setBusy(false);
      });
    return () => { request.current++; };
  }, [computerControl]);

  async function run(tool: ObsTool, payload?: Record<string, unknown>) {
    if (!computerControl || busy || !window.assistantAPI?.invokeTool) return;
    const current = ++request.current;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await window.assistantAPI.invokeTool(tool, { ...payload, language: ko ? "ko" : "en" }) as ObsResult;
      if (current !== request.current) return;
      if (result.ok) {
        showStatus(result.data);
        setOutcome(result.outcome ?? null);
        if (tool === "obs:connect") setPassword("");
      } else {
        setError(result.reason);
        setStatus(null);
      }
    } catch {
      if (current === request.current) {
        setError("OBS_REQUEST");
        setStatus(null);
      }
    } finally {
      if (current === request.current) setBusy(false);
    }
  }

  const errors: Record<string, string> = {
    OBS_ADDRESS: t("유효한 OBS WebSocket 주소를 입력하세요.", "Enter a valid OBS WebSocket address."),
    OBS_AUTH: t("OBS가 비밀번호를 거부했습니다.", "OBS rejected the password."),
    OBS_DISCONNECTED: t("OBS 연결을 확인하세요.", "Check the OBS connection."),
    OBS_TIMEOUT: t("OBS가 제시간에 응답하지 않았습니다.", "OBS did not respond in time."),
    OBS_BUSY: t("진행 중인 OBS 작업을 먼저 완료하세요.", "Wait for the current OBS operation to finish."),
    OBS_CHANGED: t("OBS 상태가 바뀌었습니다. 새로 고침 후 다시 확인하세요.", "OBS changed. Refresh and review the current state."),
    OBS_PERMISSION: t("컴퓨터 제어 설정을 확인하세요.", "Check Computer control settings."),
    OBS_REQUEST: t("OBS 상태를 확인할 수 없습니다. OBS와 WebSocket 설정을 확인하고 새로 고침하세요.",
      "OBS status is unavailable. Check OBS and its WebSocket settings, then refresh."),
  };
  const messages = {
    cancelled: t("방송 변경을 취소했습니다.", "Broadcast change cancelled."),
    unchanged: t("이미 요청한 방송 상태입니다.", "OBS is already in the requested state."),
    requested: t("OBS로 요청을 보냈습니다. 표시된 방송 상태를 확인하세요.", "Request sent to OBS. Check the displayed broadcast state."),
  };

  function connect(event: FormEvent) {
    event.preventDefault();
    void run("obs:connect", { address, password });
  }

  return (
    <div className="jarvis-text-tool">
      {computerControl !== true && <p role="status" className="jarvis-result-detail">
        {computerControl === false
          ? t("툴바에서 컴퓨터 제어를 켜세요.", "Turn on Computer control in the toolbar.")
          : t("OBS 연동은 Jarvis 데스크톱에서 사용할 수 있습니다.", "OBS controls are available in Jarvis Desktop.")}
      </p>}
      {status ? (
        <>
          <div className="grid gap-1" role="status">
            <p className="font-semibold">
              {status.outputReconnecting ? t("OBS 재연결 중", "OBS reconnecting")
                : status.outputActive ? t("방송 중", "Broadcasting") : t("방송 대기", "Not broadcasting")}
            </p>
            <p className="jarvis-result-detail break-all">{status.address}</p>
            <p className="text-sm break-all">{t("현재 장면", "Current scene")} · {status.currentScene}</p>
          </div>
          <label className="grid gap-2 text-sm">
            {t("장면 선택", "Select scene")}
            <select className="jarvis-text-tool-control" value={scene} disabled={busy}
              onChange={(event) => setScene(event.target.value)}>
              {status.scenes.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <button type="button" className="jarvis-secondary-button justify-self-end"
            disabled={busy || !scene || scene === status.currentScene}
            onClick={() => void run("obs:scene", { sceneName: scene })}>
            {t("장면 전환", "Switch scene")}
          </button>
          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3">
            <button type="button" className="jarvis-secondary-button" disabled={busy} onClick={() => setStatus(null)}>
              {t("연결 변경", "Change connection")}
            </button>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="jarvis-secondary-button" disabled={busy} onClick={() => void run("obs:status")}>
                {t("새로 고침", "Refresh")}
              </button>
              <button type="button" className="jarvis-secondary-button" disabled={busy || status.outputReconnecting}
                onClick={() => void run(status.outputActive ? "obs:stop" : "obs:start")}>
                {status.outputActive ? t("방송 종료", "Stop broadcast") : t("방송 시작", "Start broadcast")}
              </button>
            </div>
          </div>
        </>
      ) : (
        <form className="grid gap-3" onSubmit={connect}>
          <label className="grid gap-2 text-sm">
            {t("WebSocket 주소", "WebSocket address")}
            <input className="jarvis-text-tool-control" value={address} maxLength={1024} disabled={busy}
              spellCheck={false} autoComplete="off" onChange={(event) => setAddress(event.target.value)} />
          </label>
          <label className="grid gap-2 text-sm">
            {t("OBS 비밀번호", "OBS password")}
            <input className="jarvis-text-tool-control" value={password} type="password" autoComplete="off"
              maxLength={1024} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="jarvis-secondary-button" disabled={!computerControl || busy}
              onClick={() => void run("obs:status")}>{t("새로 고침", "Refresh")}</button>
            <button type="submit" className="jarvis-secondary-button" disabled={!computerControl || busy || !address.trim()}>
              {t("연결", "Connect")}
            </button>
          </div>
        </form>
      )}
      {busy && <p role="status" className="jarvis-result-detail">{t("OBS 확인 중…", "Checking OBS…")}</p>}
      {error && <p role="alert" className="jarvis-result-detail">{errors[error] ?? errors.OBS_REQUEST}</p>}
      {outcome && <p role="status" className="jarvis-result-detail">{messages[outcome]}</p>}
    </div>
  );
}
