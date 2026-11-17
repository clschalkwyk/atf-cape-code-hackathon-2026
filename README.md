# Tyala Africa

A dependency-free, installable, responsive PWA that shows **historical crop
evidence** for a farmer's location: likely planting window and local
historical prevalence, with caveats, from the Historical Crop Evidence API
(`POST /v1/recommendations`).

## Quick start

```sh
# Serve from the repo root (any static server works)
python3 -m http.server 5173
# then open http://localhost:5173
```

No build step or dependencies are required. Run the response-validation tests
with `node --test tests/`.

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

The PWA calls one endpoint on the deployed API:

```
POST {API_BASE_URL}/v1/recommendations
Content-Type: application/json

{
  "location": { "latitude": -1.2864, "longitude": 36.8172 },
  "crop_id": "hsa-v1-2-maize-637a42a5"
}
```

- **Crop**: one crop, picked from the versioned catalog snapshot in
  `crops.json` via a suggestion list (step 01).
- **Location**: browser Geolocation, or an address resolved client-side to
  coordinates with OpenStreetMap Nominatim (step 02). Only coordinates are
  sent to the evidence service.
- The response schema (matched area, planting window, prevalence, confidence
  band, caveats, sources) is documented in [`openapi.yaml`](./openapi.yaml)
  and validated client-side in `recommendations.mjs`.

## States handled

| State | Behaviour |
|---|---|
| Loading | Status panel with in-progress copy |
| Success | Single assessment: matched area, planting window, prevalence, confidence band, caveats, sources |
| Partial data | Available indicators shown; unavailable ones explained with their API reason |
| Insufficient evidence (422) | Clear message; no assessment fabricated |
| Unsupported location / crop (422) | Explanation with guidance |
| Rate limited (429) / Service unavailable (503) | Retry prompts |
| Offline | Live status, results cleared, shell served from SW cache |
| Timeout / network error | Distinct messages with retry guidance |

All historical evidence is presented as historical — never as an agronomic
guarantee, live recommendation, or forecast. Caveats from the API are always
displayed.

## Files

```
index.html              — app shell (stepped form: crop, location)
app.mjs                 — application logic, geocoding, rendering
recommendations.mjs     — request building, validation, API client
config.js               — configurable API base URL
crops.json              — crop catalog snapshot for the picker
styles.css              — styles (Cappy-derived brand tokens as CSS custom properties)
manifest.webmanifest    — PWA manifest (installable)
service-worker.js       — offline app-shell caching
assets/icon.svg|png     — app icon
openapi.yaml            — API contract
docs/api-contract.md    — contract narrative
docs/pwa-deployment.md  — deployment and configuration notes
tests/                  — response/request validation tests
```

## PWA features

- **Installable**: manifest with standalone display, icons, theme color
  `#385819`.
- **Offline**: service worker (`tyala-shell-v7`) caches the app shell and
  `crops.json`; navigation is network-first with cache fallback.
- **Responsive**: works from 320px to desktop widths.
- **Accessible**: semantic HTML, ARIA live regions, keyboard focus styles,
  reduced-motion support.

## Deployment

Deployed as a static site at
<https://tyala-africa-pwa-production.up.railway.app>. See
[`docs/pwa-deployment.md`](./docs/pwa-deployment.md).
