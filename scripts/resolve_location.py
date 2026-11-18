#!/usr/bin/env python3
"""Resolve WGS84 points to exact HarvestStat Africa v1.2 coverage areas."""

from __future__ import annotations

import csv
import hashlib
import math
import sqlite3
import struct
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOUNDARY_PATH = ROOT / "data/catalog/v1/hvstat_africa_boundary_v1.2.gpkg"
COVERAGE_PATH = ROOT / "data/catalog/v1/harveststat-coverage-v1.2.csv"
BOUNDARY_TABLE = "hvstat_africa_boundary_v1.2"
BOUNDARY_SOURCE_ID = "harveststat-boundaries-v1-2"
BOUNDARY_VERSION = "v1.2"
BOUNDARY_GIT_BLOB_SHA = "d470ba2bed4263a56fe16e8f8be4a3ebdca2c861"
COVERAGE_SOURCE_ID = "harveststat-africa-v1-2"
SRS_ID = 4326
BOUNDARY_EPSILON_DEGREES = 1e-10


class InvalidCoordinates(ValueError):
    """Coordinates are not a valid WGS84 latitude/longitude pair."""


class UnsupportedLocation(LookupError):
    """No exact supported HarvestStat area contains the point."""


class AmbiguousLocation(LookupError):
    """The point lies on a boundary or within overlapping areas."""


class BoundaryDataError(RuntimeError):
    """The boundary or coverage source is not the expected pinned dataset."""


@dataclass(frozen=True)
class AdministrativeArea:
    country_code: str
    country: str
    fnid: str
    admin_level: int
    admin_1: str
    admin_2: str | None
    boundary_source_id: str = BOUNDARY_SOURCE_ID
    boundary_version: str = BOUNDARY_VERSION


@dataclass(frozen=True)
class _Candidate:
    area: AdministrativeArea
    geometry: tuple[tuple[tuple[float, float], ...], ...]


def _git_blob_sha(path: Path) -> str:
    digest = hashlib.sha1()
    size = path.stat().st_size
    digest.update(f"blob {size}\0".encode("ascii"))
    with path.open("rb") as source_file:
        for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _quoted_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _read_uint(data: bytes, offset: int, endian: str) -> tuple[int, int]:
    if offset + 4 > len(data):
        raise BoundaryDataError("Truncated WKB geometry.")
    return struct.unpack_from(f"{endian}I", data, offset)[0], offset + 4


def _read_wkb_geometry(
    data: bytes, offset: int
) -> tuple[int, tuple[tuple[tuple[float, float], ...], ...] | None, int]:
    if offset + 5 > len(data):
        raise BoundaryDataError("Truncated WKB geometry.")
    byte_order = data[offset]
    if byte_order not in (0, 1):
        raise BoundaryDataError("Unsupported WKB byte order.")
    endian = "<" if byte_order == 1 else ">"
    geometry_type = struct.unpack_from(f"{endian}I", data, offset + 1)[0]
    base_type = geometry_type % 1000
    if geometry_type // 1000:
        raise BoundaryDataError("Unexpected dimensionality in boundary geometry.")
    offset += 5

    if base_type == 3:
        ring_count, offset = _read_uint(data, offset, endian)
        rings = []
        for _ in range(ring_count):
            point_count, offset = _read_uint(data, offset, endian)
            if point_count < 4:
                raise BoundaryDataError("Invalid polygon ring in boundary geometry.")
            points = []
            for _ in range(point_count):
                if offset + 16 > len(data):
                    raise BoundaryDataError("Truncated polygon ring.")
                x, y = struct.unpack_from(f"{endian}dd", data, offset)
                offset += 16
                if not math.isfinite(x) or not math.isfinite(y):
                    raise BoundaryDataError("Non-finite boundary coordinate.")
                points.append((x, y))
            if points[0] != points[-1]:
                raise BoundaryDataError("Unclosed polygon ring in boundary geometry.")
            rings.append(tuple(points))
        if not rings:
            raise BoundaryDataError("Polygon has no exterior ring.")
        return base_type, tuple(rings), offset

    if base_type == 6:
        polygon_count, offset = _read_uint(data, offset, endian)
        polygons = []
        for _ in range(polygon_count):
            child_type, rings, offset = _read_wkb_geometry(data, offset)
            if child_type != 3 or rings is None:
                raise BoundaryDataError("MultiPolygon contains a non-polygon geometry.")
            polygons.append(rings)
        return base_type, tuple(polygons), offset

    raise BoundaryDataError("Unsupported geometry type in boundary dataset.")


def _decode_gpkg_multipolygon(
    blob: bytes,
) -> tuple[tuple[tuple[tuple[float, float], ...], ...], ...]:
    if len(blob) < 8 or blob[:2] != b"GP" or blob[2] != 0:
        raise BoundaryDataError("Invalid GeoPackage geometry header.")

    flags = blob[3]
    if flags & 0xE0:
        raise BoundaryDataError("Unsupported GeoPackage geometry flags.")
    if flags & 0x10:
        raise BoundaryDataError("Empty boundary geometry.")
    endian = "<" if flags & 1 else ">"
    srs_id = struct.unpack_from(f"{endian}i", blob, 4)[0]
    if srs_id != SRS_ID:
        raise BoundaryDataError("Boundary geometry is not stored in EPSG:4326.")

    envelope_type = (flags >> 1) & 7
    envelope_doubles = {0: 0, 1: 4, 2: 6, 3: 6, 4: 8}.get(envelope_type)
    if envelope_doubles is None:
        raise BoundaryDataError("Unsupported GeoPackage envelope.")
    wkb_offset = 8 + envelope_doubles * 8
    geometry_type, polygons, end_offset = _read_wkb_geometry(blob, wkb_offset)
    if geometry_type != 6 or polygons is None or end_offset != len(blob):
        raise BoundaryDataError("Invalid MultiPolygon boundary geometry.")
    return polygons


def _point_in_ring(
    longitude: float, latitude: float, ring: tuple[tuple[float, float], ...]
) -> int:
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        dx = x2 - x1
        dy = y2 - y1
        length = math.hypot(dx, dy)
        if length and abs((longitude - x1) * dy - (latitude - y1) * dx) <= (
            BOUNDARY_EPSILON_DEGREES * length
        ):
            if (
                min(x1, x2) - BOUNDARY_EPSILON_DEGREES
                <= longitude
                <= max(x1, x2) + BOUNDARY_EPSILON_DEGREES
                and min(y1, y2) - BOUNDARY_EPSILON_DEGREES
                <= latitude
                <= max(y1, y2) + BOUNDARY_EPSILON_DEGREES
            ):
                return 0

        if (y1 > latitude) != (y2 > latitude):
            crossing_longitude = x1 + (latitude - y1) * dx / dy
            if longitude < crossing_longitude:
                inside = not inside
    return 1 if inside else -1


def _point_in_multipolygon(
    longitude: float,
    latitude: float,
    polygons: tuple[tuple[tuple[tuple[float, float], ...], ...], ...],
) -> int:
    inside = False
    for rings in polygons:
        exterior = _point_in_ring(longitude, latitude, rings[0])
        if exterior == 0:
            return 0
        if exterior < 0:
            continue
        in_hole = False
        for hole in rings[1:]:
            hole_result = _point_in_ring(longitude, latitude, hole)
            if hole_result == 0:
                return 0
            if hole_result > 0:
                in_hole = True
                break
        if not in_hole:
            inside = True
    return 1 if inside else -1


def _load_coverage_fnids(coverage_path: Path) -> set[str]:
    with coverage_path.open(newline="", encoding="utf-8") as coverage_file:
        reader = csv.DictReader(coverage_file)
        required = {"source_id", "fnid"}
        if not required.issubset(reader.fieldnames or []):
            raise BoundaryDataError("Coverage index is missing required columns.")
        fnids = set()
        for row in reader:
            if row["source_id"] != COVERAGE_SOURCE_ID or not row["fnid"]:
                raise BoundaryDataError("Unexpected source in coverage index.")
            fnids.add(row["fnid"])
    if not fnids:
        raise BoundaryDataError("Coverage index contains no supported FNIDs.")
    return fnids


class HarvestStatLocationResolver:
    """Match coordinates to one exact FNID also present in the crop index."""

    def __init__(
        self,
        boundary_path: Path = BOUNDARY_PATH,
        coverage_path: Path = COVERAGE_PATH,
        *,
        expected_boundary_git_blob_sha: str | None = BOUNDARY_GIT_BLOB_SHA,
    ) -> None:
        self._boundary_path = Path(boundary_path)
        self._coverage_fnids = _load_coverage_fnids(Path(coverage_path))
        if expected_boundary_git_blob_sha and (
            _git_blob_sha(self._boundary_path) != expected_boundary_git_blob_sha
        ):
            raise BoundaryDataError("Boundary file does not match the pinned v1.2 release.")

    @staticmethod
    def _validate_coordinates(latitude: float, longitude: float) -> None:
        if (
            isinstance(latitude, bool)
            or isinstance(longitude, bool)
            or not isinstance(latitude, (int, float))
            or not isinstance(longitude, (int, float))
            or not math.isfinite(latitude)
            or not math.isfinite(longitude)
            or not -90 <= latitude <= 90
            or not -180 <= longitude <= 180
        ):
            raise InvalidCoordinates("Provide valid WGS84 latitude and longitude.")

    def resolve(self, latitude: float, longitude: float) -> AdministrativeArea:
        """Return the sole exact area match; never retain or return coordinates."""
        self._validate_coordinates(latitude, longitude)
        table = _quoted_identifier(BOUNDARY_TABLE)
        rtree = _quoted_identifier("rtree_hvstat_africa_boundary_v1.2_geom")
        connection = sqlite3.connect(
            f"file:{self._boundary_path.resolve().as_posix()}?mode=ro",
            uri=True,
        )
        try:
            metadata = connection.execute(
                "SELECT data_type, srs_id FROM gpkg_contents WHERE table_name = ?",
                (BOUNDARY_TABLE,),
            ).fetchone()
            geometry_metadata = connection.execute(
                "SELECT column_name, geometry_type_name, srs_id "
                "FROM gpkg_geometry_columns WHERE table_name = ?",
                (BOUNDARY_TABLE,),
            ).fetchone()
            if metadata != ("features", SRS_ID) or geometry_metadata != (
                "geom",
                "MULTIPOLYGON",
                SRS_ID,
            ):
                raise BoundaryDataError("Unexpected HarvestStat boundary schema or CRS.")
            try:
                rows = connection.execute(
                    f"""
                    SELECT boundary.fnid, boundary.country, boundary.country_code,
                           boundary.admin_1, boundary.admin_2, boundary.geom
                    FROM {rtree} AS spatial
                    JOIN {table} AS boundary ON boundary.fid = spatial.id
                    WHERE spatial.minx <= ? AND spatial.maxx >= ?
                      AND spatial.miny <= ? AND spatial.maxy >= ?
                    """,
                    (longitude, longitude, latitude, latitude),
                ).fetchall()
            except sqlite3.OperationalError as error:
                raise BoundaryDataError(
                    "Pinned boundary GeoPackage has no usable spatial index."
                ) from error
        finally:
            connection.close()

        matches = []
        boundary_hit = False
        for fnid, country, country_code, admin_1, admin_2, geometry_blob in rows:
            polygons = _decode_gpkg_multipolygon(geometry_blob)
            result = _point_in_multipolygon(longitude, latitude, polygons)
            if result == 0:
                boundary_hit = True
            elif result > 0:
                matches.append(
                    (
                        fnid in self._coverage_fnids,
                        AdministrativeArea(
                            country_code=country_code,
                            country=country,
                            fnid=fnid,
                            admin_level=2 if admin_2 else 1,
                            admin_1=admin_1,
                            admin_2=admin_2,
                        ),
                    )
                )

        if boundary_hit or len(matches) > 1:
            raise AmbiguousLocation(
                "The coordinate lies on or overlaps administrative boundaries."
            )
        if not matches or not matches[0][0]:
            raise UnsupportedLocation(
                "No exact HarvestStat area with historical crop records contains this coordinate."
            )
        return matches[0][1]


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--latitude", type=float, required=True)
    parser.add_argument("--longitude", type=float, required=True)
    parser.add_argument("--boundary", type=Path, default=BOUNDARY_PATH)
    parser.add_argument("--coverage", type=Path, default=COVERAGE_PATH)
    args = parser.parse_args()
    area = HarvestStatLocationResolver(args.boundary, args.coverage).resolve(
        args.latitude, args.longitude
    )
    print(
        f"{area.country_code}\t{area.fnid}\t{area.admin_level}\t"
        f"{area.admin_1}\t{area.admin_2 or ''}"
    )


if __name__ == "__main__":
    main()
