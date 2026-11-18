type Coordinates = { latitude: number; longitude: number };
export type WeatherPlace = Coordinates & { id: number; label: string };
export type CurrentWeather = {
  temperature: number;
  humidity?: number;
  wind?: number;
  code?: number;
};

function validCoordinates(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}

async function requestWeather(url: URL, signal: AbortSignal) {
  signal.throwIfAborted();
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Weather service unavailable");
  return response.json();
}

export async function searchWeatherPlaces(query: string, language: string, signal: AbortSignal): Promise<WeatherPlace[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  // Open-Meteo indexes Seoul under its official Korean name.
  const name = query === "서울" ? "서울특별시" : query;
  url.search = new URLSearchParams({ name, count: "5", language }).toString();
  const data = await requestWeather(url, signal);
  if (!data || typeof data !== "object" || Array.isArray(data) || data.error ||
      (data.results !== undefined && !Array.isArray(data.results))) {
    throw new Error("Invalid city response");
  }
  const places = new Map<number, WeatherPlace>();
  for (const result of (data.results ?? []).slice(0, 5)) {
    if (!Number.isSafeInteger(result?.id) || typeof result.name !== "string" || !result.name.trim() ||
        !validCoordinates(result.latitude, result.longitude)) continue;
    const labels = [result.name, result.admin2, result.admin1, result.country].filter(
      (label): label is string => typeof label === "string" && Boolean(label.trim()),
    );
    places.set(result.id, {
      id: result.id, label: [...new Set(labels)].join(", "),
      latitude: result.latitude, longitude: result.longitude,
    });
  }
  if (data.results?.length && !places.size) throw new Error("Invalid city response");
  return [...places.values()];
}

export async function readCurrentWeather(coords: Coordinates, signal: AbortSignal): Promise<CurrentWeather> {
  if (!validCoordinates(coords.latitude, coords.longitude)) throw new Error("Invalid location");
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: coords.latitude.toFixed(2),
    longitude: coords.longitude.toFixed(2),
    current: "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
  }).toString();
  const data = await requestWeather(url, signal);
  const current = data?.current;
  if (!Number.isFinite(current?.temperature_2m)) throw new Error("Invalid weather response");
  return {
    temperature: current.temperature_2m,
    humidity: Number.isFinite(current.relative_humidity_2m) && current.relative_humidity_2m >= 0 &&
      current.relative_humidity_2m <= 100 ? current.relative_humidity_2m : undefined,
    wind: Number.isFinite(current.wind_speed_10m) && current.wind_speed_10m >= 0 ? current.wind_speed_10m : undefined,
    code: Number.isInteger(current.weather_code) ? current.weather_code : undefined,
  };
}

export function weatherCondition(code: number | undefined, korean: boolean) {
  switch (code) {
    case 0: return korean ? "맑음" : "Clear";
    case 1: case 2: return korean ? "구름 조금" : "Partly cloudy";
    case 3: return korean ? "흐림" : "Overcast";
    case 45: case 48: return korean ? "안개" : "Fog";
    case 51: case 53: case 55: return korean ? "이슬비" : "Drizzle";
    case 56: case 57: case 66: case 67: return korean ? "어는 비" : "Freezing precipitation";
    case 61: case 63: case 65: case 80: case 81: case 82: return korean ? "비" : "Rain";
    case 71: case 73: case 75: case 77: case 85: case 86: return korean ? "눈" : "Snow";
    case 95: case 96: case 99: return korean ? "뇌우" : "Thunderstorms";
    default: return null;
  }
}
