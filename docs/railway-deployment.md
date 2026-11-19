# Tyala Railway deployments

Both services in Railway project `crop-advisory` use this repository's `main`
branch, but **different Dockerfile paths**:

| Railway service | Dockerfile | Health check |
| --- | --- | --- |
| `crop-advisory-api` | `deploy/api.Dockerfile` | `/healthz` |
| `tyala-africa-pwa` | `deploy/pwa.Dockerfile` | `/` |

Configure each Railway service with the above Dockerfile path before attaching
`clschalkwyk/atf-cape-code-hackathon-2026` as its source.

- The API reads `PORT` from Railway at runtime and includes its pinned
  HarvestStat-Africa data and polygons in its build.
- Caddy serves only the PWA shell and public assets: no server-side datasets or
  Python source code are copied into the PWA container.
- Caddy binds to Railway's `PORT`, defaulting to 8080 for local Docker use.
- The API's CORS allowlist defaults to the Railway PWA domain and localhost:5173
  for development. Set `CORS_ALLOWED_ORIGINS` to comma-separated exact browser
  origins when using another PWA domain.
- API responses are `Cache-Control: no-store`; HTML, `config.js`, and the
  service worker are served with a revalidation-friendly cache policy.

After deploying, verify: (1) both Railway deployments are SUCCESS; (2) API
`GET /healthz` returns 200; (3) approved-origin OPTIONS/POST return
204/200 with a reflected CORS header; (4) unapproved-origin OPTIONS/POST are
rejected with 403 and no CORS allow header; (5) PWA `/` loads with v10
versioned assets and `service-worker.js` uses `tyala-shell-v10`.

No build should be marked as production-verified before the live smoke tests.
