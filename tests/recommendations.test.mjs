import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRequest,
  fetchCropOptions,
  fetchRecommendations,
  formatReportedMonths,
  RecommendationError,
  validateResponse
} from "../recommendations.mjs";

test("renders only reported months, preserving cross-year order and gaps", () => {
  assert.equal(formatReportedMonths([10, 11, 12, 1, 2, 3]), "Oct, Nov, Dec, Jan, Feb, Mar");
  assert.equal(formatReportedMonths([3, 5]), "Mar, May");
  assert.equal(formatReportedMonths([1]), "Jan");
  assert.equal(formatReportedMonths([10, 10, 11]), "Oct, Nov");
  assert.equal(formatReportedMonths([]), null);
  assert.equal(formatReportedMonths([0, 12]), null);
  assert.equal(formatReportedMonths([3, "4"]), null);
});

const assessment = {
  request_id: "req_test",
  location: {
    matched_area: { spatial_unit: "administrative_area", label: "Example district, Example country" }
  },
  crop: { id: "hsa-v1-2-maize-637a42a5", name: "Maize" },
  likely_planting_window: {
    status: "available",
    start_month: 10,
    end_month: 12,
    crosses_year_boundary: false,
    evidence_basis: "HarvestStat planting calendar"
  },
  local_historical_prevalence: {
    status: "available",
    share: 0.42,
    numerator: { value: 15000, unit: "hectare" },
    denominator: { value: 35000, unit: "hectare" },
    observation_period: { start_year: 2015, end_year: 2023 },
    evidence_basis: "reported_cropped_area"
  },
  confidence_band: { level: "moderate", rationale: "Eight years of comparable records." },
  caveats: ["Historical data does not guarantee future results."],
  data: {
    sources: [{
      name: "HarvestStat",
      type: "planting_calendar",
      retrieved_at: "2026-11-01T00:00:00Z"
    }]
  }
};

test("builds a location-only request for the deployed API", () => {
  assert.deepEqual(buildRequest({ latitude: -1.2, longitude: 36.8 }), {
    location: { latitude: -1.2, longitude: 36.8 }
  });
});

test("builds a coordinates-plus-crop_id request when a crop is given", () => {
  assert.deepEqual(buildRequest({ latitude: -1.2, longitude: 36.8 }, "hsa-v1-2-maize-637a42a5"), {
    location: { latitude: -1.2, longitude: 36.8 },
    crop_id: "hsa-v1-2-maize-637a42a5"
  });
  assert.equal(buildRequest({ latitude: 0, longitude: 0 }, "  crop-a  ").crop_id, "crop-a");
});

test("rejects missing coordinates or an invalid crop id", () => {
  assert.throws(() => buildRequest(null), RecommendationError);
  assert.throws(() => buildRequest({ latitude: 91, longitude: 0 }), RecommendationError);
  assert.throws(() => buildRequest({ latitude: 0, longitude: 181 }), RecommendationError);
  assert.throws(() => buildRequest({ latitude: "x", longitude: 0 }), RecommendationError);
  assert.throws(() => buildRequest({ latitude: 0, longitude: 0 }, ""), RecommendationError);
  assert.throws(() => buildRequest({ latitude: 0, longitude: 0 }, "   "), RecommendationError);
  assert.throws(() => buildRequest({ latitude: 0, longitude: 0 }, "x".repeat(101)), RecommendationError);
  assert.throws(() => buildRequest({ latitude: 0, longitude: 0 }, 42), RecommendationError);
});

test("accepts a complete historical assessment response", () => {
  assert.equal(validateResponse(assessment), assessment);
});

test("accepts unavailable indicators with a known reason", () => {
  const unavailable = {
    ...assessment,
    likely_planting_window: { status: "unavailable", reason: "no_local_planting_calendar" },
    local_historical_prevalence: { status: "unavailable", reason: "no_comparable_area_records" }
  };
  assert.equal(validateResponse(unavailable), unavailable);
});

test("never accepts an incomplete or malformed assessment", () => {
  assert.throws(() => validateResponse(null), RecommendationError);
  assert.throws(() => validateResponse({ ...assessment, caveats: [] }), RecommendationError);
  assert.throws(() => validateResponse({ ...assessment, confidence_band: { level: "certain", rationale: "no" } }), RecommendationError);
  assert.throws(() => validateResponse({ ...assessment, likely_planting_window: { status: "available", start_month: 13, end_month: 12, crosses_year_boundary: false, evidence_basis: "x" } }), RecommendationError);
  assert.throws(() => validateResponse({ ...assessment, likely_planting_window: { status: "unavailable", reason: "made_up_reason" } }), RecommendationError);
  assert.throws(() => validateResponse({ ...assessment, local_historical_prevalence: { status: "available", share: 1.2, numerator: { value: 1, unit: "hectare" }, denominator: { value: 2, unit: "hectare" }, observation_period: { start_year: 2015, end_year: 2023 }, evidence_basis: "reported_cropped_area" } }), RecommendationError);
  assert.throws(() => validateResponse({ ...assessment, data: { sources: [] } }), RecommendationError);
  assert.throws(() => validateResponse({ ...assessment, data: { sources: [{ name: "X", type: "twitter", retrieved_at: "2026-11-01T00:00:00Z" }] } }), RecommendationError);
  assert.throws(() => validateResponse({ ...assessment, location: {} }), RecommendationError);
  assert.throws(() => validateResponse({ ...assessment, crop: { id: "x" } }), RecommendationError);
});

// Shape verified against the deployed location-only response.
const optionsResponse = {
  request_id: "req_options",
  resolved_location: {
    fnid: "KE2013A147",
    country: "Kenya",
    admin_1: "Nairobi",
    admin_2: null
  },
  options: [
    {
      crop_id: "hsa-v1-2-banana-f9782dd7",
      crop_label: "Banana",
      summary: {
        record_count: 3,
        seasons_observed: [{ season_name: "Annual", planting_months: [1], harvest_months: [12] }]
      },
      evidence_hint: "3 source records across 1 reported season."
    },
    {
      crop_id: "hsa-v1-2-beans-mixed-b45ec27c",
      crop_label: "Beans (mixed)",
      summary: { record_count: 35 },
      evidence_hint: "35 source records across 3 reported seasons."
    }
  ],
  notes: ["This is not a suitability ranking or recommendation."]
};

test("accepts a crop options response matching the deployed schema", async () => {
  const result = await fetchCropOptions(
    "https://api.example.org/",
    buildRequest({ latitude: -1.2, longitude: 36.8 }),
    async (url, requestOptions) => {
      assert.equal(url, "https://api.example.org/v1/recommendations");
      assert.deepEqual(JSON.parse(requestOptions.body), { location: { latitude: -1.2, longitude: 36.8 } });
      return { ok: true, json: async () => optionsResponse };
    }
  );
  assert.equal(result, optionsResponse);
});

test("accepts an empty options list and rejects incomplete options responses", async () => {
  const empty = { ...optionsResponse, options: [] };
  const result = await fetchCropOptions("https://api.example.org/", {}, async () => ({
    ok: true, json: async () => empty
  }));
  assert.deepEqual(result.options, []);
  await assert.rejects(
    fetchCropOptions("https://api.example.org", {}, async () => ({ ok: true, json: async () => ({ ...optionsResponse, options: null }) })),
    (error) => error.code === "invalid_response"
  );
  await assert.rejects(
    fetchCropOptions("https://api.example.org", {}, async () => ({ ok: true, json: async () => ({ ...optionsResponse, resolved_location: null }) })),
    (error) => error.code === "invalid_response"
  );
  await assert.rejects(
    fetchCropOptions("https://api.example.org", {}, async () => ({ ok: true, json: async () => ({ ...optionsResponse, options: [{ crop_label: "No id" }] }) })),
    (error) => error.code === "invalid_response"
  );
  await assert.rejects(
    fetchCropOptions("https://api.example.org", {}, async () => ({ ok: true, json: async () => ({ ...optionsResponse, options: [{ crop_id: "y", crop_label: "" }] }) })),
    (error) => error.code === "invalid_response"
  );
  await assert.rejects(
    fetchCropOptions("https://api.example.org", {}, async () => ({ ok: true, json: async () => ({ ...optionsResponse, options: [{ crop_id: "y", crop_label: "Beans" }] }) })),
    (error) => error.code === "invalid_response"
  );
});

test("sends a no-store anonymous POST and accepts a valid API response", async () => {
  let url;
  let options;
  const result = await fetchRecommendations(
    "https://api.example.org/",
    buildRequest({ latitude: -1.2, longitude: 36.8 }, "hsa-v1-2-maize-637a42a5"),
    async (requestUrl, requestOptions) => {
      url = requestUrl;
      options = requestOptions;
      return { ok: true, json: async () => assessment };
    }
  );
  assert.equal(url, "https://api.example.org/v1/recommendations");
  assert.equal(options.method, "POST");
  assert.equal(options.cache, "no-store");
  assert.equal(options.credentials, "omit");
  assert.equal(JSON.parse(options.body).crop_id, "hsa-v1-2-maize-637a42a5");
  assert.equal(result, assessment);
});

test("never accepts error or incomplete responses as an assessment", async () => {
  await assert.rejects(
    fetchRecommendations("https://api.example.org", {}, async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: { code: "insufficient_evidence", request_id: "req_e" } })
    })),
    (error) => error.code === "insufficient_evidence" && error.requestId === "req_e"
  );
  await assert.rejects(
    fetchRecommendations("https://api.example.org", {}, async () => ({
      ok: true,
      json: async () => ({ ...assessment, caveats: [] })
    })),
    (error) => error.code === "invalid_response"
  );
});

test("reports a request timeout distinctly", async () => {
  await assert.rejects(
    fetchRecommendations("https://api.example.org", {}, (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }), 5),
    (error) => error.code === "timeout"
  );
});

test("reports an unreachable service distinctly", async () => {
  await assert.rejects(
    fetchRecommendations("https://api.example.org", {}, async () => {
      throw new TypeError("Failed to fetch");
    }),
    (error) => error.code === "unavailable"
  );
});

test("requires HTTPS API origins outside localhost", async () => {
  await assert.rejects(
    fetchRecommendations("http://api.example.org", {}, async () => ({ ok: true, json: async () => assessment })),
    (error) => error.code === "configuration"
  );
  await assert.rejects(
    fetchRecommendations("", {}, async () => ({ ok: true, json: async () => assessment })),
    (error) => error.code === "configuration"
  );
  await assert.rejects(
    fetchRecommendations("https://user:secret@api.example.org", {}, async () => ({ ok: true, json: async () => assessment })),
    (error) => error.code === "configuration"
  );
  await assert.rejects(
    fetchRecommendations("https://api.example.org/path", {}, async () => ({ ok: true, json: async () => assessment })),
    (error) => error.code === "configuration"
  );
});
