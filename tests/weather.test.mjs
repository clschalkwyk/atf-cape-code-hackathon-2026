import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchTodayWeather, weatherCondition, weatherDate, weatherGreeting, WeatherError,
  WEATHER_REFRESH_MS
} from "../weather.mjs";

const position = { latitude: -25.7479, longitude: 28.2293 };
const payload = {
  timezone: "Africa/Johannesburg",
  current: {
    time: "2026-11-19T14:00",
    temperature_2m: 32.2,
    apparent_temperature: 33.4,
    relative_humidity_2m: 42,
    weather_code: 1,
    is_day: 1,
    wind_speed_10m: 11.6,
    precipitation: 0
  },
  daily: { temperature_2m_max: [34.1], temperature_2m_min: [20.2] }
};

test("requests location-based live weather with local timezone and no stored response", async () => {
  let url;
  let opts;
  const result = await fetchTodayWeather(position, async (u, o) => {
    url = new URL(u);
    opts = o;
    return { ok: true, json: async () => payload };
  });
  assert.equal(url.origin, "https://api.open-meteo.com");
  assert.equal(url.searchParams.get("latitude"), String(position.latitude));
  assert.equal(url.searchParams.get("longitude"), String(position.longitude));
  assert.equal(url.searchParams.get("timezone"), "auto");
  assert.equal(url.searchParams.get("forecast_days"), "1");
  assert.ok(url.searchParams.get("current").includes("relative_humidity_2m"));
  assert.equal(opts.cache, "no-store");
  assert.equal(opts.credentials, "omit");
  assert.equal(result.temperature, 32.2);
  assert.equal(result.high, 34.1);
  assert.equal(result.low, 20.2);
  assert.equal(result.label, "Partly cloudy");
  assert.equal(result.timezone, "Africa/Johannesburg");
  assert.equal(WEATHER_REFRESH_MS, 900_000);
});

test("formats greeting and date using farm timezone rather than device timezone", () => {
  const moment = new Date("2026-11-19T12:01:00Z");
  assert.equal(weatherGreeting(moment, "Africa/Johannesburg"), "Good afternoon, Farmer");
  assert.equal(weatherGreeting(moment, "America/New_York"), "Good morning, Farmer");
  assert.match(weatherDate(moment, "Africa/Johannesburg"), /19 November 2026/);
  assert.equal(weatherGreeting(new Date("2026-11-19T19:00:00Z"), "Africa/Johannesburg"), "Good evening, Farmer");
});

test("maps weather codes to understandable conditions", () => {
  assert.equal(weatherCondition(0, true).label, "Clear sky");
  assert.equal(weatherCondition(3).label, "Overcast");
  assert.equal(weatherCondition(61).label, "Rain");
  assert.equal(weatherCondition(95).label, "Thunderstorm");
  assert.equal(weatherCondition(500).label, "Conditions unavailable");
});

test("rejects invalid or incomplete location and forecast data", async () => {
  await assert.rejects(fetchTodayWeather({ latitude: 110, longitude: 20 }), (e) => e.code === "invalid_location");
  await assert.rejects(fetchTodayWeather(position, async () => ({ ok: true, json: async () =>
    ({ ...payload, current: { ...payload.current, temperature_2m: null } }) })),
    (e) => e.code === "invalid_response");
  await assert.rejects(fetchTodayWeather(position, async () => ({ ok: false, status: 429 })),
    (e) => e.code === "unavailable");
});

test("a failed network request does not fabricate conditions", async () => {
  await assert.rejects(fetchTodayWeather(position, async () => {
    throw new TypeError("offline");
  }), (e) => e instanceof WeatherError && e.code === "unavailable");
});

test("a timed-out weather request fails cleanly", async () => {
  await assert.rejects(fetchTodayWeather(position, (_url, opts) =>
    new Promise((_resolve, reject) => opts.signal.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError")))), 5),
    (e) => e.code === "timeout");
});

test("explicit cancellation is different from a timeout", async () => {
  const controller = new AbortController();
  const response = fetchTodayWeather(position, (_url, opts) =>
    new Promise((_resolve, reject) => opts.signal.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError")))), 5_000, controller.signal);
  controller.abort();
  await assert.rejects(response, (e) => e.code === "cancelled");
});
