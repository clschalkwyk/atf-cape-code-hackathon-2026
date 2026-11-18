export const REQUEST_TIMEOUT_MS = 15_000;

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Report exactly the months present in the source, preserving their order.
// A min–max range would invent unreported months and misstate cross-year seasons.
export function formatReportedMonths(months) {
  if (!Array.isArray(months) || months.length === 0 ||
      !months.every((month) => Number.isInteger(month) && month >= 1 && month <= 12)) {
    return null;
  }
  return [...new Set(months)].map((month) => SHORT_MONTHS[month - 1]).join(", ");
}

export class RecommendationError extends Error {
  constructor(code, message, requestId = "") {
    super(message);
    this.name = "RecommendationError";
    this.code = code;
    this.requestId = requestId;
  }
}

const errorMessages = {
  bad_request: "The request could not be understood. Check the information and try again.",
  unsupported_media_type: "The evidence service could not accept this request.",
  validation_error: "Check the crop and location, then try again.",
  unsupported_crop: "That crop is not in the versioned catalog the service uses.",
  unsupported_location: "This location is not in the service's supported area yet.",
  insufficient_evidence: "There isn't enough reliable local historical data for this crop and location, so no assessment is shown.",
  rate_limited: "The service is receiving too many requests. Wait a little and try again.",
  internal_error: "The evidence service had a problem. No assessment was returned.",
  service_unavailable: "Evidence data is temporarily unavailable. Try again later."
};

// The deployed service accepts coordinates only; addresses are geocoded
// client-side (OpenStreetMap Nominatim) before this call. `cropId` is
// optional: omit it to ask for the option list of crops recorded near the
// location, or pass a catalog id for a single historical assessment.
export function buildRequest(location, cropId) {
  if (!location ||
      !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) ||
      Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) {
    throw new RecommendationError("validation_error", "A valid location is required. Use your device location or enter an address that resolves.");
  }
  const request = {
    location: {
      latitude: location.latitude,
      longitude: location.longitude
    }
  };
  if (cropId !== undefined) {
    if (typeof cropId !== "string" || cropId.trim().length < 1 || cropId.trim().length > 100) {
      throw new RecommendationError("validation_error", "Choose a crop from the catalog before requesting evidence.");
    }
    request.crop_id = cropId.trim();
  }
  return request;
}

const PLANTING_REASONS = new Set([
  "no_local_planting_calendar",
  "insufficient_calendar_evidence"
]);

const PREVALENCE_REASONS = new Set([
  "no_comparable_area_records",
  "insufficient_area_evidence"
]);

function isPlantingWindow(window) {
  if (!window || typeof window !== "object" || typeof window.status !== "string") return false;
  if (window.status === "available") {
    return Number.isInteger(window.start_month) && window.start_month >= 1 && window.start_month <= 12 &&
      Number.isInteger(window.end_month) && window.end_month >= 1 && window.end_month <= 12 &&
      typeof window.crosses_year_boundary === "boolean" &&
      typeof window.evidence_basis === "string" && window.evidence_basis.length > 0;
  }
  if (window.status === "unavailable") {
    return PLANTING_REASONS.has(window.reason);
  }
  return false;
}

function isPrevalence(prevalence) {
  if (!prevalence || typeof prevalence !== "object" || typeof prevalence.status !== "string") return false;
  if (prevalence.status === "available") {
    return Number.isFinite(prevalence.share) && prevalence.share >= 0 && prevalence.share <= 1 &&
      prevalence.numerator && Number.isFinite(prevalence.numerator.value) && prevalence.numerator.value >= 0 &&
      prevalence.denominator && Number.isFinite(prevalence.denominator.value) && prevalence.denominator.value > 0 &&
      prevalence.observation_period &&
      Number.isInteger(prevalence.observation_period.start_year) &&
      Number.isInteger(prevalence.observation_period.end_year) &&
      prevalence.evidence_basis === "reported_cropped_area";
  }
  if (prevalence.status === "unavailable") {
    return PREVALENCE_REASONS.has(prevalence.reason);
  }
  return false;
}

export function validateResponse(data) {
  if (!data || typeof data !== "object" || typeof data.request_id !== "string" ||
      !data.location || !data.location.matched_area ||
      typeof data.location.matched_area.label !== "string" ||
      !data.crop || typeof data.crop.id !== "string" || typeof data.crop.name !== "string" ||
      !isPlantingWindow(data.likely_planting_window) ||
      !isPrevalence(data.local_historical_prevalence) ||
      !data.confidence_band ||
      !["low", "moderate", "high"].includes(data.confidence_band.level) ||
      typeof data.confidence_band.rationale !== "string" ||
      !Array.isArray(data.caveats) || data.caveats.length === 0 ||
      data.caveats.some((caveat) => typeof caveat !== "string") ||
      !data.data || !Array.isArray(data.data.sources) || data.data.sources.length === 0) {
    throw new RecommendationError("invalid_response", "The service returned an incomplete response. No assessment is shown.");
  }
  const validSources = data.data.sources.every((source) =>
    source && typeof source.name === "string" &&
    ["planting_calendar", "agricultural_statistics", "other"].includes(source.type) &&
    typeof source.retrieved_at === "string" && Number.isFinite(Date.parse(source.retrieved_at))
  );
  if (!validSources) {
    throw new RecommendationError("invalid_response", "The service returned an incomplete response. No assessment is shown.");
  }
  return data;
}

export async function postRecommendation(apiBaseUrl, request, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
  let baseUrl;
  try {
    baseUrl = new URL(apiBaseUrl);
  } catch {
    throw new RecommendationError("configuration", "The evidence service has not been configured for this app.");
  }
  if ((baseUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(baseUrl.hostname)) ||
      baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== "/") {
    throw new RecommendationError("configuration", "Configure the API's HTTPS origin without a path or credentials (localhost is allowed for development).");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(`${baseUrl.href.replace(/\/+$/, "")}/v1/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new RecommendationError("timeout", "The request took too long. Check your connection and try again.");
      }
      if (error instanceof TypeError) {
        throw new RecommendationError("unavailable", "The evidence service could not be reached. Check your connection and try again.");
      }
      throw error;
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw new RecommendationError("timeout", "The request took too long. Check your connection and try again.");
      }
      throw new RecommendationError("invalid_response", "The evidence service returned an unreadable response. No assessment is shown.");
    }
    if (!response.ok) {
      const code = payload && payload.error && payload.error.code;
      const detail = payload && payload.error && payload.error.message;
      const message = code === "insufficient_evidence" && typeof detail === "string" && detail.trim()
        ? detail.trim()
        : (errorMessages[code] || `The evidence service returned an error (${response.status}). No assessment is shown.`);
      throw new RecommendationError(
        code || "api_error",
        message,
        payload && payload.error && payload.error.request_id
      );
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchRecommendations(apiBaseUrl, request, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
  return validateResponse(await postRecommendation(apiBaseUrl, request, fetchImpl, timeoutMs));
}

// Verified shape of the deployed location-only response (options list):
// resolved_location {admin_1, admin_2, country, ...}, options[] of
// {crop_id, crop_label, summary:{record_count, seasons_observed:[{
// season_name, planting_months:[int], harvest_months:[int]}]}, evidence_hint},
// and top-level notes[] honesty caveats. Identity fields are required; the
// app renders only evidence details that are actually present.
export function resolvedAreaLabel(payload) {
  const resolved = payload && payload.resolved_location;
  const parts = resolved && typeof resolved === "object"
    ? [resolved.admin_1, resolved.admin_2, resolved.country]
        .filter((part) => typeof part === "string" && part.trim().length > 0)
    : [];
  if (parts.length > 0) return parts.join(", ");
  const fallback = payload && payload.location && payload.location.matched_area;
  return fallback && typeof fallback.label === "string" && fallback.label.trim().length > 0
    ? fallback.label.trim()
    : "";
}

export async function fetchCropOptions(apiBaseUrl, request, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
  const payload = await postRecommendation(apiBaseUrl, request, fetchImpl, timeoutMs);
  if (!payload || typeof payload !== "object" || typeof payload.request_id !== "string" ||
      typeof resolvedAreaLabel(payload) !== "string" || resolvedAreaLabel(payload).length === 0 ||
      !Array.isArray(payload.options)) {
    throw new RecommendationError("invalid_response", "The service returned an incomplete response. No options are shown.");
  }
  for (const option of payload.options) {
    const label = option && typeof option.crop_label === "string" && option.crop_label.trim().length > 0
      ? option.crop_label
      : (option && typeof option.crop_name === "string" ? option.crop_name : undefined);
    const summary = option && option.summary;
    if (!option || typeof option.crop_id !== "string" || option.crop_id.length === 0 ||
        typeof label !== "string" || label.length === 0 ||
        !summary || typeof summary !== "object" ||
        !Number.isFinite(summary.record_count) || summary.record_count < 0) {
      throw new RecommendationError("invalid_response", "The service returned an incomplete response. No options are shown.");
    }
  }
  return payload;
}

export const plantingReasonText = {
  no_local_planting_calendar: "No local planting calendar is available for this area.",
  insufficient_calendar_evidence: "The available planting calendar evidence is insufficient.",
  insufficient_records: "Not enough local records to estimate a planting window."
};

export const prevalenceReasonText = {
  no_comparable_area_records: "No comparable cropped-area records are available.",
  insufficient_area_evidence: "The available area evidence is insufficient.",
  insufficient_records: "Not enough local records to estimate."
};
