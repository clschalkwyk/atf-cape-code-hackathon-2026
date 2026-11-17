import json
import sqlite3
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import resolve_location


class HarvestStatLocationResolverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.resolver = resolve_location.HarvestStatLocationResolver()

    def test_resolves_exact_supported_area_without_returning_coordinates(self):
        area = self.resolver.resolve(latitude=-1.2864, longitude=36.8172)
        self.assertEqual(area.fnid, "KE2013A147")
        self.assertEqual(area.country_code, "KE")
        self.assertEqual(area.country, "Kenya")
        self.assertEqual(area.admin_level, 1)
        self.assertEqual(area.admin_1, "Nairobi")
        self.assertIsNone(area.admin_2)
        self.assertEqual(area.boundary_source_id, "harveststat-boundaries-v1-2")
        self.assertEqual(area.boundary_version, "v1.2")
        self.assertNotIn("latitude", area.__dataclass_fields__)
        self.assertNotIn("longitude", area.__dataclass_fields__)

    def test_resolves_an_admin_level_two_area(self):
        area = self.resolver.resolve(latitude=12.3714, longitude=-1.5197)
        self.assertEqual(area.fnid, "BF2020A21300")
        self.assertEqual(area.country_code, "BF")
        self.assertEqual(area.admin_level, 2)
        self.assertEqual(area.admin_1, "Centre")
        self.assertEqual(area.admin_2, "Kadiogo")

    def test_does_not_assign_a_nearest_area_outside_boundary_coverage(self):
        with self.assertRaises(resolve_location.UnsupportedLocation):
            self.resolver.resolve(latitude=0, longitude=0)

    def test_rejects_points_on_a_source_boundary_as_ambiguous(self):
        connection = sqlite3.connect(resolve_location.BOUNDARY_PATH)
        try:
            row = connection.execute(
                'SELECT geom FROM "hvstat_africa_boundary_v1.2" '
                "WHERE fnid = ?",
                ("AO2008A101",),
            ).fetchone()
        finally:
            connection.close()
        polygons = resolve_location._decode_gpkg_multipolygon(row[0])
        longitude, latitude = polygons[0][0][0]

        with self.assertRaises(resolve_location.AmbiguousLocation):
            self.resolver.resolve(latitude=latitude, longitude=longitude)

    def test_rejects_invalid_coordinate_values_without_echoing_them(self):
        for latitude, longitude in (
            (91, 0),
            (0, 181),
            (float("nan"), 0),
            (True, 1),
            ("-1.2", 36.8),
        ):
            with self.subTest(latitude=latitude, longitude=longitude):
                with self.assertRaises(resolve_location.InvalidCoordinates) as error:
                    self.resolver.resolve(latitude=latitude, longitude=longitude)
                self.assertNotIn(str(latitude), str(error.exception))
                self.assertNotIn(str(longitude), str(error.exception))

    def test_rejects_a_modified_boundary_file(self):
        with self.assertRaisesRegex(resolve_location.BoundaryDataError, "pinned"):
            resolve_location.HarvestStatLocationResolver(
                expected_boundary_git_blob_sha="0" * 40
            )

    def test_boundary_catalog_metadata_matches_the_pinned_artifact(self):
        catalog_path = ROOT / "data/catalog/v1/catalog.json"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        source = next(
            item
            for item in catalog["sources"]
            if item["source_id"] == resolve_location.BOUNDARY_SOURCE_ID
        )
        self.assertEqual(
            source["source_artifact"]["git_blob_sha"],
            resolve_location.BOUNDARY_GIT_BLOB_SHA,
        )
        self.assertEqual(source["dataset_version"], resolve_location.BOUNDARY_VERSION)
        self.assertEqual(source["license"]["name"], "MIT License")


if __name__ == "__main__":
    unittest.main()
