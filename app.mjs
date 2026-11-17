import {
  buildRequest,
  fetchCropOptions,
  RecommendationError,
  resolvedAreaLabel
} from "./recommendations.mjs?v=9";

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

let selectedCoordinates = null;
let requestSequence = 0;
let hadResults = false;

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

function monthRangeText(months) {
  const valid = Array.isArray(months) &&
    months.every((month) => Number.isInteger(month) && month >= 1 && month <= 12);
  if (!valid || months.length === 0) return null;
  const short = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const names = [...new Set(months)].sort((a, b) => a - b).map((month) => short[month - 1]);
  return names.length === 1 ? names[0] : `${names[0]} – ${names[names.length - 1]}`;
}

function seasonLine(season) {
  if (!season || typeof season.season_name !== "string" ||
      season.season_name.trim().length === 0) return null;
  const planting = monthRangeText(season.planting_months);
  const harvest = monthRangeText(season.harvest_months);
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

locationButton.addEventListener("click", () => {
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
      selectedCoordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      addressInput.value = "";
      addressInput.placeholder = `Location ready (${selectedCoordinates.latitude.toFixed(3)}, ${selectedCoordinates.longitude.toFixed(3)})`;
      locationButton.disabled = false;
    },
    (error) => {
      selectedCoordinates = null;
      locationButton.disabled = false;
      locationError.textContent = messageForLocationError(error);
      locationError.hidden = false;
    },
    { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 }
  );
});

addressInput.addEventListener("input", () => {
  selectedCoordinates = null;
  locationError.hidden = true;
  addressInput.placeholder = "e.g. district or nearest town";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  locationError.hidden = true;
  let location = selectedCoordinates;
  if (!location) {
    const address = addressInput.value.trim();
    if (!address) {
      locationError.textContent = "Enter an address or use your device location first.";
      locationError.hidden = false;
      addressInput.focus();
      return;
    }
    setBusy(true);
    showStatus("loading", "Resolving your address", "Looking up your location with OpenStreetMap Nominatim.");
    try {
      location = await geocodeAddress(address);
    } catch (error) {
      showStatus("error", "Check your location", error.message);
      setBusy(false);
      return;
    }
  }
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
    if (error.code === "insufficient_evidence") {
      recommendationList.replaceChildren(noRecordsCard());
      freshness.replaceChildren();
      const freshnessLabel = document.createElement("strong");
      freshnessLabel.textContent = "Data freshness: ";
      freshness.append(freshnessLabel, document.createTextNode(
        "The coverage index for this area has no crop records in the pinned historical release."));
      renderCaveats([]);
      resultsHeadingArea.textContent = "Historically reported crops: this area";
      results.hidden = false;
      statusPanel.hidden = true;
      hadResults = true;
      return;
    }
    const kind = !navigator.onLine ? "offline" : "error";
    const title = kind === "offline" ? "You're offline" :
      error.code === "timeout" ? "The request timed out" :
      error.code === "unavailable" ? "Service unavailable" :
      error.code === "unsupported_location" ? "Location not supported" :
      error.code === "insufficient_evidence" ? "Not enough local records" :
      error.code === "configuration" ? "App not connected" : "No crop list available";
    showStatus(kind, title, error.message || "The request failed. No crop list is shown.");
    if (error.requestId) appendText(statusPanel.querySelector("div"), "p", `Reference: ${error.requestId}`);
  } finally {
    if (sequence === requestSequence) setBusy(false);
  }
});

window.addEventListener("offline", () => {
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
