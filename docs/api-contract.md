# Crop recommendation API contract

The normative JSON interface is [OpenAPI 3.1](../openapi.yaml), currently
versioned as `1.0.0`. The PWA calls `POST /v1/recommendations` with
`Content-Type: application/json`. The URL version is the compatibility
boundary: additive optional fields may be introduced within `/v1`; changes
that break existing clients require a new major path version.

## MVP geography and evidence policy

Africa is the intended MVP region, not a claim that every African country or
location is supported. The deployed service resolves only exact HarvestStat
Africa v1.2 areas present in the historical crop index. It does not evaluate
agronomic suitability.

See the [crop and regional data catalog](data-catalog.md) for a versioned
source inventory and the HarvestStat Africa historical-coverage index. That
index scopes exact location matching to areas with historical records; it is
not crop-suitability evidence or a support allowlist for recommendations.

`POST /v1/locations/resolve` is a separate, location-only operation. It accepts
WGS 84 latitude/longitude coordinates and returns an FNID only when one exact
HarvestStat Africa v1.2 boundary contains the point and that FNID appears in
the v1.2 historical crop coverage index. It does not geocode addresses, infer
suitability, or use a nearest or parent-area fallback. Boundary and overlap
points return `ambiguous_location`; points outside indexed areas return
`unsupported_location`. A match proves only historical source coverage.

`POST /v1/recommendations` accepts WGS 84 coordinates and an optional catalog
`crop_id`.

- **Location-first crop options (`crop_id` omitted).** The service resolves
  the coordinates to one exact HarvestStat v1.2 area (no nearest or
  parent-area fallback) and returns HTTP `200` with the crops that have
  historical records in the pinned v1.2 coverage index for that exact area.
  Each option carries the stable catalog `crop_id` for follow-up requests,
  the crop label, a summary of historical occurrences (seasons and months
  observed with raw record counts), and a qualitative evidence hint. Options
  are ordered by label and carry no ranking; comparable-area shares are not
  computed because the index has no validated denominator; top-level `notes`
  restate the explicit caveats, including that HarvestStat calendar fields
  are reporting seasons, not phenological timing. Absence from this list
  means no indexed historical record in the pinned release; it does not mean
  the crop is absent or unsuitable. A resolved area with zero indexed crop
  records returns HTTP `422` with `insufficient_evidence`.
- **Single-crop check (`crop_id` provided).** It currently returns HTTP `422`
  with `insufficient_evidence`: the source index has no validated
  comparable-area denominator or evidence thresholds, and HarvestStat season
  fields are not actual phenological timing. No prevalence estimate, planting
  recommendation, or suitability ranking is returned. Unknown crop IDs and
  crops without local records also return `insufficient_evidence`.

## Request and units

Requests use `location.latitude` and `location.longitude`, decimal degrees in
WGS 84, and, when provided, exact catalog `crop_id` values. Omitting `crop_id`
requests the location-first crop options list. Address input and geocoding
are deferred. The location-resolution request uses coordinates only.

Errors use the common `error` envelope. `422` distinguishes invalid input,
unsupported geography, ambiguous boundaries, and insufficient evidence.
Malformed JSON uses `400`; a non-JSON content type uses `415`; transient
service failure uses `503`. No single-crop recommendation success response is
emitted by this MVP until the evidence gaps above are resolved; the
location-only crop options response is an inventory of historical
occurrences, not a recommendation.

## Browser, transport, and privacy assumptions

- Serve the API over HTTPS only. CORS allows any origin (`*`) for anonymous
  requests and does not allow credentials. Answer `OPTIONS` preflights for
  `GET`, `POST`, and the `Content-Type` request header.
- The MVP assumes anonymous requests (no user login or API key in the PWA).
  Rate limiting is not implemented by this service; apply edge-level abuse
  controls before broad public use.
- Return `Cache-Control: no-store` for all responses to location requests,
  including errors. Do not place addresses or precise coordinates in URLs,
  analytics, logs, or persistent storage. Request bodies are processed in
  memory only. `request_id` is opaque and does not encode request data.

## PWA request example

Configure the API base URL at build/deployment time; it is a public endpoint,
not a secret. The browser sends no provider credential:

```js
// Location-first: list historically reported crops for the resolved area.
const optionsResponse = await fetch(`${API_BASE_URL}/v1/recommendations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    location: { latitude: -1.2864, longitude: 36.8172 }
  })
});

const optionsResult = await optionsResponse.json();
if (!optionsResponse.ok) {
  // Use optionsResult.error.code for a specific, user-safe message.
  throw new Error(optionsResult.error.message);
}
// optionsResult.resolved_location: the exact area (FNID, country, admin level).
// optionsResult.options: { crop_id, crop_label, summary, evidence_hint } per
// crop, ordered by label with no ranking. optionsResult.notes carries the
// explicit caveats; render them, and treat HarvestStat months as reporting
// seasons, not planting guidance. A crop_id from the list can be sent with
// coordinates for the single-crop historical-evidence check.
```

Single-crop historical-evidence check (note: it currently always answers
`422` with `insufficient_evidence`):

```js
const response = await fetch(`${API_BASE_URL}/v1/recommendations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    location: { latitude: -1.2864, longitude: 36.8172 },
    crop_id: "hsa-v1-2-maize-637a42a5"
  })
});

const result = await response.json();
if (!response.ok) {
  // Use result.error.code for a specific, user-safe message.
  throw new Error(result.error.message);
}
```

For an administrative-area lookup without crop ranking, call
`POST /v1/locations/resolve`:

```js
const response = await fetch(`${API_BASE_URL}/v1/locations/resolve`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    location: { latitude: -1.2864, longitude: 36.8172 }
  })
});
const result = await response.json();
if (!response.ok) throw new Error(result.error.message);
// result.resolved_location contains FNID, country, admin level, and names.
```

The coordinate-resolution source is the [pinned HarvestStat Africa v1.2
boundary GeoPackage](../data/catalog/v1/hvstat_africa_boundary_v1.2.gpkg),
joined to the [v1.2 historical coverage index](../data/catalog/v1/harveststat-coverage-v1.2.csv).
The catalog documents its MIT terms, artifact hash, EPSG:4326 CRS, administrative
resolution, and limitations. Exact matches return source FNIDs only; ambiguous
or uncovered points do not fall back to another area. The resolver does not log
or store coordinates.
