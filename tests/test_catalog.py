import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_catalog


CATALOG_PATH = ROOT / "data/catalog/v1/catalog.json"
COVERAGE_PATH = ROOT / "data/catalog/v1/harveststat-coverage-v1.2.csv"
SCHEMA_PATH = ROOT / "data/catalog/v1/catalog.schema.json"
COVERAGE_SCHEMA_PATH = ROOT / "data/catalog/v1/harveststat-coverage.schema.json"
EXPECTED_SOURCE = "harveststat-africa-v1-2"


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


class CatalogSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = load_json(CATALOG_PATH)
        with COVERAGE_PATH.open(newline="", encoding="utf-8") as coverage_file:
            cls.coverage = list(csv.DictReader(coverage_file))

    def test_artifacts_match_versioned_contracts(self):
        schema = load_json(SCHEMA_PATH)
        coverage_schema = load_json(COVERAGE_SCHEMA_PATH)
        self.assertEqual(self.catalog["catalog_schema_version"], "1.0.0")
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertIn(
            "agronomy",
            {source["source_type"] for source in self.catalog["sources"]},
        )
        self.assertEqual(
            [field["name"] for field in coverage_schema["fields"]],
            list(self.coverage[0]),
        )
        self.assertEqual(
            self.catalog["regional_coverage"]["record_count"], len(self.coverage)
        )
        hsa = next(
            source for source in self.catalog["sources"]
            if source["source_id"] == EXPECTED_SOURCE
        )
        self.assertEqual(
            hsa["source_artifact"]["git_blob_sha"],
            build_catalog.PINNED_GIT_BLOB_SHA,
        )

    def test_coverage_is_queryable_and_references_source_crop_profiles(self):
        profiles = {
            profile["crop_id"]: profile
            for profile in self.catalog["crop_profiles"]
        }
        source_ids = {source["source_id"] for source in self.catalog["sources"]}
        keys = set()
        total_source_rows = 0
        for row in self.coverage:
            key = (
                row["source_id"],
                row["fnid"],
                row["crop_id"],
                row["season_name"],
            )
            self.assertNotIn(key, keys)
            keys.add(key)
            self.assertEqual(row["source_id"], EXPECTED_SOURCE)
            self.assertIn(row["crop_id"], profiles)
            self.assertIn(row["source_id"], source_ids)
            self.assertIn(row["admin_level"], {"1", "2"})
            self.assertEqual(len(row["country_code"]), 2)
            self.assertGreater(int(row["record_count"]), 0)
            self.assertTrue(all(1 <= month <= 12 for month in json.loads(row["planting_months"])))
            self.assertTrue(all(1 <= month <= 12 for month in json.loads(row["harvest_months"])))
            self.assertTrue(json.loads(row["qc_flag_counts"]))
            total_source_rows += int(row["record_count"])

        hsa = next(
            source for source in self.catalog["sources"]
            if source["source_id"] == EXPECTED_SOURCE
        )
        self.assertEqual(total_source_rows, hsa["observed_coverage"]["record_count"])
        self.assertEqual(len(profiles), hsa["observed_coverage"]["crop_product_count"])
        self.assertEqual(len({row["country_code"] for row in self.coverage}), 33)
        self.assertEqual(
            hsa["observed_coverage"]["admin_level_country_counts"],
            {"1": 18, "2": 15},
        )
        self.assertEqual(hsa["observed_coverage"]["season_label_count"], 34)

    def test_historical_products_do_not_claim_suitability(self):
        for profile in self.catalog["crop_profiles"]:
            self.assertEqual(profile["identity_status"], "source_label_only")
            self.assertIsNone(profile["scientific_name"])
            self.assertEqual(profile["identity_source_id"], EXPECTED_SOURCE)
            self.assertEqual(profile["planting_window_status"], "missing")
            self.assertEqual(profile["planting_windows"], [])
            for field_name in (
                "growing_duration_days",
                "temperature_requirements_c",
                "rainfall_requirements_mm",
                "water_requirement",
                "soil_preferences",
            ):
                field = profile[field_name]
                self.assertEqual(field["status"], "missing")
                self.assertEqual(field["source_ids"], [])
                for key, value in field.items():
                    if key not in {"status", "source_ids", "texture_classes"}:
                        self.assertIsNone(value)


class CatalogBuilderTests(unittest.TestCase):
    def test_aggregates_calendar_labels_by_crop_location_and_season(self):
        rows = [
            {
                "fnid": "AO2008A101",
                "country": "Angola",
                "country_code": "AO",
                "admin_1": "Bengo",
                "admin_2": "none",
                "product": "Maize",
                "season_name": "Main",
                "planting_year": "2020",
                "planting_month": "3",
                "harvest_year": "2020",
                "harvest_month": "8",
                "qc_flag": "0",
            },
            {
                "fnid": "AO2008A101",
                "country": "Angola",
                "country_code": "AO",
                "admin_1": "Bengo",
                "admin_2": "none",
                "product": "Maize",
                "season_name": "Main",
                "planting_year": "2021",
                "planting_month": "4",
                "harvest_year": "2021",
                "harvest_month": "9",
                "qc_flag": "1",
            },
            {
                "fnid": "AO2008A101",
                "country": "Angola",
                "country_code": "AO",
                "admin_1": "Bengo",
                "admin_2": "none",
                "product": "Maize",
                "season_name": "Second",
                "planting_year": "2021",
                "planting_month": "10",
                "harvest_year": "2022",
                "harvest_month": "2",
                "qc_flag": "0",
            },
        ]
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            source_csv = temp_path / "source.csv"
            with source_csv.open("w", newline="", encoding="utf-8") as source_file:
                writer = csv.DictWriter(source_file, fieldnames=rows[0].keys())
                writer.writeheader()
                writer.writerows(rows)
            catalog_path = temp_path / "catalog.json"
            catalog_path.write_text(
                json.dumps(load_json(CATALOG_PATH)), encoding="utf-8"
            )
            coverage_path = temp_path / "coverage.csv"

            summary = build_catalog.build_catalog(
                source_csv, catalog_path, coverage_path
            )
            catalog = load_json(catalog_path)
            with coverage_path.open(newline="", encoding="utf-8") as coverage_file:
                coverage = list(csv.DictReader(coverage_file))

        self.assertEqual(summary["record_count"], 3)
        self.assertEqual(len(coverage), 2)
        main_season = next(row for row in coverage if row["season_name"] == "Main")
        self.assertEqual(main_season["admin_level"], "1")
        self.assertEqual(main_season["planting_year_min"], "2020")
        self.assertEqual(main_season["planting_year_max"], "2021")
        self.assertEqual(json.loads(main_season["planting_months"]), [3, 4])
        self.assertEqual(json.loads(main_season["qc_flag_counts"]), {"0": 1, "1": 1})
        self.assertEqual(catalog["regional_coverage"]["record_count"], 2)
        self.assertEqual(catalog["crop_profiles"][0]["planting_window_status"], "missing")

    def test_rejects_invalid_months(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            source_csv = temp_path / "source.csv"
            columns = sorted(build_catalog.REQUIRED_COLUMNS)
            row = {column: "" for column in columns}
            row.update(
                {
                    "fnid": "AO1",
                    "country": "Angola",
                    "country_code": "AO",
                    "admin_1": "Bengo",
                    "admin_2": "none",
                    "product": "Maize",
                    "season_name": "Main",
                    "planting_year": "2020",
                    "planting_month": "13",
                    "harvest_year": "2020",
                    "harvest_month": "8",
                    "qc_flag": "0",
                }
            )
            with source_csv.open("w", newline="", encoding="utf-8") as source_file:
                writer = csv.DictWriter(source_file, fieldnames=columns)
                writer.writeheader()
                writer.writerow(row)
            catalog_path = temp_path / "catalog.json"
            catalog_path.write_text(
                json.dumps(load_json(CATALOG_PATH)), encoding="utf-8"
            )

            with self.assertRaisesRegex(ValueError, "planting_month is out of range"):
                build_catalog.build_catalog(
                    source_csv, catalog_path, temp_path / "coverage.csv"
                )

    def test_rejects_a_source_file_that_does_not_match_the_pinned_release(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            source_csv = temp_path / "source.csv"
            source_csv.write_text("not the pinned dataset\n", encoding="utf-8")
            catalog_path = temp_path / "catalog.json"
            catalog_path.write_text(
                json.dumps(load_json(CATALOG_PATH)), encoding="utf-8"
            )

            with self.assertRaisesRegex(ValueError, "does not match"):
                build_catalog.build_catalog(
                    source_csv,
                    catalog_path,
                    temp_path / "coverage.csv",
                    expected_git_blob_sha=build_catalog.PINNED_GIT_BLOB_SHA,
                )


if __name__ == "__main__":
    unittest.main()
