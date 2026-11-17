import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from api_server import ApiHTTPServer, CropApi


class CropApiHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ApiHTTPServer(("127.0.0.1", 0), CropApi())
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, method, path, payload=None, headers=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            method=method,
            headers=headers or {},
        )
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        result = response.status, response.headers, response.read()
        response.close()
        return result

    def test_health_is_cache_disabled_and_open_to_cross_origin_clients(self):
        status, headers, body = self.request("GET", "/healthz")
        result = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertNotIn("Access-Control-Allow-Credentials", headers)
        self.assertEqual(headers["X-Request-Id"], result["request_id"])

    def test_location_resolution_returns_area_without_coordinates(self):
        status, headers, body = self.request(
            "POST",
            "/v1/locations/resolve",
            {"location": {"latitude": -1.2864, "longitude": 36.8172}},
            {"Content-Type": "application/json"},
        )
        result = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(result["resolved_location"]["fnid"], "KE2013A147")
        self.assertEqual(
            result["resolved_location"]["boundary_source"]["version"], "v1.2"
        )
        self.assertNotIn("latitude", body.decode("utf-8"))
        self.assertNotIn("longitude", body.decode("utf-8"))
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_recommendation_does_not_invent_prevalence_or_thresholds(self):
        status, _, body = self.request(
            "POST",
            "/v1/recommendations",
            {
                "location": {"latitude": -1.2864, "longitude": 36.8172},
                "crop_id": "hsa-v1-2-maize-637a42a5",
            },
            {"Content-Type": "application/json"},
        )
        result = json.loads(body)["error"]
        self.assertEqual(status, 422)
        self.assertEqual(result["code"], "insufficient_evidence")
        self.assertIn("prevalence", [item["field"].split(".")[-1] for item in result["details"]])
        self.assertFalse(result["retryable"])

    def test_preflight_allows_any_origin_without_credentials(self):
        status, headers, _ = self.request(
            "OPTIONS",
            "/v1/recommendations",
            headers={
                "Origin": "https://client.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertEqual(headers["Access-Control-Allow-Methods"], "GET, POST, OPTIONS")
        self.assertNotIn("Access-Control-Allow-Credentials", headers)

    def test_uncovered_location_is_explicit(self):
        status, _, body = self.request(
            "POST",
            "/v1/locations/resolve",
            {"location": {"latitude": 0, "longitude": 0}},
            {"Content-Type": "application/json"},
        )
        self.assertEqual(status, 422)
        self.assertEqual(json.loads(body)["error"]["code"], "unsupported_location")


if __name__ == "__main__":
    unittest.main()
