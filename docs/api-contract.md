# Crop recommendation API contract

The normative JSON interface is [OpenAPI 3.1](../openapi.yaml), currently
versioned as `1.0.0`. The PWA calls `POST /v1/recommendations` with
`Content-Type: application/json`. The URL version is the compatibility
boundary: additive optional fields may be introduced within `/v1`; changes
that break existing clients require a new major path version.

## MVP geography and evidence policy

Africa is the intended MVP region, not a claim that every African country or
location is supported. A location is supported only when the deployed service
has configured evidence for that location, planting period, and candidate
crops. The initial country/area allowlist and evidence thresholds must be
reviewed against actual data availability before launch; this contract does
not invent a list of supported countries, soil coverage, crop calendars, or
agronomic thresholds.

For an unconfigured or out-of-region location, return HTTP `422` with
`unsupported_location`. For a configured location where data is missing, too
stale, or too weak for the requested period, return HTTP `422` with
`insufficient_evidence` and no crop ranking. Do not substitute a nearby
location or present unsupported output as a recommendation. When evidence
supports only a cautious result, mark the planting window `provisional`, use
low confidence as appropriate, and state the limitation and source freshness.
Ranking is relative ordering, not a yield estimate, probability, or guarantee.

## Request and units

`location` and `planting_period` are required. `location` is exactly one of:

- `address`: a place/address string resolved by the server, or
- `latitude` and `longitude`: decimal degrees in WGS 84.

The planting period is either a start/end Gregorian date or a locally named
season with an optional year. Dates are calendar dates at the location, not
UTC timestamps. `weather` is optional and user-supplied; rainfall is a total
in millimetres (mm), temperatures are degrees Celsius, and all values refer
to the supplied observation period. The service must not treat user entries
as independently verified measurements.

The response ranks candidates and gives a suggested planting window, reasons,
risks, qualitative confidence, and source timestamps. Confidence labels are
qualitative until a calibration method is established and validated. Errors
use the common `error` envelope in the OpenAPI contract. `422` distinguishes
field validation, unsupported geography, and insufficient evidence by code.
Malformed JSON uses `400`; a non-JSON content type uses `415`; throttling uses
`429`; transient service failure uses `503`. The start date must not follow
the end date, and supplied minimum/maximum temperatures must be provided as a
pair with minimum no greater than maximum.

## Browser, transport, and privacy assumptions

- Serve the API over HTTPS only. CORS is enforced by the API, not by client
  code. Allow only the exact configured PWA origins: development origins
  (for example `http://localhost:5173`) and the deployed production origin
  must be explicitly configured per environment. Do not use wildcard origins.
  Answer `OPTIONS` preflights for `POST` and the `Content-Type` request header;
  include `Vary: Origin` when reflecting the allowlisted origin. If cookie
  credentials are ever introduced, use an explicit origin
  and `Access-Control-Allow-Credentials`; credentials are not part of this
  MVP contract.
- The MVP assumes anonymous requests (no user login or API key in the PWA).
  Apply server-side abuse controls/rate limits. Any geocoding, weather, or
  other provider credentials stay server-side and must never be embedded in
  browser code or returned in errors.
- Return `Cache-Control: no-store` for all responses to location requests,
  including errors. Do not place addresses or precise coordinates in URLs,
  analytics, or ordinary logs. Minimize retention of request bodies and avoid
  logging user-supplied weather values. `request_id` is safe for diagnostics
  and must not encode request data.
- The response `data.as_of` indicates the latest source-data time used.
  Each source reports its retrieval time; expose source names, never secrets.

## PWA request example

Configure the API base URL at build/deployment time; it is a public endpoint,
not a secret. The browser sends no provider credential:

```js
const response = await fetch(`${API_BASE_URL}/v1/recommendations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    location: { latitude: -1.2864, longitude: 36.8172 },
    planting_period: {
      start_date: "2027-03-01",
      end_date: "2027-04-15"
    }
  })
});

const result = await response.json();
if (!response.ok) {
  // Use result.error.code for a specific, user-safe message.
  throw new Error(result.error.message);
}
```

## Decisions to confirm before implementation

- Define the initial African country/area allowlist from verified provider
  coverage and an agronomic review; update this document when confirmed.
- Choose and document evidence freshness/coverage thresholds and a method for
  assigning confidence. Do not infer these from this interface.
- Confirm production and local PWA origins for deployment configuration.
- Revisit authentication, retention, and user consent if accounts or stored
  farm profiles are introduced.
