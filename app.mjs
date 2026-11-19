import {
  buildRequest,
  fetchCropOptions,
  formatReportedMonths,
  RecommendationError,
  resolvedAreaLabel
} from "./recommendations.mjs?v=11";
import {
  fetchTodayWeather,
  WEATHER_REFRESH_MS,
  weatherDate,
  weatherGreeting
} from "./weather.mjs?v=11";

const form = document.querySelector("#recommendation-form");
const addressInput = document.querySelector("#address");
const locationButton = document.querySelector("#use-location");
const locationError = document.querySelector("#location-error");
const submitButton = form.querySelector('button[type="submit"]');
const statusPanel = document.querySelector("#status-panel");
const statusTitle = document.querySelector("#status-title");
const statusMessage = document.querySelector("#status-message");
const statusIcon = document.querySelector("#status-icon");
const results = document.querySelector("#results");
const resultsHeadingArea = document.querySelector("#results-area");
const resultsTitle = document.querySelector("#results-title");
const recommendationList = document.querySelector("#recommendation-list");
const freshness = document.querySelector("#freshness");
const uncertainty = document.querySelector("#uncertainty");
const weatherNodes = {
  date: document.querySelector("#weather-date"),
  greeting: document.querySelector("#weather-greeting"),
  location: document.querySelector("#weather-location"),
  values: document.querySelector("#weather-values"),
  status: document.querySelector("#weather-status"),
  refresh: document.querySelector("#weather-refresh"),
  symbol: document.querySelector("#weather-symbol"),
  temp: document.querySelector("#weather-temp"),
  condition: document.querySelector("#weather-condition"),
  range: document.querySelector("#weather-range"),
  feels: document.querySelector("#weather-feels"),
  humidity: document.querySelector("#weather-humidity"),
  wind: document.querySelector("#weather-wind"),
  rain: document.querySelector("#weather-rain")
};

let selectedCoordinates = null;
let requestSequence = 0;
let hadResults = false;
let selectionSequence = 0;
let weatherSequence = 0;
let weatherController = null;
let weatherLocation = null;
let weatherPlace = "";
let weatherLocationKey = "";
let weatherFetchedAt = 0;
let weatherPending = false;

const messageForLocationError = (error) => {
  if (!navigator.onLine) return "You're offline, so this location could not be checked. Reconnect and try again.";
  if (!error) return "Your location could not be resolved. Enter an address instead.";
  if (error.code === error.PERMISSION_DENIED) return "Location permission was denied. Allow location access in your browser settings, or enter an address instead.";
  if (error.code === error.POSITION_UNAVAILABLE) return "Your device could not determine a location. Check location services or enter an address.";
  if (error.code === error.TIMEOUT) return "Finding your location took too long. Try again or enter an address.";
  return "Your location could not be resolved. Enter an address instead.";
};

function showStatus(kind, title, message) {
  statusPanel.dataset.kind = kind;
  statusIcon.textContent = kind === "loading" ? "…" : kind === "success" ? "✓" : "!";
  statusTitle.textContent = title;
  const box = statusPanel.querySelector("div");
  box.replaceChildren(statusTitle, statusMessage);
  statusMessage.textContent = message;
  statusPanel.hidden = false;
}

function appendText(parent, tag, text, className) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function noRecordsCard() {
  const card = document.createElement("article");
  card.className = "crop-card";
  const details = document.createElement("div");
  details.className = "crop-details";
  appendText(details, "p", "No crop records are indexed for this area yet.", "crop-window");
  appendText(details, "p", "Nothing is being suggested — this simply reflects what the local records cover. Absence from records does not mean a crop is unsuitable.", "card-note");
  card.append(details);
  return card;
}

function renderCaveats(notes) {
  uncertainty.replaceChildren();
  const lead = document.createElement("p");
  lead.textContent = "This is a list of crops historically reported in local records — not a recommendation, ranking, or suitability assessment.";
  uncertainty.append(lead);
  if (Array.isArray(notes) && notes.length > 0) {
    const list = document.createElement("ul");
    list.className = "caveats-list";
    for (const note of notes) {
      if (typeof note === "string" && note.trim().length > 0) {
        const item = document.createElement("li");
        item.textContent = note.trim();
        list.append(item);
      }
    }
    if (list.children.length > 0) uncertainty.append(list);
  }
}

const requestProgress = document.querySelector("#request-progress");

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  locationButton.disabled = isBusy;
  submitButton.querySelector("span:first-child").textContent = isBusy
    ? "Checking local records…"
    : "List crops for this location";
  form.setAttribute("aria-busy", String(isBusy));
  requestProgress.hidden = !isBusy;
  if (isBusy) requestProgress.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function geocodeAddress(address) {
  let response;
  try {
    response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { "Accept": "application/json" } }
    );
  } catch (error) {
    if (error instanceof TypeError) {
      throw new RecommendationError("unavailable", "The location lookup service could not be reached. Check your connection and try again.");
    }
    throw error;
  }
  if (!response.ok) {
    throw new RecommendationError("unavailable", "The location lookup service could not resolve your address. Try a clearer address.");
  }
  const matches = await response.json();
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new RecommendationError(
      "unsupported_location",
      "Could not find that place. Try a nearby town, district, or country name."
    );
  }
  return {
    latitude: +parseFloat(matches[0].lat).toFixed(4),
    longitude: +parseFloat(matches[0].lon).toFixed(4)
  };
}

function seasonLine(season) {
  if (!season || typeof season.season_name !== "string" ||
      season.season_name.trim().length === 0) return null;
  const planting = formatReportedMonths(season.planting_months);
  const harvest = formatReportedMonths(season.harvest_months);
  if (!planting && !harvest) return null;
  const parts = [season.season_name.trim()];
  if (planting) parts.push(`plant ${planting}`);
  if (harvest) parts.push(`harvest ${harvest}`);
  return parts.join(" · ");
}

// Renders only the evidence the service actually returned; the option list
// is historical coverage, not a ranking or recommendation.
function optionView(option) {
  const summary = option.summary;
  const card = document.createElement("article");
  card.className = "crop-card";
  const details = document.createElement("div");
  details.className = "crop-details";
  appendText(details, "h3", option.crop_label, "crop-name");

  const count = summary.record_count;
  if (count > 0) {
    appendText(details, "p", `${count} source record${count === 1 ? "" : "s"}`, "crop-window");
  }
  const seasons = Array.isArray(summary.seasons_observed)
    ? summary.seasons_observed.map(seasonLine).filter(Boolean)
    : [];
  for (const line of seasons) appendText(details, "p", line, "card-note");
  if (typeof option.evidence_hint === "string" && option.evidence_hint.trim().length > 0 &&
      seasons.length === 0 && count === 0) {
    appendText(details, "p", option.evidence_hint.trim(), "card-note");
  }

  card.append(details);
  return card;
}

function renderOptions(data) {
  const optionList = data.options;
  const fragment = document.createDocumentFragment();

  if (optionList.length === 0) {
    fragment.append(noRecordsCard());
  } else {
    for (const option of optionList) fragment.append(optionView(option));
  }
  recommendationList.replaceChildren(fragment);

  freshness.replaceChildren();
  const freshnessLabel = document.createElement("strong");
  freshnessLabel.textContent = "Data freshness: ";
  freshness.append(freshnessLabel, document.createTextNode(
    "Crops recorded in the pinned HarvestStat Africa historical coverage for this area. Record counts are historical, not current conditions or a forecast."));

  renderCaveats(data.notes);
  resultsHeadingArea.textContent = `Historically reported crops: ${resolvedAreaLabel(data)}`;
  resultsTitle.textContent = "Suggested crops to explore";
  results.hidden = false;
  hadResults = true;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function coordinateLabel(point) {
  const lat = `${Math.abs(point.latitude).toFixed(2)}°${point.latitude < 0 ? "S" : "N"}`;
  const lon = `${Math.abs(point.longitude).toFixed(2)}°${point.longitude < 0 ? "W" : "E"}`;
  return `Your farm · ${lat}, ${lon}`;
}

function resetWeather(message = "Choose a location below to see today's conditions.") {
  weatherSequence++;
  weatherController?.abort();
  weatherController = null;
  weatherLocation = null;
  weatherPlace = "";
  weatherLocationKey = "";
  weatherFetchedAt = 0;
  weatherPending = false;
  weatherNodes.location.textContent = "Choose your farm location";
  weatherNodes.values.hidden = true;
  weatherNodes.refresh.disabled = true;
  weatherNodes.status.textContent = message;
  weatherNodes.date.textContent = weatherDate();
  weatherNodes.greeting.textContent = weatherGreeting();
}

async function loadWeather(point, place, force = false) {
  const key = `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
  weatherLocation = point;
  weatherPlace = place;
  weatherNodes.location.textContent = place;
  if (!force && weatherLocationKey === key &&
      (weatherPending || (weatherFetchedAt > 0 && Date.now() - weatherFetchedAt < WEATHER_REFRESH_MS))) return;
  weatherLocationKey = key;
  weatherFetchedAt = 0;
  weatherSequence++;
  const token = weatherSequence;
  weatherController?.abort();
  weatherController = new AbortController();
  weatherPending = true;
  weatherNodes.values.hidden = true;
  weatherNodes.refresh.disabled = true;
  weatherNodes.status.textContent = "Checking today's weather for this location…";
  try {
    const weather = await fetchTodayWeather(point, fetch, 10_000, weatherController.signal);
    if (token !== weatherSequence) return;
    weatherFetchedAt = Date.now();
    weatherNodes.date.textContent = weatherDate(new Date(), weather.timezone);
    weatherNodes.greeting.textContent = weatherGreeting(new Date(), weather.timezone);
    weatherNodes.temp.textContent = `${Math.round(weather.temperature)}°C`;
    weatherNodes.symbol.textContent = weather.symbol;
    weatherNodes.condition.textContent = weather.label;
    weatherNodes.range.textContent = `Today: high ${Math.round(weather.high)}° · low ${Math.round(weather.low)}°`;
    weatherNodes.feels.textContent = `${Math.round(weather.feelsLike)}°C`;
    weatherNodes.humidity.textContent = `${Math.round(weather.humidity)}%`;
    weatherNodes.wind.textContent = `${Math.round(weather.wind)} km/h`;
    weatherNodes.rain.textContent = `${weather.precipitation.toFixed(1)} mm`;
    weatherNodes.values.hidden = false;
    weatherNodes.status.textContent = `Conditions as of ${weather.updatedLocal.slice(11, 16)} (farm local time) · weather model estimate.`;
  } catch (error) {
    if (token !== weatherSequence) return;
    weatherNodes.values.hidden = true;
    weatherNodes.status.textContent = navigator.onLine
      ? "Today's weather is unavailable right now. Retry without losing your crop results."
      : "You're offline. Live weather requires a connection.";
  } finally {
    if (token === weatherSequence) {
      weatherPending = false;
      weatherNodes.refresh.disabled = false;
    }
  }
}

// Reverse-geocode only after explicit location permission. Weather works even
// if the place-name lookup fails; the coordinate label is retained.
async function reverseLocation(point) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({
    lat: String(point.latitude),
    lon: String(point.longitude),
    zoom: "10",
    addressdetails: "1",
    format: "json"
  }).toString();
  try {
    const response = await fetch(url.toString(), { cache: "no-store", credentials: "omit" });
    if (!response.ok) return null;
    const result = await response.json();
    const address = result?.address;
    if (!address || typeof address !== "object") return null;
    const place = address.city || address.town || address.village ||
      address.municipality || address.county || address.state;
    return typeof place === "string" && typeof address.country === "string"
      ? `${place}, ${address.country}`
      : null;
  } catch {
    return null;
  }
}

weatherNodes.refresh.addEventListener("click", () => {
  if (weatherLocation) void loadWeather(weatherLocation, weatherPlace, true);
});
resetWeather();

locationButton.addEventListener("click", () => {
  const selected = ++selectionSequence;
  resetWeather("Choose a location to load today's weather.");
  if (!navigator.geolocation) {
    selectedCoordinates = null;
    addressInput.focus();
    locationError.textContent = "Your browser does not support device location. Enter an address instead.";
    locationError.hidden = false;
    return;
  }
  locationButton.disabled = true;
  locationError.hidden = true;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (selected !== selectionSequence) return;
      selectedCoordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      addressInput.value = "";
      addressInput.placeholder = `Location ready (${selectedCoordinates.latitude.toFixed(3)}, ${selectedCoordinates.longitude.toFixed(3)})`;
      locationButton.disabled = false;
      void loadWeather(selectedCoordinates, coordinateLabel(selectedCoordinates));
      void reverseLocation(selectedCoordinates).then(place => {
        if (place && selected === selectionSequence && weatherLocation) {
          weatherPlace = place;
          weatherNodes.location.textContent = place;
        }
      });
    },
    (error) => {
      if (selected !== selectionSequence) return;
      selectedCoordinates = null;
      locationButton.disabled = false;
      locationError.textContent = messageForLocationError(error);
      locationError.hidden = false;
      resetWeather("Weather requires a location. Enter an address or try again.");
    },
    { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 }
  );
});

addressInput.addEventListener("input", () => {
  selectionSequence++;
  resetWeather();
  selectedCoordinates = null;
  locationError.hidden = true;
  addressInput.placeholder = "e.g. district or nearest town";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  locationError.hidden = true;
  let location = selectedCoordinates;
  let place = weatherPlace || (location ? coordinateLabel(location) : "");
  if (!location) {
    const address = addressInput.value.trim();
    if (!address) {
      locationError.textContent = "Enter an address or use your device location first.";
      locationError.hidden = false;
      addressInput.focus();
      return;
    }
    const selection = ++selectionSequence;
    setBusy(true);
    showStatus("loading", "Resolving your address", "Looking up your location with OpenStreetMap Nominatim.");
    try {
      location = await geocodeAddress(address);
      if (selection !== selectionSequence) {
        setBusy(false);
        return;
      }
      place = address;
    } catch (error) {
      showStatus("error", "Check your location", error.message);
      setBusy(false);
      return;
    }
  }
  void loadWeather(location, place);
  const sequence = ++requestSequence;
  results.hidden = true;
  recommendationList.replaceChildren();
  hadResults = false;
  setBusy(true);
  showStatus("loading", "Checking local records", "Listing crops reported near this location. This can take a few seconds.");
  try {
    const data = await fetchCropOptions(
      window.CROP_APP_CONFIG && window.CROP_APP_CONFIG.API_BASE_URL,
      buildRequest(location)
    );
    if (sequence !== requestSequence) return;
    renderOptions(data);
    showStatus("success", "Suggested crops are ready", "These are historically reported crops, not a recommendation of what to plant.");
  } catch (error) {
    if (sequence !== requestSequence) return;
    const kind = !navigator.onLine ? "offline" : "error";
    const title = kind === "offline" ? "You're offline" :
      error.code === "timeout" ? "The request timed out" :
      error.code === "unavailable" ? "Service unavailable" :
      error.code === "unsupported_location" ? "Location not supported" :
      error.code === "insufficient_evidence" ? "Not enough historical evidence" :
      error.code === "configuration" ? "App not connected" : "No crop list available";
    showStatus(kind, title, error.message || "The request failed. No crop list is shown.");
    if (error.requestId) appendText(statusPanel.querySelector("div"), "p", `Reference: ${error.requestId}`);
  } finally {
    if (sequence === requestSequence) setBusy(false);
  }
});

window.addEventListener("offline", () => {
  resetWeather("You're offline. Weather will refresh after you select a location again.");
  requestSequence++;
  results.hidden = true;
  recommendationList.replaceChildren();
  hadResults = false;
  setBusy(false);
  showStatus("offline", "You're offline", "The crop evidence service needs a live connection. Any results on this screen have been cleared; reconnect before requesting a crop list.");
});

window.addEventListener("online", () => {
  if (statusPanel.dataset.kind === "offline" || statusPanel.dataset.kind === "stale") {
    showStatus("success", "Connection restored", "Submit your location again to request a current crop list.");
  }
});

window.addEventListener("pageshow", () => {
  if (navigator.onLine && weatherLocation && weatherFetchedAt &&
      Date.now() - weatherFetchedAt >= WEATHER_REFRESH_MS) {
    void loadWeather(weatherLocation, weatherPlace, true);
  }
  if (!navigator.onLine && hadResults) {
    results.hidden = true;
    recommendationList.replaceChildren();
    hadResults = false;
    showStatus("stale", "Previous results are no longer shown", "You are offline. Reconnect and request updated crop lists before planting.");
  }
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      showStatus("error", "Offline support is unavailable", "The app is open, but its static files could not be saved for offline use.");
    });
  });
}

if (!navigator.onLine) {
  showStatus("offline", "You're offline", "You can open the app, but a current crop list needs a live connection.");
}
