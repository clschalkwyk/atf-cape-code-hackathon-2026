# PWA deployment

This repository contains a standalone static PWA. Serve its repository root
over HTTPS (or `localhost` during development); no build step or provider
credentials are required.

The brand fonts Poppins (body) and Comfortaa (headings) load from Google Fonts
when online. System sans-serif fallbacks keep the interface usable offline.

## Configure the API

`config.js` ships with the deployed API origin and can be overridden at
deployment time:

```js
window.CROP_APP_CONFIG = {
  API_BASE_URL: "https://crop-advisory-api-production.up.railway.app/"
};
```

The value is public configuration, not a secret. Never put API keys or
geocoding credentials in `config.js` or any other browser asset. The app sends
anonymous `POST /v1/recommendations` requests and does not send cookies.
`API_BASE_URL` must be an HTTPS origin without a path, query, or credentials
(`localhost`/`127.0.0.1` with `http:` is allowed for development).

This PWA is deployed at <https://tyala-africa-pwa-production.up.railway.app>
(Railway service `tyala-africa-pwa`, Railway static-file hosting). The API's
CORS policy is a wildcard (`Access-Control-Allow-Origin: *`) without
credentials, which matches the app's anonymous, cookie-free requests.

The service worker (`tyala-shell-v10`) intentionally excludes `config.js`,
caches only the static app shell plus `crops.json`, and never handles
cross-origin requests or non-GET requests. Recommendation responses are
requested with `cache: "no-store"` and are not stored by the app. Results are
cleared when a new request starts or the browser reports an offline
transition.

`index.html` references shell assets with a deploy-scoped version query
(`styles.css?v=10`, `app.mjs?v=10`) matching `tyala-shell-v10`. Cache-busting the
asset URLs guarantees that browsers still holding an older service-worker
generation fetch fresh assets from the network on their first post-deploy
load (their old cache only has the unversioned URLs), and the v9 worker's
`activate` handler deletes every older `tyala-shell-*` / `fieldnote-shell-*`
cache once it claims the page.

## Location and crop flow

The main flow is location-first. The farmer provides one location: device
coordinates (read only after the location button is pressed and browser
permission granted) or an address resolved client-side to coordinates with
OpenStreetMap Nominatim; only the coordinates are sent to the evidence
service.

The request body is `{ "location": { "latitude", "longitude" } }` (no
`crop_id`), and the results are the suggested-crops list: each option shows
the crop name, and whatever historical evidence the service returned
(planting window, reported share, record counts, notes) — never a ranking or
recommendation. An empty list is rendered honestly ("no crop records for this
area"), with nothing fabricated.

`recommendations.mjs` still supports a single-crop request
(`buildRequest(location, cropId)`, validated single-assessment response) for
the optional per-crop drill-in. The response schemas are documented in the
repository-root `openapi.yaml`; request/response validation tests run with
`node --test tests/*.test.mjs`.
