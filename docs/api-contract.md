# Historical crop evidence API contract

The normative JSON interface is [OpenAPI 3.1](../openapi.yaml), version
`1.0.0`. The PWA calls `POST /v1/recommendations` with
`Content-Type: application/json`. This MVP accepts a location and one crop
catalog ID, then summarizes available local historical evidence. It does not
rank crops or make a live agronomic recommendation.

## Request and catalog compatibility

`location` and `crop` are required. Location preserves the existing contract:
provide exactly one of an `address` or a WGS 84 decimal-degree
`latitude`/`longitude` pair. Addresses are resolved server-side. `crop.id` is
the stable ID from the configured crop catalog and matches the existing
response `crop.id` shape; display names are resolved server-side. A free-text
crop name is not accepted as an identifier. No crop catalog file is currently
defined in `main`, so the deployment must supply the catalog and its ID
mapping.

Planting period, user weather, preferences, and any request for a future-year
forecast are out of scope. The service must not use a client-supplied weather
value or current forecast to imply suitability.

## Historical outputs and evidence

- `likely_planting_window` is a recurring range of local calendar months.
  Return it only when a local historical planting-calendar source explicitly
  supports it. Month values are integers 1-12, inclusive. Mark whether the
  range crosses a year boundary. Annual production or cropped-area totals
  alone cannot establish planting months. HarvestStat-Africa's planting and
  harvest calendar fields distinguish seasons (including cross-year seasons)
  and do not represent actual phenological timing. If those fields are used,
  describe the result only as recorded historical calendar metadata, never as
  an accurate planting date or phenological prediction.
- `local_historical_prevalence.share` is a proportion from 0 to 1: the
  requested crop's reported cropped-area total divided by total comparable
  reported cropped area for the same matched locality and observation period.
  Numerator and denominator must use the same area unit, period, and reporting
  scope; the response includes both totals and the observation years. If the
  source does not have comparable crop-area records, prevalence is unavailable.
  HarvestStat-Africa may support this historical statistic where its records
  contain comparable area data; production volume alone must not be presented
  as area prevalence.
- `confidence_band.level` is a qualitative `low`, `moderate`, or `high`
  evidence-strength label, with a rationale considering evidence amount and
  age, geographic match, and source comparability. It is not a probability,
  calibrated score, or statistical confidence interval. Do not assign a higher
  band merely because multiple outputs are present. Deployment-specific
  thresholds require review and validation.
- `data.sources` identifies public source names, evidence type, observation
  years where known, and retrieval time. These are historical source metadata,
  not live weather freshness.
- `caveats` must explain the material limits of the response. In particular,
  historical prevalence describes reported past cultivation; it does not
  prove what is best, current, or suitable on an individual farm. No live
  weather suitability, phenological accuracy, yield, or future outcome is
  claimed.

## Partial data and errors

Return HTTP `200` with each indicator's explicit `status: unavailable` and a
reason when the other indicator can be reported responsibly. Set confidence
to `low` when the remaining evidence is sparse or geographically weak, and
include a caveat explaining the missing indicator. If neither a supported
planting window nor comparable local area prevalence can be reported, return
HTTP `422` with `insufficient_evidence`, not an empty or guessed assessment.
If evidence is present but does not meet the deployment's minimum for an
indicator, mark that indicator unavailable rather than extrapolating; a
remaining indicator may be returned only if it can still be described
responsibly. When no indicator meets its minimum evidence requirement, return
`insufficient_evidence`. The actual minimums must be set from verified source
coverage before launch.

Return `unsupported_location` if no supported evidence geography can be
matched, and `unsupported_crop` if `crop.id` is not present in the configured
catalog. Never silently substitute a nearby locality or different crop.
Field-shape errors use `validation_error`; malformed JSON is `400`, a
non-JSON content type is `415`, rate limiting is `429`, and transient service
failure is `503`. All errors use the common `error` envelope in the OpenAPI
file. Evidence years and geographic coverage thresholds must be set from
verified data before launch; this contract does not invent them.

Africa remains the intended MVP region, not a claim that every African country
or location is supported. Only configured local evidence areas are supported.
Return `unsupported_location` outside those areas rather than extrapolating
from an undocumented neighbor.

## Browser, transport, and privacy assumptions

- Serve the API over HTTPS only. CORS is enforced by the API. Allow only exact
  configured PWA origins: development origins (for example
  `http://localhost:5173`) and the deployed production origin must be
  explicitly configured per environment. Do not use wildcard origins. Answer
  `OPTIONS` preflights for `POST` and the `Content-Type` request header;
  include `Vary: Origin` when reflecting the allowlisted origin. Cookie
  credentials are not part of this MVP.
- Requests are anonymous; do not put provider credentials or API keys in the
  PWA. Keep any provider secrets server-side and apply server-side abuse
  controls.
- Return `Cache-Control: no-store` for all location requests, including
  errors. Do not put addresses or precise coordinates in URLs, analytics, or
  ordinary logs. Minimize request-body retention. `request_id` must not encode
  request data.

## PWA request example

Configure the API base URL at build/deployment time; it is a public endpoint,
not a secret:

```js
const response = await fetch(`${API_BASE_URL}/v1/recommendations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    location: { latitude: -1.2864, longitude: 36.8172 },
    crop: { id: "crop-example-a" }
  })
});

const result = await response.json();
if (!response.ok) {
  throw new Error(result.error.message);
}
```

## Decisions before implementation

- Publish the crop catalog and stable ID mapping consumed by `crop.id`.
- Define supported evidence geographies, minimum historical coverage, and
  confidence-band thresholds using verified datasets and agronomic review.
- Confirm each source's meaning, observation period, and whether its area
  records are comparable before reporting a prevalence share.
- Confirm production and local PWA origins for deployment configuration.
