FROM caddy:2.10-alpine

# The PWA image intentionally omits backend source, tests and geo datasets.
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY index.html config.js app.mjs recommendations.mjs styles.css /srv/
COPY crops.json manifest.webmanifest service-worker.js /srv/
COPY assets/ /srv/assets/

ENV PORT=8080
EXPOSE 8080
