(function () {
  "use strict";

  // ── Constants ──────────────────────────────────────────────────────────

  var MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // ── State ───────────────────────────────────────────────────────────────

  var state = {
    location: null,       // { latitude, longitude } or { address }
    locationLabel: null,  // human-readable string
    cropId: null,
    cropName: null,
    crops: [],            // full crop list from crops.json
    loading: false,
  };

  // ── DOM refs ─────────────────────────────────────────────────────────────

  var $ = function (sel) { return document.querySelector(sel); };

  var els = {
    date: $("#date"),
    greeting: $("#greeting"),
    locationLabel: $("#location-label"),
    seasonText: $("#season-text"),
    hemisphereText: $("#hemisphere-text"),
    locationInputSection: $("#location-input-section"),
    addressInput: $("#address-input"),
    useGeolocationBtn: $("#use-geolocation-btn"),
    setAddressBtn: $("#set-address-btn"),
    cropSearch: $("#crop-search"),
    cropList: $("#crop-list"),
    submitButton: $("#submit-button"),
    interactionMessage: $("#interaction-message"),
    resultsSection: $("#results-section"),
    menuButton: $(".menu-button"),
    aboutDialog: $("#about-dialog"),
    closeDialog: $("#close-dialog"),
  };

  // ── Date / greeting / season ─────────────────────────────────────────────

  function initDateGreeting() {
    var now = new Date();
    var dayName = ["Sunday", "Monday", "Tuesday", "Wednesday",
                   "Thursday", "Friday", "Saturday"][now.getDay()];
    els.date.textContent =
      dayName + ", " + now.getDate() + " " +
      MONTHS[now.getMonth()] + " " + now.getFullYear();

    var hour = now.getHours();
    var greeting = "Hello, Farmer";
    if (hour < 12) greeting = "Good morning, Farmer";
    else if (hour < 17) greeting = "Good afternoon, Farmer";
    else greeting = "Good evening, Farmer";
    els.greeting.textContent = greeting;

    updateSeason(now);
  }

  function updateSeason(now) {
    var month = now.getMonth(); // 0-11
    // Southern hemisphere: summer Dec-Feb, autumn Mar-May, winter Jun-Aug, spring Sep-Nov
    // Northern hemisphere: inverted
    // Default to southern hemisphere (target region is Africa)
    var hemisphere = "Southern";
    var season;
    if (month === 11 || month <= 1) season = "Summer";
    else if (month >= 2 && month <= 4) season = "Autumn";
    else if (month >= 5 && month <= 7) season = "Winter";
    else season = "Spring";

    // If we have coordinates, determine hemisphere from latitude
    if (state.location && state.location.latitude !== undefined) {
      hemisphere = state.location.latitude >= 0 ? "Northern" : "Southern";
      if (hemisphere === "Northern") {
        if (month === 11 || month <= 1) season = "Winter";
        else if (month >= 2 && month <= 4) season = "Spring";
        else if (month >= 5 && month <= 7) season = "Summer";
        else season = "Autumn";
      }
    }

    els.seasonText.textContent = season + " season";
    els.hemisphereText.textContent = hemisphere + " hemisphere";
  }

  // ── Location ──────────────────────────────────────────────────────────────

  function requestGeolocation() {
    if (!("geolocation" in navigator)) {
      showMessage("Geolocation is not available on this device. Enter your location below.");
      showLocationInput();
      return;
    }
    showMessage("Detecting your location…");
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        state.location = {
          latitude: +pos.coords.latitude.toFixed(4),
          longitude: +pos.coords.longitude.toFixed(4),
        };
        state.locationLabel = "Your current location";
        els.locationLabel.textContent = state.locationLabel;
        hideLocationInput();
        updateSeason(new Date());
        updateSubmitButton();
        showMessage("");
      },
      function (err) {
        showMessage("Could not get your GPS location. Enter your location below.");
        showLocationInput();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  function showLocationInput() {
    els.locationInputSection.hidden = false;
    els.addressInput.focus();
  }

  function hideLocationInput() {
    els.locationInputSection.hidden = true;
  }

  function setAddress() {
    var value = els.addressInput.value.trim();
    if (value.length < 3) {
      showMessage("Please enter a location (at least 3 characters).");
      return;
    }
    state.location = { address: value };
    state.locationLabel = value;
    els.locationLabel.textContent = value;
    hideLocationInput();
    updateSeason(new Date());
    updateSubmitButton();
    showMessage("");
  }

  // ── Crop list ──────────────────────────────────────────────────────────────

  function loadCrops() {
    fetch("./crops.json")
      .then(function (r) { return r.json(); })
      .then(function (crops) {
        state.crops = crops;
        renderCropList("");
      })
      .catch(function () {
        els.cropList.innerHTML =
          '<p class="crop-list-empty">Could not load the crop list. Check your connection.</p>';
      });
  }

  function renderCropList(query) {
    var q = query.trim().toLowerCase();
    var filtered = state.crops;
    if (q) {
      filtered = state.crops.filter(function (c) {
        return c.name.toLowerCase().indexOf(q) !== -1;
      });
    }

    if (!filtered.length) {
      els.cropList.innerHTML =
        '<p class="crop-list-empty">No crops match "' + escapeHtml(query) + '".</p>';
      return;
    }

    var html = filtered.map(function (c) {
      var selected = c.id === state.cropId;
      return '<button type="button" class="crop-option" role="option"' +
        ' aria-selected="' + selected + '"' +
        ' data-crop-id="' + escapeHtml(c.id) + '"' +
        ' data-crop-name="' + escapeHtml(c.name) + '">' +
        '<svg class="crop-check" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M5 12l5 5L20 7"></path></svg>' +
        "<span>" + escapeHtml(c.name) + "</span>" +
        "</button>";
    }).join("");

    els.cropList.innerHTML = html;

    // Wire up click handlers
    [].slice.call(els.cropList.querySelectorAll(".crop-option")).forEach(function (btn) {
      btn.addEventListener("click", function () { selectCrop(btn); });
    });
  }

  function selectCrop(btn) {
    var id = btn.dataset.cropId;
    // Toggle off if clicking the already-selected crop
    if (state.cropId === id) {
      state.cropId = null;
      state.cropName = null;
    } else {
      state.cropId = id;
      state.cropName = btn.dataset.cropName;
    }
    // Re-render to update selection highlight
    renderCropList(els.cropSearch.value);
    updateSubmitButton();
  }

  function updateSubmitButton() {
    var ready = state.location && state.cropId;
    els.submitButton.disabled = !ready;
  }

  // ── Messaging ──────────────────────────────────────────────────────────────

  function showMessage(msg) {
    els.interactionMessage.textContent = msg || "";
  }

  // ── API call ───────────────────────────────────────────────────────────────

  // Resolve state.location to { latitude, longitude }.
  // If coordinates are already set (geolocation), return them directly.
  // If an address was entered, geocode it via OpenStreetMap Nominatim.
  function resolveLocation() {
    if (state.location.latitude !== undefined) {
      return Promise.resolve({
        latitude: state.location.latitude,
        longitude: state.location.longitude,
      });
    }
    if (state.location.address) {
      var q = encodeURIComponent(state.location.address);
      return fetch(
        "https://nominatim.openstreetmap.org/search?q=" + q + "&format=json&limit=1",
        { headers: { "Accept": "application/json" } }
      )
        .then(function (r) { return r.json(); })
        .then(function (results) {
          if (!results || results.length === 0) {
            throw new Error("ADDRESS_NOT_FOUND");
          }
          return {
            latitude: +parseFloat(results[0].lat).toFixed(4),
            longitude: +parseFloat(results[0].lon).toFixed(4),
          };
        });
    }
    return Promise.reject(new Error("NO_LOCATION"));
  }

  function fetchRecommendation() {
    if (!state.location || !state.cropId) return;
    if (state.loading) return;

    state.loading = true;
    els.submitButton.disabled = true;
    els.submitButton.classList.add("loading");
    showLoading();

    var endpoint = window.CROP_API_ENDPOINT || "/v1/recommendations";

    resolveLocation()
      .then(function (coords) {
        var body = {
          location: {
            latitude: coords.latitude,
            longitude: coords.longitude,
          },
          crop_id: state.cropId,
        };
        return fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, status: response.status, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          renderResults(result.data);
        } else {
          renderError(result.data);
        }
      })
      .catch(function (err) {
        renderNetworkError(err);
      })
      .then(function () {
        state.loading = false;
        els.submitButton.classList.remove("loading");
        updateSubmitButton();
      });
  }

  // ── Results rendering ──────────────────────────────────────────────────────

  function showLoading() {
    els.resultsSection.hidden = false;
    els.resultsSection.innerHTML =
      '<div class="state-card loading-state">' +
      '<div class="spinner" aria-hidden="true"></div>' +
      "<p>Fetching historical crop evidence…</p>" +
      "</div>";
    els.resultsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderResults(data) {
    els.resultsSection.hidden = false;

    var html = '<div class="results-card">';

    // Header
    html += '<div class="results-header">';
    html += '<h3>Historical evidence: ' + escapeHtml(data.crop.name || state.cropName || data.crop.id) + "</h3>";
    if (data.location && data.location.matched_area) {
      html += '<p class="matched-area">Matched area: ' + escapeHtml(data.location.matched_area.label) + "</p>";
    }
    html += "</div>";

    // Planting window
    html += renderPlantingWindow(data.likely_planting_window);

    // Prevalence
    html += renderPrevalence(data.local_historical_prevalence);

    // Confidence band
    html += renderConfidence(data.confidence_band);

    // Caveats
    html += '<div class="caveats">';
    html += "<h4>Caveats</h4>";
    html += "<ul>";
    (data.caveats || []).forEach(function (c) {
      html += "<li>" + escapeHtml(c) + "</li>";
    });
    html += "</ul>";
    html += "</div>";

    // Data sources
    html += renderSources(data.data);

    html += "</div>";

    els.resultsSection.innerHTML = html;
    els.resultsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    showMessage("");
  }

  function renderPlantingWindow(pw) {
    if (!pw) return "";
    var html = '<div class="indicator">';
    html += '<h4>Planting window</h4>';
    if (pw.status === "available") {
      var start = MONTHS[(pw.start_month - 1)] || "?";
      var end = MONTHS[(pw.end_month - 1)] || "?";
      var label = start + " – " + end;
      if (pw.crosses_year_boundary) {
        label += " <span class=\"cross-year\">(crosses year end)</span>";
      }
      html += '<p class="indicator-value">' + label + "</p>";
      html += '<p class="indicator-note">From historical planting calendar records, not a forecast.</p>';
    } else {
      html += '<p class="indicator-value unavailable">Unavailable</p>';
      html += '<p class="indicator-note">' + escapeHtml(reasonText(pw.reason)) + "</p>";
    }
    html += "</div>";
    return html;
  }

  function renderPrevalence(prev) {
    if (!prev) return "";
    var html = '<div class="indicator">';
    html += "<h4>Local historical prevalence</h4>";
    if (prev.status === "available") {
      var pct = Math.round(prev.share * 100);
      html += '<p class="indicator-value">' + pct + "% of reported cropped area</p>";
      if (prev.numerator && prev.denominator) {
        html += '<p class="indicator-detail">' +
          formatNumber(prev.numerator.value) + " / " + formatNumber(prev.denominator.value) + " " +
          escapeHtml(prev.denominator.unit || "hectare") + "</p>";
      }
      if (prev.observation_period) {
        html += '<p class="indicator-detail">Observation period: ' +
          prev.observation_period.start_year + "–" + prev.observation_period.end_year + "</p>";
      }
      html += '<p class="indicator-note">Share of historically reported cultivation, not a measure of suitability.</p>';
    } else {
      html += '<p class="indicator-value unavailable">Unavailable</p>';
      html += '<p class="indicator-note">' + escapeHtml(reasonText(prev.reason)) + "</p>";
    }
    html += "</div>";
    return html;
  }

  function renderConfidence(cb) {
    if (!cb) return "";
    var html = '<div class="confidence-band">';
    html += '<span class="confidence-label confidence-' + escapeHtml(cb.level) + '">' +
      "Evidence strength: " + escapeHtml(cb.level) + "</span>";
    html += '<p class="confidence-rationale">' + escapeHtml(cb.rationale) + "</p>";
    html += "</div>";
    return html;
  }

  function renderSources(data) {
    if (!data || !data.sources || !data.sources.length) return "";
    var html = '<div class="sources">';
    html += "<h4>Data sources</h4>";
    html += "<ul>";
    data.sources.forEach(function (s) {
      html += "<li>";
      html += "<strong>" + escapeHtml(s.name) + "</strong>";
      if (s.observation_period) {
        html += ' <span class="source-period">(' + s.observation_period.start_year + "–" + s.observation_period.end_year + ")</span>";
      }
      html += ' <span class="source-type">' + escapeHtml(s.type.replace(/_/g, " ")) + "</span>";
      html += "</li>";
    });
    html += "</ul>";
    html += "</div>";
    return html;
  }

  // ── Error rendering ─────────────────────────────────────────────────────────

  function renderError(data) {
    els.resultsSection.hidden = false;
    var err = data && data.error;
    var code = err ? err.code : "unknown";
    var message = err ? err.message : "An unexpected error occurred.";

    var html = '<div class="state-card error-state">';
    html += '<div class="state-icon" aria-hidden="true">⚠</div>';
    html += "<h3>" + escapeHtml(errorTitle(code)) + "</h3>";
    html += "<p>" + escapeHtml(message) + "</p>";

    if (code === "insufficient_evidence") {
      html += '<p class="state-hint">There isn\'t enough local historical data to report a planting window or prevalence for this crop and location. Try a different crop or location.</p>';
    } else if (code === "unsupported_location") {
      html += '<p class="state-hint">This location is outside the currently supported evidence areas. The service covers selected regions in Africa.</p>';
    } else if (code === "unsupported_crop") {
      html += '<p class="state-hint">This crop is not in the configured catalog. Try selecting a different crop.</p>';
    } else if (code === "rate_limited") {
      html += '<p class="state-hint">Too many requests. Please wait a moment and try again.</p>';
    } else if (code === "service_unavailable") {
      html += '<p class="state-hint">The evidence service is temporarily unavailable. Please try again shortly.</p>';
    }

    if (err && err.request_id) {
      html += '<p class="request-id">Request ID: ' + escapeHtml(err.request_id) + "</p>";
    }

    if (err && err.retryable) {
      html += '<button class="ghost-button retry-button" type="button" onclick="location.reload()">Try again</button>';
    }

    html += "</div>";
    els.resultsSection.innerHTML = html;
    els.resultsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderNetworkError(err) {
    els.resultsSection.hidden = false;

    if (err && err.message === "ADDRESS_NOT_FOUND") {
      els.resultsSection.innerHTML =
        '<div class="state-card error-state">' +
        '<div class="state-icon" aria-hidden="true">📍</div>' +
        "<h3>Location not found</h3>" +
        "<p>Could not find that place. Try a more specific address, for example a town and country.</p>" +
        '<button class="ghost-button retry-button" type="button" onclick="location.reload()">Try again</button>' +
        "</div>";
      els.resultsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    var offline = !navigator.onLine;
    var html = '<div class="state-card error-state">';
    html += '<div class="state-icon" aria-hidden="true">' + (offline ? "📴" : "⚠") + "</div>";
    html += "<h3>" + (offline ? "You are offline" : "Could not reach the service") + "</h3>";
    if (offline) {
      html += "<p>Check your internet connection and try again.</p>";
    } else {
      html += "<p>Could not connect to the crop evidence service. The service may be down or the API URL may not be configured.</p>";
      html += '<p class="state-hint">Endpoint: <code>' + escapeHtml(window.CROP_API_ENDPOINT || "(not set)") + "</code></p>";
    }
    html += '<button class="ghost-button retry-button" type="button" onclick="location.reload()">Try again</button>';
    html += "</div>";
    els.resultsSection.innerHTML = html;
    els.resultsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function reasonText(reason) {
    var map = {
      no_local_planting_calendar: "No local planting calendar is available for this area.",
      insufficient_calendar_evidence: "The available planting calendar evidence is insufficient.",
      no_comparable_area_records: "No comparable cropped-area records are available.",
      insufficient_area_evidence: "The available area evidence is insufficient.",
    };
    return map[reason] || reason || "Not available.";
  }

  function errorTitle(code) {
    var map = {
      insufficient_evidence: "Insufficient evidence",
      unsupported_location: "Location not supported",
      unsupported_crop: "Crop not supported",
      validation_error: "Validation error",
      rate_limited: "Rate limited",
      service_unavailable: "Service unavailable",
      bad_request: "Bad request",
      unsupported_media_type: "Unsupported media type",
      internal_error: "Server error",
    };
    return map[code] || "Error";
  }

  function formatNumber(n) {
    if (n === undefined || n === null) return "?";
    return Number(n).toLocaleString();
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ── Online/offline ───────────────────────────────────────────────────────────

  function updateOnlineStatus() {
    if (!navigator.onLine && !state.loading) {
      showMessage("You are offline. Some features may be unavailable.");
    } else if (navigator.onLine) {
      // Don't clear if showing other messages
    }
  }

  // ── Event wiring ──────────────────────────────────────────────────────────────

  function init() {
    initDateGreeting();

    // Load crop catalog
    loadCrops();

    // Crop search filter
    els.cropSearch.addEventListener("input", function () {
      renderCropList(els.cropSearch.value);
    });

    els.useGeolocationBtn.addEventListener("click", requestGeolocation);
    els.setAddressBtn.addEventListener("click", setAddress);
    els.addressInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") setAddress();
    });

    els.submitButton.addEventListener("click", fetchRecommendation);

    els.menuButton.addEventListener("click", function () {
      if (els.aboutDialog.showModal) {
        els.aboutDialog.showModal();
      } else {
        els.aboutDialog.setAttribute("open", "");
      }
    });

    els.closeDialog.addEventListener("click", function () {
      if (els.aboutDialog.close) {
        els.aboutDialog.close();
      } else {
        els.aboutDialog.removeAttribute("open");
      }
    });

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    // Try geolocation on load
    requestGeolocation();

    // Register service worker
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("./service-worker.js").catch(function () {});
      });
    }

    updateOnlineStatus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
