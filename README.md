# Tyala Africa

A dependency-free, installable, responsive PWA that lists **crops historically
reported near a farmer's location**, with planting windows, record coverage,
and honest caveats from the Historical Crop Evidence API
(`POST /v1/recommendations`).

## Quick start

```sh
# Serve from the repo root (any static server works)
python3 -m http.server 5173
# then open http://localhost:5173
```

No build step or dependencies are required. Run the validation tests with
`node --test tests/*.test.mjs`.

## Configuration

The API base URL lives in `config.js` as public configuration (never a
secret) and defaults to the deployed API:

```js
window.CROP_APP_CONFIG = {
  API_BASE_URL: "https://crop-advisory-api-production.up.railway.app/"
};
```

It must be an HTTPS origin without a path, query, or credentials
(`localhost`/`127.0.0.1` with `http:` is allowed for development).

## API contract

The PWA calls one endpoint on the deployed API, **location-first**:

```
POST {API_BASE_URL}/v1/recommendations
Content-Type: application/json

{
  "location": { "latitude": -1.2864, "longitude": 36.8172 }
}
```

- **Location-first flow**: the farmer provides a location (device geolocation
  or an address resolved client-side to coordinates with OpenStreetMap
  Nominatim — only coordinates are sent), and the API returns the list of
  crops historically reported in that area (crop ids + names, planting
  windows/record coverage when available, evidence details).
- `buildRequest` still supports an optional second argument (a catalog
  `crop_id`) for a single-crop historical assessment; the UI uses the
  location-only list on first run, with per-crop drill-in available later.
- The response schema is documented in [`openapi.yaml`](./openapi.yaml) and
  validated client-side in `recommendations.mjs` (strict on crop identity and
  the matched area; renders whatever evidence fields the service returns).

## States handled

| State | Behaviour |
|---|---|
| Loading | Status panel with in-progress copy |
| Success | Suggested-crops list for the matched area (empty list rendered honestly, nothing fabricated) |
| Insufficient evidence (422) | Clear message with request reference |
| Unsupported location | Explanation with guidance |
| Rate limited (429) / Service unavailable (503) | Retry prompts |
| Offline | Live status, results cleared, shell served from SW cache |
| Timeout / network error | Distinct messages with retry guidance |

Crops are presented as **historically reported** — never as a recommendation,
agronomic guarantee, live forecast, or ranking. Caveats from the API are
always displayed.

## Files

```
index.html              — app shell (single location step)
app.mjs                 — application logic, geocoding, rendering
recommendations.mjs     — request building, validation, API client
config.js               — configurable API base URL
crops.json              — crop catalog snapshot (labels; used by future drill-in)
styles.css              — styles (Cappy-derived brand tokens as CSS custom properties)
manifest.webmanifest    — PWA manifest (installable)
service-worker.js       — offline app-shell caching
assets/icon.svg|png     — app icon
openapi.yaml            — API contract
docs/api-contract.md    — contract narrative
docs/pwa-deployment.md  — deployment and configuration notes
tests/                  — request/response validation tests
```

## PWA features

- **Installable**: manifest with standalone display, icons, theme color
  `#385819`.
- **Offline**: service worker (`tyala-shell-v8`) caches the app shell and
  `crops.json`; navigation is network-first with cache fallback.
- **Responsive**: works from 320px to desktop widths.
- **Accessible**: semantic HTML, ARIA live regions, keyboard focus styles,
  reduced-motion support.

## Deployment

Deployed as a static site at
<https://tyala-africa-pwa-production.up.railway.app>. See
[`docs/pwa-deployment.md`](./docs/pwa-deployment.md).
