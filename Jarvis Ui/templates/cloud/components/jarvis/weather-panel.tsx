"use client";

import { Volume2Icon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { speakLocalResult } from "@/lib/local-speech";
import { readCurrentWeather, searchWeatherPlaces, weatherCondition, type CurrentWeather, type WeatherPlace } from "@/lib/weather";
import { useWorkspaceLocale } from "@/lib/workspace-language";

type WeatherState =
  | { kind: "idle" | "searching" | "locating" | "loading" | "no-matches" }
  | { kind: "ready"; label: string; weather: CurrentWeather }
  | { kind: "error"; message: string };

export function WeatherPanel({ canUseBrowserLocation, inDialog = false }: {
  canUseBrowserLocation: boolean;
  inDialog?: boolean;
}) {
  const locale = useWorkspaceLocale();
  const ko = locale.startsWith("ko");
  const t = (korean: string, english: string) => ko ? korean : english;
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<WeatherPlace[]>([]);
  const [state, setState] = useState<WeatherState>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    input.current?.focus();
    return () => request.current?.abort();
  }, []);

  function startRequest() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    return controller.signal;
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const name = query.trim();
    if (name.length < 2) return;
    const signal = startRequest();
    setPlaces([]);
    setState({ kind: "searching" });
    try {
      const matches = await searchWeatherPlaces(name, ko ? "ko" : "en", signal);
      if (signal.aborted) return;
      setPlaces(matches);
      setState({ kind: matches.length ? "idle" : "no-matches" });
    } catch {
      if (!signal.aborted) {
        setState({ kind: "error", message: t("도시를 검색하지 못했습니다. 다시 시도하세요.", "Couldn’t search for cities. Try again.") });
      }
    }
  }

  async function forecast(coords: { latitude: number; longitude: number }, label: string, signal: AbortSignal) {
    if (signal.aborted) return;
    setState({ kind: "loading" });
    try {
      const weather = await readCurrentWeather(coords, signal);
      if (!signal.aborted) setState({ kind: "ready", label, weather });
    } catch {
      if (!signal.aborted) {
        setState({ kind: "error", message: t("날씨를 불러오지 못했습니다. 다시 시도하세요.", "Couldn’t load the weather. Try again.") });
      }
    }
  }

  async function useLocation() {
    const signal = startRequest();
    setPlaces([]);
    setState({ kind: "locating" });
    let position: GeolocationPosition;
    try {
      if (!navigator.geolocation) throw new Error("Location unavailable");
      position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 12000, maximumAge: 300000 });
      });
    } catch {
      if (!signal.aborted) {
        setState({ kind: "error", message: t("현재 위치를 가져오지 못했습니다. 도시를 검색하세요.", "Couldn’t get your location. Search for a city instead.") });
      }
      return;
    }
    await forecast(position.coords, t("현재 위치", "Current location"), signal);
  }

  const pendingText = {
    searching: t("도시 검색 중…", "Searching for cities…"),
    locating: t("현재 위치 확인 중…", "Getting your location…"),
    loading: t("날씨 조회 중…", "Loading the weather…"),
    "no-matches": t("도시를 찾지 못했습니다. 정식 명칭이나 영문 이름으로 검색하세요.", "No cities found. Try the full city name or its English spelling."),
  };
  const status = state.kind in pendingText ? pendingText[state.kind as keyof typeof pendingText] : null;
  const forecastPending = state.kind === "loading" || state.kind === "locating";
  const format = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  const summary = state.kind === "ready" ? [
    weatherCondition(state.weather.code, ko),
    state.weather.humidity !== undefined && t("습도", "Humidity") + " " + format(state.weather.humidity) + "%",
    state.weather.wind !== undefined && t("바람", "Wind") + " " + format(state.weather.wind) + " km/h",
  ].filter(Boolean).join(" · ") : "";

  return (
    <section className={inDialog ? "jarvis-weather-dialog-content" : "jarvis-tool-section"}
      id="jarvis-weather-panel"
      aria-label={inDialog ? t("날씨", "Weather") : undefined}
      aria-labelledby={inDialog ? undefined : "jarvis-weather"}>
      {!inDialog && <h2 id="jarvis-weather">{t("날씨", "Weather")}</h2>}
      <p className="jarvis-result-detail">
        {canUseBrowserLocation
          ? t("도시 이름 또는 소수점 두 자리로 반올림한 좌표를 Open-Meteo에 보냅니다.",
            "Jarvis sends the city name or coordinates rounded to two decimal places to Open-Meteo.")
          : t("검색한 도시 이름과 선택한 도시의 좌표를 Open-Meteo에 보냅니다.",
            "Jarvis sends the city name you search for and the coordinates of the city you select to Open-Meteo.")}
      </p>
      <form className="jarvis-entry-form" onSubmit={search}>
        <input ref={input} data-tool-focus type="search" value={query} maxLength={80}
          onChange={(event) => setQuery(event.target.value)} autoComplete="off"
          aria-label={t("도시 이름", "City name")} placeholder={t("예: 서울", "e.g. Toronto")} />
        <button type="submit" className="jarvis-secondary-button" disabled={query.trim().length < 2 || state.kind === "searching"}>
          {t("검색", "Search")}
        </button>
      </form>
      {canUseBrowserLocation && (
        <div>
          <button type="button" className="jarvis-secondary-button" onClick={() => void useLocation()} disabled={forecastPending}>
            {t("현재 위치 사용", "Use current location")}
          </button>
        </div>
      )}
      {places.length > 0 && (
        <ul aria-label={t("도시 검색 결과", "City matches")} className="jarvis-weather-places">
          {places.map((place) => (
            <li key={place.id}>
              <button type="button" className="jarvis-toolbar-link" disabled={forecastPending}
                onClick={() => void forecast(place, place.label, startRequest())}>
                {place.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {status && <p role="status" className="jarvis-result-detail">{status}</p>}
      {state.kind === "error" && <p role="alert" className="jarvis-result-detail">{state.message}</p>}
      {state.kind === "ready" && (
        <div className="jarvis-local-result">
          <div role="status">
            <p className="font-semibold">{state.label} · {format(state.weather.temperature)} °C</p>
            {summary && <p className="jarvis-result-detail">{summary}</p>}
          </div>
          {"speechSynthesis" in window && (
            <button type="button" className="jarvis-icon-button" aria-label={t("날씨 읽기", "Read weather aloud")}
              onClick={() => speakLocalResult([state.label, format(state.weather.temperature) + " °C", summary].filter(Boolean).join(". "), locale)}>
              <Volume2Icon size={17} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      <a className="jarvis-start-link-text jarvis-weather-attribution" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
        {t("날씨 데이터 제공 Open-Meteo", "Weather data by Open-Meteo")}
      </a>
    </section>
  );
}
