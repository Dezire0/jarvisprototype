const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium } = require("playwright");

const testUrl = process.env.JARVIS_UI_TEST_URL;

test("weather asks before location or network access, lets users choose a city, and cancels on exit", {
  skip: !testUrl && "Set JARVIS_UI_TEST_URL to a running local Jarvis UI.",
  timeout: 30000,
}, async () => {
  const url = new URL("/tools", testUrl);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "en-US", reducedMotion: "reduce" });
    page.setDefaultTimeout(6000);
    const forecastRequests = [];
    const cityRequests = [];
    let chatRequests = 0;
    let forecastStatus = 503;
    let releaseSlowSearch;
    const slowSearch = new Promise((resolve) => { releaseSlowSearch = resolve; });
    await page.route("**/*", async (route) => {
      const target = new URL(route.request().url());
      const cors = { "access-control-allow-origin": "*" };
      if (target.hostname === "geocoding-api.open-meteo.com") {
        const query = target.searchParams.get("name");
        cityRequests.push(query);
        if (query === "Slow") {
          await slowSearch;
          return route.abort().catch(() => {});
        }
        const results = query === "Unknown" ? [] : [
          { id: 1, name: "Springfield", admin1: "Illinois", country: "United States", latitude: 39.80172, longitude: -89.64371 },
          { id: 2, name: "Springfield", admin1: "Missouri", country: "United States", latitude: 37.21533, longitude: -93.29824 },
        ];
        return route.fulfill({ headers: cors, json: { results } });
      }
      if (target.hostname === "api.open-meteo.com") {
        forecastRequests.push(target.searchParams);
        return route.fulfill({
          status: forecastStatus,
          headers: cors,
          json: { current: { temperature_2m: 19, relative_humidity_2m: 54, wind_speed_10m: 8, weather_code: 0 } },
        });
      }
      if (target.origin !== url.origin) return route.abort();
      if (target.pathname === "/api/chat") chatRequests++;
      return route.continue();
    });
    await page.addInitScript(() => {
      window.locationCalls = 0;
      window.denyLocation = true;
      window.weatherAborts = 0;
      navigator.geolocation.getCurrentPosition = (success, error) => {
        window.locationCalls++;
        if (window.denyLocation) error({ code: 1 });
        else success({ coords: { latitude: 43.653226, longitude: -79.383184 } });
      };
      const fetchNetwork = window.fetch;
      window.fetch = (input, options) => {
        const url = new URL(input, location.href);
        if (url.hostname === "geocoding-api.open-meteo.com") {
          options.signal.addEventListener("abort", () => window.weatherAborts++, { once: true });
        }
        return fetchNetwork(input, options);
      };
    });
    await page.goto(url.href);
    const command = page.getByRole("textbox", { name: "Local command" });
    await command.fill("weather");
    await command.press("Enter");

    const weather = page.getByRole("region", { name: "Weather" });
    const city = weather.getByRole("searchbox", { name: "City name" });
    await city.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "City name");
    assert.deepEqual(cityRequests, []);
    assert.equal(forecastRequests.length, 0);
    assert.equal(await page.evaluate(() => window.locationCalls), 0);

    await weather.getByRole("button", { name: "Use current location" }).click();
    await weather.getByRole("alert").getByText("Couldn’t get your location. Search for a city instead.").waitFor();
    assert.equal(forecastRequests.length, 0);

    await city.fill("Unknown");
    await city.press("Enter");
    await weather.getByText("No cities found. Try the full city name or its English spelling.", { exact: true }).waitFor();
    await city.fill("Springfield");
    await city.press("Enter");
    const missouri = weather.getByRole("button", { name: "Springfield, Missouri, United States", exact: true });
    await missouri.waitFor();
    assert.equal(await weather.getByRole("list", { name: "City matches" }).getByRole("button").count(), 2);
    assert.equal(forecastRequests.length, 0);

    await missouri.click();
    await weather.getByRole("alert").getByText("Couldn’t load the weather. Try again.").waitFor();
    forecastStatus = 200;
    await missouri.click();
    await weather.getByRole("status").getByText("Springfield, Missouri, United States · 19 °C").waitFor();
    assert.equal(forecastRequests[1].get("latitude"), "37.22");
    assert.equal(forecastRequests[1].get("longitude"), "-93.30");
    await weather.getByText("Clear · Humidity 54% · Wind 8 km/h").waitFor();

    await page.evaluate(() => { window.denyLocation = false; });
    await weather.getByRole("button", { name: "Use current location" }).click();
    await weather.getByRole("status").getByText("Current location · 19 °C").waitFor();
    assert.equal(forecastRequests[2].get("latitude"), "43.65");
    assert.equal(forecastRequests[2].get("longitude"), "-79.38");
    assert.equal(await page.evaluate(() => window.locationCalls), 2);

    await city.fill("Slow");
    const requested = page.waitForRequest((request) => new URL(request.url()).searchParams.get("name") === "Slow");
    await city.press("Enter");
    await requested;
    await weather.getByText("Searching for cities…").waitFor();
    const toggler = page.getByRole("button", { name: "Weather", exact: true });
    await toggler.click();
    await weather.waitFor({ state: "hidden" });
    await page.waitForFunction(() => window.weatherAborts > 0);
    releaseSlowSearch();
    await toggler.click();
    await city.waitFor();
    assert.equal(await city.inputValue(), "");
    assert.deepEqual(cityRequests, ["Unknown", "Springfield", "Slow"]);
    assert.equal(forecastRequests.length, 3);
    assert.equal(chatRequests, 0);
  } finally {
    await browser.close();
  }
});
