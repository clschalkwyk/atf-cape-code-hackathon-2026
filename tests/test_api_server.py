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

Nairobi = {"latitude": -1.2864, "longitude": 36.8172}
MAIZE_ID = "hsa-v1-2-maize-637a42a5"
PWA_ORIGIN = "https://tyala-africa-pwa-production.up.railway.app"


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

    def test_health_is_cache_disabled_and_allows_configured_origin(self):
        status, headers, body = self.request(
            "GET", "/healthz", headers={"Origin": PWA_ORIGIN}
        )
        result = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Access-Control-Allow-Origin"], PWA_ORIGIN)
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

    def test_preflight_allows_configured_origin_without_credentials(self):
        status, headers, _ = self.request(
            "OPTIONS",
            "/v1/recommendations",
            headers={
                "Origin": PWA_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], PWA_ORIGIN)
        self.assertEqual(headers["Access-Control-Allow-Methods"], "GET, POST, OPTIONS")
        self.assertNotIn("Access-Control-Allow-Credentials", headers)

    def test_unapproved_origin_is_rejected_for_preflight_and_post(self):
        origin = "https://unapproved.example"
        status, headers, body = self.request(
            "OPTIONS",
            "/v1/recommendations",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(json.loads(body)["error"]["code"], "forbidden_origin")

        status, headers, body = self.request(
            "POST",
            "/v1/recommendations",
            {"location": Nairobi},
            {"Content-Type": "application/json", "Origin": origin},
        )
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(json.loads(body)["error"]["code"], "forbidden_origin")

    def test_allowed_origin_is_reflected_on_post(self):
        status, headers, _ = self.request(
            "POST",
            "/v1/recommendations",
            {"location": Nairobi},
            {"Content-Type": "application/json", "Origin": PWA_ORIGIN},
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], PWA_ORIGIN)
        self.assertEqual(headers["Vary"], "Origin")

    def test_uncovered_location_is_explicit(self):
        status, _, body = self.request(
            "POST",
            "/v1/locations/resolve",
            {"location": {"latitude": 0, "longitude": 0}},
            {"Content-Type": "application/json"},
        )
        self.assertEqual(status, 422)
        self.assertEqual(json.loads(body)["error"]["code"], "unsupported_location")

    def test_location_only_returns_indexed_crop_options(self):
        status, headers, body = self.request(
            "POST",
            "/v1/recommendations",
            {"location": Nairobi},
            {"Content-Type": "application/json"},
        )
        result = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(result["resolved_location"]["fnid"], "KE2013A147")
        crop_ids = {
            profile["crop_id"]
            for profile in json.loads(
                (ROOT / "data/catalog/v1/catalog.json").read_text(encoding="utf-8")
            )["crop_profiles"]
        }
        options = result["options"]
        self.assertEqual(len(options), 18)
        for option in options:
            self.assertEqual(
                set(option), {"crop_id", "crop_label", "summary", "evidence_hint"}
            )
            self.assertIn(option["crop_id"], crop_ids)
            self.assertTrue(option["crop_label"])
            self.assertGreaterEqual(option["summary"]["record_count"], 1)
            self.assertTrue(option["summary"]["seasons_observed"])
            for season in option["summary"]["seasons_observed"]:
                self.assertEqual(
                    set(season),
                    {"season_name", "planting_months", "harvest_months"},
                )
                for month in season["planting_months"] + season["harvest_months"]:
                    self.assertGreaterEqual(month, 1)
                    self.assertLessEqual(month, 12)
            self.assertRegex(
                option["evidence_hint"], r"^\d+ source records? across \d+ reported seasons?\.$"
            )
        keys = [(o["crop_label"].casefold(), o["crop_id"]) for o in options]
        self.assertEqual(keys, sorted(keys))
        maize = next(o for o in options if o["crop_id"] == MAIZE_ID)
        self.assertEqual(maize["crop_label"], "Maize")
        self.assertEqual(maize["summary"]["record_count"], 34)
        self.assertEqual(
            maize["summary"]["seasons_observed"],
            [
                {"season_name": "Annual", "planting_months": [1], "harvest_months": [12]},
                {"season_name": "Long", "planting_months": [3], "harvest_months": [8]},
                {"season_name": "Short", "planting_months": [10], "harvest_months": [3]},
            ],
        )
        self.assertTrue(
            any("not a suitability ranking" in note for note in result["notes"])
        )
        body_text = body.decode("utf-8")
        self.assertNotIn("latitude", body_text)
        self.assertNotIn("longitude", body_text)

    def test_location_only_outside_coverage_is_explicit(self):
        status, _, body = self.request(
            "POST",
            "/v1/recommendations",
            {"location": {"latitude": 0, "longitude": 0}},
            {"Content-Type": "application/json"},
        )
        self.assertEqual(status, 422)
        self.assertEqual(
            json.loads(body)["error"]["code"], "unsupported_location"
        )

    def test_location_only_zero_indexed_crops_is_insufficient_evidence(self):
        api = CropApi()
        api.coverage_by_area = {}
        api.covered_crop_areas = set()
        server = ApiHTTPServer(("127.0.0.1", 0), api)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/v1/recommendations",
                data=json.dumps({"location": Nairobi}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            try:
                response = urllib.request.urlopen(request, timeout=5)
            except urllib.error.HTTPError as error:
                response = error
            body = response.read()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        result = json.loads(body)["error"]
        self.assertEqual(response.status, 422)
        self.assertEqual(result["code"], "insufficient_evidence")
        self.assertEqual(
            result["message"],
            "No historical crop records are indexed for this administrative area.",
        )
        self.assertFalse(result["retryable"])

    def test_single_crop_path_unchanged_for_crop_without_local_records(self):
        status, _, body = self.request(
            "POST",
            "/v1/recommendations",
            {"location": Nairobi, "crop_id": "hsa-v1-2-avocado-d22c09bc"},
            {"Content-Type": "application/json"},
        )
        result = json.loads(body)["error"]
        self.assertEqual(status, 422)
        self.assertEqual(result["code"], "insufficient_evidence")
        self.assertIn(
            "No historical records for this crop are indexed at this location.",
            result["message"],
        )

    def test_recommendation_rejects_invalid_crop_id_values(self):
        for crop_id in ("", None, 5):
            with self.subTest(crop_id=crop_id):
                status, _, body = self.request(
                    "POST",
                    "/v1/recommendations",
                    {"location": Nairobi, "crop_id": crop_id},
                    {"Content-Type": "application/json"},
                )
                result = json.loads(body)["error"]
                self.assertEqual(status, 422)
                self.assertEqual(result["code"], "validation_error")
                self.assertIn(
                    "crop_id", [detail["field"] for detail in result["details"]]
                )
        status, _, body = self.request(
            "POST",
            "/v1/recommendations",
            {"crop_id": MAIZE_ID},
            {"Content-Type": "application/json"},
        )
        self.assertEqual(status, 422)
        self.assertEqual(json.loads(body)["error"]["code"], "validation_error")


if __name__ == "__main__":
    unittest.main()
