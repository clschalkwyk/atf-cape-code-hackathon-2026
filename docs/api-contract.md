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

`POST /v1/recommendations` accepts one catalog `crop_id` and WGS 84
coordinates. It currently returns HTTP `422` with `insufficient_evidence`:
the source index has no validated comparable-area denominator or evidence
thresholds, and HarvestStat season fields are not actual phenological timing.
No prevalence estimate, planting recommendation, or suitability ranking is
returned. Unknown crop IDs and crops without local records also return
`insufficient_evidence`.

## Request and units

Requests use `location.latitude` and `location.longitude`, decimal degrees in
WGS 84, and exact catalog `crop_id` values. Address input and geocoding are
deferred. The location-resolution request uses coordinates only.

Errors use the common `error` envelope. `422` distinguishes invalid input,
unsupported geography, ambiguous boundaries, and insufficient evidence.
Malformed JSON uses `400`; a non-JSON content type uses `415`; transient
service failure uses `503`. No recommendation success response is emitted by
this MVP until the evidence gaps above are resolved.

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
