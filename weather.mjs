// Current weather is supplementary context, not a crop suitability prediction.
// Open-Meteo free API is for non-commercial evaluation; production commercial
// deployment requires a licensed provider/plan.
export class WeatherError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WeatherError";
    this.code = code;
  }
}

export const WEATHER_REFRESH_MS = 15 * 60 * 1000;
const WEATHER_TIMEOUT_MS = 10_000;
const WEATHER_API = "https://api.open-meteo.com/v1/forecast";
const WEATHER_FIELDS = [
  "temperature_2m", "apparent_temperature", "relative_humidity_2m",
  "weather_code", "is_day", "wind_speed_10m", "precipitation"
].join(",");

export function weatherGreeting(now = new Date(), timezone) {
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || undefined, hour: "2-digit", hourCycle: "h23"
    }).format(now));
  } catch {
    hour = now.getHours();
  }
  if (hour < 12) return "Good morning, Farmer";
  if (hour < 17) return "Good afternoon, Farmer";
  return "Good evening, Farmer";
}

export function weatherDate(now = new Date(), timezone) {
  try {
    return new Intl.DateTimeFormat("en-ZA", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
      timeZone: timezone || undefined
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-ZA", {
      weekday: "long", day: "numeric", month: "long", year: "numeric"
    }).format(now);
  }
}

export function weatherCondition(code, isDay = true) {
  if (code === 0) return { label: "Clear sky", symbol: isDay ? "☀" : "☾" };
  if (code === 1 || code === 2) return { label: "Partly cloudy", symbol: isDay ? "⛅" : "☁" };
  if (code === 3) return { label: "Overcast", symbol: "☁" };
  if (code === 45 || code === 48) return { label: "Fog", symbol: "≋" };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: "Drizzle", symbol: "☂" };
  if ([61, 63, 65, 66, 67].includes(code)) return { label: "Rain", symbol: "☂" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "Snow", symbol: "❄" };
  if ([80, 81, 82].includes(code)) return { label: "Rain showers", symbol: "☂" };
  if ([95, 96, 99].includes(code)) return { label: "Thunderstorm", symbol: "ϟ" };
  return { label: "Conditions unavailable", symbol: "–" };
}

function validLocation(location) {
  return location && Number.isFinite(location.latitude) &&
    Number.isFinite(location.longitude) &&
    Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export async function fetchTodayWeather(
  location, fetchImpl = fetch, timeoutMs = WEATHER_TIMEOUT_MS, externalSignal
) {
  if (!validLocation(location)) {
    throw new WeatherError("invalid_location", "Choose a valid farm location first.");
  }
  const url = new URL(WEATHER_API);
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: WEATHER_FIELDS,
    daily: "temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: "1",
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm"
  }).toString();

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new WeatherError(externalSignal?.aborted ? "cancelled" : "timeout",
          "Weather information could not be refreshed.");
      }
      throw new WeatherError("unavailable", "Weather service could not be reached.");
    }
    if (!response.ok) {
      throw new WeatherError("unavailable", "Weather is temporarily unavailable for this location.");
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new WeatherError("invalid_response", "Weather data could not be read.");
    }
    const current = data?.current;
    const daily = data?.daily;
    const timestampOk = typeof current?.time === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(current.time);
    if (!timestampOk || typeof data.timezone !== "string" ||
        !finite(current.temperature_2m) || !finite(current.apparent_temperature) ||
        !finite(current.relative_humidity_2m) || current.relative_humidity_2m < 0 ||
        current.relative_humidity_2m > 100 || !finite(current.wind_speed_10m) ||
        current.wind_speed_10m < 0 || !finite(current.precipitation) ||
        current.precipitation < 0 || !Number.isInteger(current.weather_code) ||
        ![0, 1].includes(current.is_day) ||
        !Array.isArray(daily?.temperature_2m_max) ||
        !Array.isArray(daily?.temperature_2m_min) ||
        !finite(daily.temperature_2m_max[0]) || !finite(daily.temperature_2m_min[0])) {
      throw new WeatherError("invalid_response", "The weather provider returned incomplete conditions.");
    }

    return {
      timezone: data.timezone,
      updatedLocal: current.time,
      temperature: current.temperature_2m,
      feelsLike: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      wind: current.wind_speed_10m,
      precipitation: current.precipitation,
      high: daily.temperature_2m_max[0],
      low: daily.temperature_2m_min[0],
      ...weatherCondition(current.weather_code, current.is_day === 1)
    };
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
