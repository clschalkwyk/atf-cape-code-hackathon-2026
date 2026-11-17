import {
  buildRequest,
  fetchRecommendations,
  RecommendationError,
  plantingReasonText,
  prevalenceReasonText
} from "./recommendations.mjs";

const form = document.querySelector("#recommendation-form");
const addressInput = document.querySelector("#address");
const cropNameInput = document.querySelector("#crop-name");
const cropDataList = document.querySelector("#crop-options");
const addCropButton = document.querySelector("#add-crop");
const cropPreferenceList = document.querySelector("#crop-preference-list");
const cropPreferenceError = document.querySelector("#crop-preference-error");
const locationButton = document.querySelector("#use-location");
const locationError = document.querySelector("#location-error");
const submitButton = form.querySelector('button[type="submit"]');
const statusPanel = document.querySelector("#status-panel");
const statusTitle = document.querySelector("#status-title");
const statusMessage = document.querySelector("#status-message");
const statusIcon = document.querySelector("#status-icon");
const results = document.querySelector("#results");
const resultsTitle = document.querySelector("#results-title");
const recommendationList = document.querySelector("#recommendation-list");
const freshness = document.querySelector("#freshness");
const uncertainty = document.querySelector("#uncertainty");

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const formatTimestamp = (iso) => new Date(iso).toISOString().slice(0, 10);

let selectedCoordinates = null;
let selectedCrop = null; // { id, name } from the catalog
let catalog = [];
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

function showCropPreferenceError(message) {
  cropPreferenceError.textContent = message;
  cropPreferenceError.hidden = !message;
}

async function loadCatalog() {
  try {
    const response = await fetch("./crops.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("bad status");
    catalog = await response.json();
    const fragment = document.createDocumentFragment();
    for (const entry of catalog) {
      const option = document.createElement("option");
      option.value = entry.name;
      fragment.append(option);
    }
    cropDataList.replaceChildren(fragment);
    cropNameInput.disabled = false;
    addCropButton.disabled = false;
  } catch {
    cropNameInput.disabled = true;
    addCropButton.disabled = true;
    cropNameInput.placeholder = "Crop list unavailable";
    showCropPreferenceError("The crop catalog could not be loaded. Reconnect and reload the page.");
  }
}

function findCatalogEntry(name) {
  const query = name.toLocaleLowerCase();
  return catalog.find((entry) => entry.name.toLocaleLowerCase() === query) ||
    catalog.find((entry) => entry.name.toLocaleLowerCase().startsWith(query)) ||
    undefined;
}

function renderSelectedCrop() {
  cropPreferenceList.replaceChildren();
  if (!selectedCrop) return;
  const item = document.createElement("li");
  appendText(item, "span", selectedCrop.name);
  const removeButton = appendText(item, "button", "×", "preference-remove");
  removeButton.type = "button";
  removeButton.setAttribute("aria-label", `Remove ${selectedCrop.name}`);
  removeButton.addEventListener("click", () => {
    selectedCrop = null;
    renderSelectedCrop();
    cropNameInput.focus();
  });
  cropPreferenceList.append(item);
}

function addCropPreference() {
  if (!catalog.length) {
    showCropPreferenceError("The crop catalog could not be loaded. Reconnect and reload the page.");
    return;
  }
  const entered = cropNameInput.value.trim();
  if (!entered) {
    showCropPreferenceError("Enter a crop name to set it.");
    cropNameInput.focus();
    return;
  }
  const match = findCatalogEntry(entered);
  if (!match) {
    showCropPreferenceError("That crop isn't in the local catalog yet — pick one from the suggestions.");
    cropNameInput.focus();
    return;
  }
  selectedCrop = match;
  cropNameInput.value = "";
  showCropPreferenceError("");
  renderSelectedCrop();
}

const sourceTypeLabels = {
  planting_calendar: "planting calendar",
  agricultural_statistics: "crop statistics",
  other: "other records"
};

function renderPlantingWindow(window) {
  const container = document.createElement("div");
  container.className = "crop-card";
  const details = document.createElement("div");
  details.className = "crop-details";
  appendText(details, "h3", "Planting window", "crop-name");
  if (window.status === "available") {
    const label = `${MONTHS[window.start_month - 1]} – ${MONTHS[window.end_month - 1]}`;
    appendText(details, "p", label + (window.crosses_year_boundary ? " (crosses year end)" : ""), "crop-window");
    appendText(details, "span", "Historical calendar record", "basis-badge");
    appendText(details, "p", "Recorded planting months, not a forecast for your field.", "indicator-note");
  } else {
    appendText(details, "p", "Unavailable", "crop-window unavailable");
    appendText(details, "p", plantingReasonText[window.reason] || window.reason, "indicator-note");
  }
  container.append(details);
  return container;
}

function renderPrevalence(prev) {
  const container = document.createElement("div");
  container.className = "crop-card";
  const details = document.createElement("div");
  details.className = "crop-details";
  appendText(details, "h3", "Local historical prevalence", "crop-name");
  if (prev.status === "available") {
    const pct = Math.round(prev.share * 100);
    appendText(details, "p", `${pct}% of reported cropped area`, "crop-window");
    if (prev.numerator && prev.denominator) {
      appendText(details, "p", `${prev.numerator.value.toLocaleString()} / ${prev.denominator.value.toLocaleString()} hectare`, "indicator-note");
    }
    if (prev.observation_period) {
      appendText(details, "p", `Observation period: ${prev.observation_period.start_year}–${prev.observation_period.end_year}`, "indicator-note");
    }
    appendText(details, "span", "Share of reported cultivation", "basis-badge");
    appendText(details, "p", "Describes historical reporting, not how suitable the crop is.", "indicator-note");
  } else {
    appendText(details, "p", "Unavailable", "crop-window unavailable");
    appendText(details, "p", prevalenceReasonText[prev.reason] || prev.reason, "indicator-note");
  }
  container.append(details);
  return container;
}

function renderAssessment(data) {
  const fragment = document.createDocumentFragment();

  const headline = document.createElement("article");
  headline.className = "crop-card assessment-head";
  const head = document.createElement("div");
  head.className = "crop-details";
  appendText(head, "h3", data.crop.name, "crop-name");
  appendText(head, "p", `Matched area: ${data.location.matched_area.label}`, "crop-window");
  const confidence = document.createElement("div");
  confidence.className = "crop-tags";
  appendText(confidence, "span", `${data.confidence_band.level} evidence strength`, "confidence-badge");
  appendText(confidence, "p", data.confidence_band.rationale, "confidence-rationale");
  head.append(confidence);
  headline.append(head);
  fragment.append(headline);

  fragment.append(renderPlantingWindow(data.likely_planting_window));
  fragment.append(renderPrevalence(data.local_historical_prevalence));

  const caveatsCard = document.createElement("article");
  caveatsCard.className = "crop-card";
  const caveats = document.createElement("div");
  caveats.className = "crop-details";
  appendText(caveats, "h3", "Caveats", "crop-name");
  const list = document.createElement("ul");
  list.className = "caveats-list";
  for (const caveat of data.caveats) appendText(list, "li", caveat);
  caveats.append(list);
  caveatsCard.append(caveats);
  fragment.append(caveatsCard);

  recommendationList.replaceChildren(fragment);

  freshness.replaceChildren();
  const label = document.createElement("strong");
  label.textContent = "Data freshness: ";
  const sourceDetails = data.data.sources.map((source) =>
    `${source.name} (${sourceTypeLabels[source.type] || source.type}, retrieved ${formatTimestamp(source.retrieved_at)})`
  ).join("; ");
  freshness.append(label, document.createTextNode(
    `${sourceDetails}. These are historical records, not current conditions or a forecast.`
  ));
  uncertainty.textContent = "Evidence is historical: it describes what records reported in the past, not a prediction or a promise of harvest.";
  resultsTitle.textContent = `Historical evidence: ${data.crop.name}`;
  results.hidden = false;
  hadResults = true;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  locationButton.disabled = isBusy;
  cropNameInput.disabled = isBusy || !catalog.length;
  addCropButton.disabled = isBusy || !catalog.length;
  cropPreferenceList.querySelectorAll("button").forEach((button) => { button.disabled = isBusy; });
  submitButton.querySelector("span:first-child").textContent = isBusy ? "Checking local data…" : "Find historical evidence";
  form.setAttribute("aria-busy", String(isBusy));
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
    throw new RecommendationError("unavailable", "The location lookup service could not resolve your address. Try nearby coordinates or a clearer address.");
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

addCropButton.addEventListener("click", addCropPreference);
cropNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addCropPreference();
  }
});
cropNameInput.addEventListener("input", () => showCropPreferenceError(""));

locationButton.addEventListener("click", () => {
  locationError.hidden = true;
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
  if (!selectedCrop) {
    showStatus("error", "Choose a crop", "Set a crop from the catalog in step 01 before requesting evidence.");
    showCropPreferenceError("Choose a crop from the catalog first.");
    cropNameInput.focus();
    return;
  }
  let request;
  try {
    let location = selectedCoordinates;
    if (!location) {
      setBusy(true);
      showStatus("loading", "Resolving your address", "Looking up your location with OpenStreetMap Nominatim.");
      location = await geocodeAddress(addressInput.value.trim());
    }
    request = buildRequest(location, selectedCrop.id);
  } catch (error) {
    showStatus("error", "Check your details", error.message);
    setBusy(false);
    return;
  }
  const sequence = ++requestSequence;
  results.hidden = true;
  recommendationList.replaceChildren();
  hadResults = false;
  setBusy(true);
  showStatus("loading", "Checking available evidence", "This can take a few seconds. No previous assessment is being used.");
  try {
    const data = await fetchRecommendations(
      window.CROP_APP_CONFIG && window.CROP_APP_CONFIG.API_BASE_URL,
      request
    );
    if (sequence !== requestSequence) return;
    renderAssessment(data);
    showStatus("success", "Your evidence summary is ready", "Compare the evidence, timing, and caveats before deciding.");
  } catch (error) {
    if (sequence !== requestSequence) return;
    const kind = !navigator.onLine ? "offline" : "error";
    const title = kind === "offline" ? "You're offline" :
      error.code === "timeout" ? "The request timed out" :
      error.code === "unavailable" ? "Service unavailable" :
      error.code === "unsupported_location" ? "Location not supported" :
      error.code === "unsupported_crop" ? "Crop not supported" :
      error.code === "insufficient_evidence" ? "Not enough local evidence" :
      error.code === "configuration" ? "App not connected" : "No assessment available";
    showStatus(kind, title, error.message || "The request failed. No assessment is shown.");
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
  showStatus("offline", "You're offline", "The crop evidence service needs a live connection. Any results on this screen have been cleared; reconnect before requesting an assessment.");
});

window.addEventListener("online", () => {
  if (statusPanel.dataset.kind === "offline" || statusPanel.dataset.kind === "stale") {
    showStatus("success", "Connection restored", "Submit your location again to request a current assessment.");
  }
});

window.addEventListener("pageshow", () => {
  if (!navigator.onLine && hadResults) {
    results.hidden = true;
    recommendationList.replaceChildren();
    hadResults = false;
    showStatus("stale", "Previous results are no longer shown", "You are offline. Reconnect and request updated evidence before planting.");
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
  showStatus("offline", "You're offline", "You can open the app, but a current assessment needs a live connection.");
}

loadCatalog();
