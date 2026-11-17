/**
 * Configurable API base URL.
 *
 * This is a public endpoint, not a secret. Override at deployment time by
 * either:
 *   1. Editing this file and rebuilding, or
 *   2. Setting window.CROP_API_BASE_URL before this script loads
 *      (e.g. via a small inline script in index.html).
 *
 * The PWA sends POST requests to `${API_BASE_URL}/v1/recommendations`.
 */
(function () {
  "use strict";

  if (!window.CROP_API_BASE_URL) {
    // Default to the deployed API; override for local development.
    window.CROP_API_BASE_URL = "https://crop-advisory-api-production.up.railway.app";
  }

  window.CROP_API_ENDPOINT =
    window.CROP_API_BASE_URL + "/v1/recommendations";
})();
