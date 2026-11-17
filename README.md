# Tyala Africa

A dependency-free, installable, responsive PWA that provides historical crop
planting evidence for a farmer's location. It matches the farmer home-screen
mockup layout and connects to the Historical Crop Evidence API
(`POST /v1/recommendations`).

## Quick start

```sh
# Serve from the repo root (any static server works)
python3 -m http.server 5173
# then open http://localhost:5173
```

No build step or dependencies are required.

## Configuration

The API base URL is set in `config.js` and is a **public endpoint, not a
secret**. Override it by either:

1. Editing `config.js` and changing the default value, or
2. Setting `window.CROP_API_BASE_URL` via an inline script before `config.js`
   loads (useful for deployment without modifying source files).

```html
<!-- Example: override in index.html before config.js -->
<script>window.CROP_API_BASE_URL = "https://api.example.com";</script>
<script src="./config.js" defer></script>
```

When `CROP_API_BASE_URL` is empty (default), requests go to the same origin
that serves the PWA.

## API contract

See [`openapi.yaml`](./openapi.yaml) and [`docs/api-contract.md`](./docs/api-contract.md)
for the full normative contract. The PWA calls:

```
POST {API_BASE_URL}/v1/recommendations
Content-Type: application/json

{
  "location": { "latitude": -1.2864, "longitude": 36.8172 },
  "crop": { "id": "maize" }
}
```

Location is obtained via the browser Geolocation API (coordinates) or a
user-entered address (resolved server-side). One crop is selected from the
category grid.

## States handled

| State | Behaviour |
|---|---|
| **Loading** | Spinner with "Fetching historical crop evidence…" |
| **Success** | Planting window, prevalence, confidence band, caveats, sources |
| **Partial data** | Available indicators shown; unavailable ones explained |
| **Insufficient evidence** (422) | Clear message with guidance to try another crop/location |
| **Unsupported location** (422) | Explains coverage is limited to configured regions |
| **Unsupported crop** (422) | Suggests selecting a different crop |
| **Rate limited** (429) | Retry prompt |
| **Service unavailable** (503) | Retry prompt |
| **Offline** | Detects `navigator.onLine`, shows offline message |
| **Network error** | Shows endpoint and retry option |

All historical evidence is presented as historical — never as an agronomic
guarantee, live recommendation, or forecast. Caveats from the API are always
displayed.

## Files

```
index.html              — main page (matches mockup layout)
styles.css              — all styles (brand colors as CSS custom properties)
app.js                  — application logic and API integration
config.js               — configurable API base URL
manifest.webmanifest    — PWA manifest (installable)
service-worker.js       — offline app-shell caching
assets/farmer-home.svg  — app icon
```

## PWA features

- **Installable**: manifest with standalone display, icons, theme color.
- **Offline**: service worker caches the app shell; navigation is
  network-first with cache fallback.
- **Responsive**: works from 320px to desktop widths.
- **Accessible**: semantic HTML, ARIA live regions, keyboard focus styles,
  reduced-motion support.
