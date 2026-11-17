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

The service worker (`tyala-shell-v7`) intentionally excludes `config.js`,
caches only the static app shell plus `crops.json`, and never handles
cross-origin requests or non-GET requests. Recommendation responses are
requested with `cache: "no-store"` and are not stored by the app. Results are
cleared when a new request starts or the browser reports an offline
transition.

## Location and crop flow

Crop selection happens first: the farmer picks one crop from the versioned
catalog snapshot in `crops.json` (HarvestStat v1 crop IDs) matched by a
suggestion list. Device coordinates are read only after the user presses the
location button and grants browser permission; an address is resolved
client-side to coordinates with OpenStreetMap Nominatim and only the
coordinates are sent to the evidence service.

The request body is `{ "location": { "latitude", "longitude" },
"crop_id": "<catalog id>" }`, matching the deployed service. The historical
response shows one assessment: matched area, likely planting window (or its
unavailability reason), local historical prevalence (or its unavailability
reason), a confidence band, caveats, and data sources. All evidence is
presented as historical — never as an agronomic guarantee or forecast.

`openapi.yaml` in the repository root documents the deployed services; the
app's `recommendations.mjs` validates responses against that shape
(`tests/recommendations.test.mjs`, run with `node --test tests/`).
