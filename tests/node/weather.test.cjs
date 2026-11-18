const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readCurrentWeather, searchWeatherPlaces, weatherCondition } = require("../../Jarvis Ui/templates/cloud/lib/weather.ts");

test("city search validates provider data and returns distinguishable choices", async (t) => {
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.origin, "https://geocoding-api.open-meteo.com");
    assert.equal(url.pathname, "/v1/search");
    assert.deepEqual(Object.fromEntries(url.searchParams), { name: "서울 & test", count: "5", language: "ko" });
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    return Response.json({ results: [
      { id: 1, name: "서울", admin1: "서울", country: "대한민국", latitude: 37.5665, longitude: 126.978 },
      { id: 2, name: "서울", admin1: "비정상", latitude: 110, longitude: 95 },
      { id: 3, name: "서울", admin1: "다른 지역", latitude: 25.52, longitude: 126.4 },
      null,
    ] });
  });
  assert.deepEqual(await searchWeatherPlaces("서울 & test", "ko", controller.signal), [
    { id: 1, label: "서울, 대한민국", latitude: 37.5665, longitude: 126.978 },
    { id: 3, label: "서울, 다른 지역", latitude: 25.52, longitude: 126.4 },
  ]);
  controller.abort();
  await assert.rejects(searchWeatherPlaces("서울 & test", "ko", controller.signal), { name: "AbortError" });
  assert.equal(fetch.mock.callCount(), 1);
});

test("weather rounds locations and omits absent or malformed optional readings", async (t) => {
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url.origin, "https://api.open-meteo.com");
    assert.equal(url.pathname, "/v1/forecast");
    assert.equal(url.searchParams.get("latitude"), "37.57");
    assert.equal(url.searchParams.get("longitude"), "126.98");
    assert.equal(url.searchParams.get("temperature_unit"), "celsius");
    assert.equal(url.searchParams.get("wind_speed_unit"), "kmh");
    return Response.json({ current: {
      temperature_2m: 12.5, relative_humidity_2m: null, wind_speed_10m: -1, weather_code: 0,
    } });
  });
  assert.deepEqual(await readCurrentWeather({ latitude: 37.5665, longitude: 126.978 }, controller.signal), {
    temperature: 12.5, humidity: undefined, wind: undefined, code: 0,
  });
  await assert.rejects(readCurrentWeather({ latitude: 91, longitude: 126.978 }, controller.signal), /Invalid location/);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(weatherCondition(0, true), "맑음");
  assert.equal(weatherCondition(81, false), "Rain");
  assert.equal(weatherCondition(120, false), null);
});

test("the common Korean name for Seoul resolves through its indexed name", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url.searchParams.get("name"), "서울특별시");
    return Response.json({ results: [
      { id: 42, name: "서울특별시", country: "대한민국", latitude: 37.566, longitude: 126.9784 },
    ] });
  });
  const places = await searchWeatherPlaces("서울", "ko", new AbortController().signal);
  assert.deepEqual(places, [{ id: 42, label: "서울특별시, 대한민국", latitude: 37.566, longitude: 126.9784 }]);
  assert.equal(fetch.mock.callCount(), 1);
});

test("weather treats provider and malformed response failures separately from no matches", async (t) => {
  const signal = new AbortController().signal;
  const coords = { latitude: 37.56, longitude: 126.98 };
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  assert.deepEqual(await searchWeatherPlaces("Unknown", "en", signal), []);
  await assert.rejects(readCurrentWeather(coords, signal), /Invalid weather response/);
  fetch.mock.mockImplementation(async () => Response.json({ results: null }));
  await assert.rejects(searchWeatherPlaces("Toronto", "en", signal), /Invalid city response/);
  fetch.mock.mockImplementation(async () => Response.json({}, { status: 503 }));
  await assert.rejects(readCurrentWeather(coords, signal), /Weather service unavailable/);
});
